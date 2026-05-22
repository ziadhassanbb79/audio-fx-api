# Audio FX API

A small SaaS-style HTTP API that accepts an MP3 upload, runs it through FFmpeg effects, and returns the altered MP3 file. It is designed to be easy to call from n8n, curl, Postman, or any custom app.

## Features

- Accepts `.mp3` uploads via `multipart/form-data`
- Returns the processed audio as `audio/mpeg`
- Supports these effects:
  - noise
  - EQ
  - phone filtering
  - distortion
  - compression
  - bitrate loss
- Open CORS policy for browser-based clients and self-hosted automation tools
- Dockerfile included for deployment anywhere FFmpeg is not already installed

## API

### `GET /health`

Basic health check.

### `GET /v1/capabilities`

Returns the supported effects and request shape.

### `POST /v1/process`

Consumes `multipart/form-data`.

Required field:

- `file`: the source `.mp3`

Optional config field:

- `fx`: JSON string describing the effects

Example `fx` JSON:

```json
{
  "noise": { "enabled": true, "amount": 0.05 },
  "eq": { "enabled": true, "low": -4, "mid": 2, "high": 6 },
  "phone": { "enabled": true },
  "distortion": { "enabled": true, "amount": 0.35 },
  "compression": { "enabled": true, "threshold": 0.18, "ratio": 5 },
  "bitrateLoss": { "enabled": true, "kbps": 64 }
}
```

You can also send individual form fields instead of JSON, for example:

- `noiseEnabled=true`
- `noiseAmount=0.04`
- `eqEnabled=true`
- `eqLow=-3`
- `eqMid=1`
- `eqHigh=5`
- `phoneEnabled=true`
- `distortionEnabled=true`
- `distortionAmount=0.5`
- `compressionEnabled=true`
- `compressionRatio=4`
- `bitrateLossEnabled=true`
- `bitrateLossKbps=48`

## Local run

### 1. Install dependencies

```bash
npm install
```

### 2. Make sure FFmpeg exists

Set an environment variable if FFmpeg is not on your `PATH`.

```bash
FFMPEG_PATH=/usr/bin/ffmpeg
```

On Windows PowerShell:

```powershell
$env:FFMPEG_PATH="C:\ffmpeg\bin\ffmpeg.exe"
```

### 3. Start the API

```bash
npm start
```

Default port: `3000`

## curl example

```bash
curl -X POST http://localhost:3000/v1/process \
  -F "file=@input.mp3" \
  -F 'fx={"noise":{"enabled":true,"amount":0.03},"phone":{"enabled":true},"bitrateLoss":{"enabled":true,"kbps":48}}' \
  --output output.mp3
```

## n8n usage

Use an `HTTP Request` node:

- Method: `POST`
- URL: `http://your-api-host:3000/v1/process`
- Send Body: `Form-Data`
- Add binary field:
  - Name: `file`
  - Use your incoming binary MP3 property
- Add text field:
  - Name: `fx`
  - Value: JSON string with your selected effects

The response is binary MP3 audio, so in n8n you can store it, send it onward, or upload it elsewhere.

## Docker deployment

Build:

```bash
docker build -t audio-fx-api .
```

Run:

```bash
docker run --rm -p 3000:3000 audio-fx-api
```

## Notes

- This project expects MP3 input and always returns MP3 output.
- The current machine used for development did not have FFmpeg installed, so local processing will only work after you install FFmpeg or run the Docker image.
