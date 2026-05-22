import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import cors from "cors";
import multer from "multer";
import {
  cleanupJob,
  parseEffectConfig,
  processAudio
} from "./audioEffects.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
const maxFileSizeMb = Number(process.env.MAX_FILE_SIZE_MB || 25);

const uploadRoot = path.join(os.tmpdir(), "audio-fx-api-uploads");
await fs.mkdir(uploadRoot, { recursive: true });

const upload = multer({
  dest: uploadRoot,
  limits: {
    fileSize: maxFileSizeMb * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const isMp3Mime =
      file.mimetype === "audio/mpeg" || file.mimetype === "audio/mp3";
    const hasMp3Extension = file.originalname.toLowerCase().endsWith(".mp3");

    if (isMp3Mime || hasMp3Extension) {
      cb(null, true);
      return;
    }

    cb(new Error("Only MP3 uploads are supported."));
  }
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    name: "audio-fx-api",
    status: "ok",
    endpoints: {
      health: "GET /health",
      process: "POST /v1/process"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    ffmpegPath,
    maxFileSizeMb
  });
});

app.get("/v1/capabilities", (req, res) => {
  res.json({
    input: "multipart/form-data",
    fileField: "file",
    accepts: [".mp3"],
    effects: {
      noise: { amount: "0.0 - 1.0" },
      eq: {
        low: "-24 to 24 dB",
        mid: "-24 to 24 dB",
        high: "-24 to 24 dB"
      },
      phone: true,
      distortion: { amount: "0.0 - 1.0" },
      compression: {
        threshold: "0.01 - 1.0",
        ratio: "1 - 20",
        attack: "0.1 - 1000 ms",
        release: "1 - 5000 ms",
        makeup: "0 - 10"
      },
      bitrateLoss: { kbps: "16 - 320" }
    },
    configFieldExamples: {
      fx: {
        noise: { enabled: true, amount: 0.05 },
        eq: { enabled: true, low: -4, mid: 2, high: 6 },
        phone: { enabled: true },
        distortion: { enabled: true, amount: 0.35 },
        compression: { enabled: true, ratio: 5, threshold: 0.18 },
        bitrateLoss: { enabled: true, kbps: 64 }
      }
    }
  });
});

app.post("/v1/process", upload.single("file"), async (req, res) => {
  let outputPath;
  let jobDir;

  try {
    if (!req.file?.path) {
      res.status(400).json({ error: "Missing MP3 file in multipart field 'file'." });
      return;
    }

    const rawConfig = readConfigFromBody(req.body);
    const config = parseEffectConfig(rawConfig, req.body);

    const result = await processAudio({
      inputPath: req.file.path,
      config,
      ffmpegPath
    });

    outputPath = result.outputPath;
    jobDir = result.jobDir;

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${buildOutputName(req.file.originalname)}"`
    );

    res.sendFile(outputPath, async (error) => {
      await cleanupJob([req.file?.path, jobDir]);
      if (error && !res.headersSent) {
        res.status(500).json({ error: "Failed to send processed audio." });
      }
    });
  } catch (error) {
    await cleanupJob([req.file?.path, jobDir]);
    const statusCode = isUploadError(error) ? 400 : 500;
    res.status(statusCode).json({
      error: error.message || "Audio processing failed."
    });
  }
});

app.use((error, req, res, next) => {
  if (!error) {
    next();
    return;
  }

  if (isUploadError(error)) {
    res.status(400).json({ error: error.message });
    return;
  }

  res.status(500).json({ error: error.message || "Unexpected server error." });
});

app.listen(port, () => {
  console.log(`audio-fx-api listening on port ${port}`);
});

function parseJsonField(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Invalid JSON in fx/options field.");
  }
}

function readConfigFromBody(body) {
  if (typeof body.fx === "string" && body.fx.trim()) {
    return parseJsonField(body.fx);
  }

  if (typeof body.options === "string" && body.options.trim()) {
    return parseJsonField(body.options);
  }

  return {};
}

function buildOutputName(originalName) {
  const base = path.basename(originalName, path.extname(originalName));
  return `${base}-fx.mp3`;
}

function isUploadError(error) {
  return (
    error instanceof multer.MulterError ||
    error.message === "Only MP3 uploads are supported."
  );
}
