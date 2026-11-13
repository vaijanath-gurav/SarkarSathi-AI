"""
B10 - local speech-to-text service.  DEV 1 OWNS THIS FILE.

Mirrors the Ollama pattern: a small local HTTP service that keeps the model resident,
so Node never pays the model-load cost per request.

    python stt/server.py

POST /transcribe  with the raw audio bytes (OGG/Opus straight from WhatsApp)
  -> {"text": "...", "language": "mr", "duration": 4.2}

Why faster-whisper rather than a Node package: it bundles PyAV, which decodes OGG/Opus
directly. No separate ffmpeg install, which matters on Windows.

Nothing here leaves the machine - same data-sovereignty argument as the VLM.
"""

import json
import os
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

# Windows consoles default to cp1252, which cannot encode Devanagari. Without this,
# printing a Hindi or Marathi transcript raises UnicodeEncodeError and the request fails
# with a charmap error - AFTER the model transcribed it perfectly well.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

try:
    import av
    import numpy as np
    from faster_whisper import WhisperModel
except ImportError:
    sys.exit("Missing deps.  Run: python -m pip install -r stt/requirements.txt")


def decode_audio(path, sample_rate=16000):
    """
    Decode any container PyAV supports (WhatsApp sends OGG/Opus) to the mono float32
    array Whisper wants.

    We do this ourselves rather than letting faster-whisper do it: faster-whisper 1.2.1
    calls av.open(..., metadata_errors="ignore"), an argument PyAV removed after v14.
    PyAV <15 has no prebuilt wheel for Python 3.12 on Windows and will not build without
    FFmpeg dev libraries, so pinning is not an option here. This decoder uses the current
    PyAV API and sidesteps the incompatibility completely.
    """
    chunks = []
    with av.open(path) as container:
        if not container.streams.audio:
            return np.zeros(0, dtype=np.float32)
        stream = container.streams.audio[0]
        resampler = av.audio.resampler.AudioResampler(
            format="s16", layout="mono", rate=sample_rate
        )
        for frame in container.decode(stream):
            for resampled in resampler.resample(frame):
                chunks.append(resampled.to_ndarray().reshape(-1))
        for resampled in resampler.resample(None):      # flush the resampler
            chunks.append(resampled.to_ndarray().reshape(-1))

    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32) / 32768.0

# "small" is the practical ceiling on this hardware, not a compromise we can buy out of.
# Measured on an RTX 3050 laptop, CPU int8, on a 3.5s Marathi clip:
#   small  -> partial transcript in ~1.6s   (content words garbled, frame roughly right)
#   medium -> "..." in 118s                 (34x realtime AND worse output)
# Medium is unusable: a demo cannot wait two minutes per voice note. Do not "upgrade"
# to medium without re-measuring; bigger is not better here.
MODEL_SIZE = os.environ.get("STT_MODEL", "small")
PORT = int(os.environ.get("STT_PORT", "5005"))

# int8 on CPU keeps memory low and leaves the GPU entirely to the VLM, which needs it
# more. The 3050's 6GB is already holding qwen3-vl.
DEVICE = os.environ.get("STT_DEVICE", "cpu")
COMPUTE = os.environ.get("STT_COMPUTE", "int8")

print(f"Loading Whisper '{MODEL_SIZE}' on {DEVICE} ({COMPUTE})...", flush=True)
_t0 = time.time()
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE)
print(f"Model ready in {time.time() - _t0:.1f}s", flush=True)


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "model": MODEL_SIZE})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        # Accept /transcribe and /transcribe?language=mr
        path, _, query = self.path.partition("?")
        if path != "/transcribe":
            return self._json(404, {"error": "not found"})

        # The user already chose their language from a button, so telling Whisper beats
        # making it guess. Auto-detect on a short Marathi clip returned "en" at 0.289
        # confidence and transliterated the speech into nonsense English.
        forced = None
        for part in query.split("&"):
            key, _, value = part.partition("=")
            if key == "language" and value:
                forced = value

        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return self._json(400, {"error": "empty body"})
        audio = self.rfile.read(length)

        # PyAV reads from a path reliably across formats; a temp file is the safe route.
        tmp = tempfile.NamedTemporaryFile(suffix=".ogg", delete=False)
        try:
            tmp.write(audio)
            tmp.close()

            t0 = time.time()
            samples = decode_audio(tmp.name)
            if samples.size == 0:
                return self._json(200, {"text": "", "language": None, "duration": 0})

            segments, info = model.transcribe(
                samples,
                language=forced,          # None = auto-detect; a code is far more accurate
                beam_size=5,              # Indic needs the search; greedy returned empty
                vad_filter=False,         # VAD swallowed short Marathi clips entirely
                task="transcribe",        # never "translate" - we want the spoken language
            )
            text = "".join(seg.text for seg in segments).strip()
            elapsed = time.time() - t0

            print(f'[stt] {info.language} ({info.language_probability:.2f}) '
                  f'{elapsed:.1f}s: {text[:80]}', flush=True)

            self._json(200, {
                "text": text,
                "language": info.language,
                "language_probability": round(info.language_probability, 3),
                "duration": round(info.duration, 2),
                "elapsed": round(elapsed, 2),
            })
        except Exception as exc:                       # noqa: BLE001
            print(f"[stt] failed: {exc}", flush=True)
            self._json(500, {"error": str(exc)})
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

    def log_message(self, *_args):
        pass          # our own prints are more useful than the default access log


if __name__ == "__main__":
    print(f"STT service on http://localhost:{PORT}", flush=True)
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
