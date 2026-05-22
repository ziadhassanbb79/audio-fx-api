import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULTS = {
  noise: { enabled: false, amount: 0.04 },
  eq: { enabled: false, low: 0, mid: 0, high: 0 },
  phone: { enabled: false },
  distortion: { enabled: false, amount: 0.45 },
  compression: {
    enabled: false,
    threshold: 0.2,
    ratio: 4,
    attack: 20,
    release: 250,
    makeup: 1
  },
  bitrateLoss: { enabled: false, kbps: 64 }
};

export function parseEffectConfig(rawConfig = {}, rawFields = {}) {
  const parsed = {
    noise: normalizeNoise(rawConfig.noise, rawFields),
    eq: normalizeEq(rawConfig.eq, rawFields),
    phone: normalizePhone(rawConfig.phone, rawFields),
    distortion: normalizeDistortion(rawConfig.distortion, rawFields),
    compression: normalizeCompression(rawConfig.compression, rawFields),
    bitrateLoss: normalizeBitrateLoss(rawConfig.bitrateLoss, rawFields)
  };

  return parsed;
}

export async function processAudio({ inputPath, config, ffmpegPath }) {
  const jobDir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-fx-api-"));
  const outputPath = path.join(jobDir, "processed.mp3");

  try {
    const ffmpegArgs = buildFfmpegArgs({ inputPath, outputPath, config });
    await runProcess(ffmpegPath, ffmpegArgs);
    return { outputPath, jobDir };
  } catch (error) {
    await safeRemove(jobDir);
    throw error;
  }
}

export async function cleanupJob(paths = []) {
  await Promise.all(paths.map((targetPath) => safeRemove(targetPath)));
}

function buildFfmpegArgs({ inputPath, outputPath, config }) {
  const args = ["-hide_banner", "-y", "-i", inputPath];
  const filterSteps = [];
  let currentLabel = "[0:a]";
  let noiseInputLabel = null;

  if (config.eq.enabled) {
    filterSteps.push(
      `${currentLabel}equalizer=f=120:width_type=h:width=200:g=${config.eq.low},` +
        `equalizer=f=1000:width_type=h:width=1000:g=${config.eq.mid},` +
        `equalizer=f=5000:width_type=h:width=3000:g=${config.eq.high}[eq]`
    );
    currentLabel = "[eq]";
  }

  if (config.phone.enabled) {
    filterSteps.push(`${currentLabel}highpass=f=300,lowpass=f=3400[phone]`);
    currentLabel = "[phone]";
  }

  if (config.distortion.enabled) {
    const mix = clamp(config.distortion.amount, 0, 1);
    const bits = Math.round(interpolate(10, 4, mix));
    const levelIn = interpolate(1.1, 1.9, mix).toFixed(2);
    filterSteps.push(
      `${currentLabel}volume=${levelIn},acrusher=bits=${bits}:mix=${mix.toFixed(2)}:mode=lin,alimiter=limit=0.95[distorted]`
    );
    currentLabel = "[distorted]";
  }

  if (config.compression.enabled) {
    filterSteps.push(
      `${currentLabel}acompressor=threshold=${config.compression.threshold}:ratio=${config.compression.ratio}:attack=${config.compression.attack}:release=${config.compression.release}:makeup=${config.compression.makeup}[compressed]`
    );
    currentLabel = "[compressed]";
  }

  if (config.noise.enabled) {
    args.push("-f", "lavfi", "-i", "anoisesrc=color=white:sample_rate=44100");
    filterSteps.push(
      `[1:a]volume=${clamp(config.noise.amount, 0, 1).toFixed(3)}[noisebed]`
    );
    noiseInputLabel = "[noisebed]";
  }

  if (noiseInputLabel) {
    filterSteps.push(
      `${currentLabel}${noiseInputLabel}amix=inputs=2:weights='1 1':normalize=0[final]`
    );
    currentLabel = "[final]";
  }

  if (filterSteps.length > 0) {
    args.push("-filter_complex", filterSteps.join(";"), "-map", currentLabel);
  } else {
    args.push("-map", "0:a:0");
  }

  const outputBitrate = config.bitrateLoss.enabled
    ? `${config.bitrateLoss.kbps}k`
    : "192k";
  const sampleRate = config.bitrateLoss.enabled ? "22050" : "44100";

  args.push(
    "-c:a",
    "libmp3lame",
    "-b:a",
    outputBitrate,
    "-ar",
    sampleRate,
    outputPath
  );

  return args;
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(
        new Error(
          `Failed to start FFmpeg. Check FFMPEG_PATH. Original error: ${error.message}`
        )
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `FFmpeg exited with code ${code}`));
    });
  });
}

function normalizeNoise(noise, fields) {
  const enabled = toBoolean(
    noise?.enabled ?? noise ?? fields.noiseEnabled ?? fields.noise
  );

  return {
    enabled,
    amount: clampNumber(noise?.amount ?? fields.noiseAmount, 0, 1, DEFAULTS.noise.amount)
  };
}

function normalizeEq(eq, fields) {
  const enabled = toBoolean(eq?.enabled ?? eq ?? fields.eqEnabled);
  return {
    enabled,
    low: clampNumber(eq?.low ?? fields.eqLow, -24, 24, DEFAULTS.eq.low),
    mid: clampNumber(eq?.mid ?? fields.eqMid, -24, 24, DEFAULTS.eq.mid),
    high: clampNumber(eq?.high ?? fields.eqHigh, -24, 24, DEFAULTS.eq.high)
  };
}

function normalizePhone(phone, fields) {
  return {
    enabled: toBoolean(phone?.enabled ?? phone ?? fields.phoneEnabled ?? fields.phone)
  };
}

function normalizeDistortion(distortion, fields) {
  const enabled = toBoolean(
    distortion?.enabled ??
      distortion ??
      fields.distortionEnabled ??
      fields.distortion
  );

  return {
    enabled,
    amount: clampNumber(
      distortion?.amount ?? fields.distortionAmount,
      0,
      1,
      DEFAULTS.distortion.amount
    )
  };
}

function normalizeCompression(compression, fields) {
  const enabled = toBoolean(
    compression?.enabled ??
      compression ??
      fields.compressionEnabled ??
      fields.compression
  );

  return {
    enabled,
    threshold: clampNumber(
      compression?.threshold ?? fields.compressionThreshold,
      0.01,
      1,
      DEFAULTS.compression.threshold
    ),
    ratio: clampNumber(
      compression?.ratio ?? fields.compressionRatio,
      1,
      20,
      DEFAULTS.compression.ratio
    ),
    attack: clampNumber(
      compression?.attack ?? fields.compressionAttack,
      0.1,
      1000,
      DEFAULTS.compression.attack
    ),
    release: clampNumber(
      compression?.release ?? fields.compressionRelease,
      1,
      5000,
      DEFAULTS.compression.release
    ),
    makeup: clampNumber(
      compression?.makeup ?? fields.compressionMakeup,
      0,
      10,
      DEFAULTS.compression.makeup
    )
  };
}

function normalizeBitrateLoss(bitrateLoss, fields) {
  const enabled = toBoolean(
    bitrateLoss?.enabled ??
      bitrateLoss ??
      fields.bitrateLossEnabled ??
      fields.bitrateLoss
  );

  return {
    enabled,
    kbps: clampNumber(
      bitrateLoss?.kbps ?? fields.bitrateKbps ?? fields.bitrateLossKbps,
      16,
      320,
      DEFAULTS.bitrateLoss.kbps
    )
  };
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, min, max);
}

function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value > 0;
  }

  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  }

  return false;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function interpolate(start, end, amount) {
  return start + (end - start) * amount;
}

async function safeRemove(targetPath) {
  if (!targetPath) {
    return;
  }

  await fs.rm(targetPath, { recursive: true, force: true });
}
