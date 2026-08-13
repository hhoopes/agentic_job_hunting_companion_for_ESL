"""HTTP sidecar for openai-whisper — keeps the model resident across requests.

Run:
    python scripts/whisper_server.py --model small --port 8080

Then POST WAV/PCM audio to /inference (multipart form field name: "file").
Response: {"text": "..."}

Query params on /inference:
    language: ISO-639-1 code hint (e.g. "ar", "es", "en"). Default: autodetect.
    task:     "transcribe" (keep source language) or "translate" (→ English). Default: transcribe.
"""
from __future__ import annotations

import argparse
import io
import logging
import sys
import tempfile
from pathlib import Path

import uvicorn
import whisper
from fastapi import FastAPI, File, HTTPException, Query, UploadFile

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("whisper_server")


def build_app(model_name: str) -> FastAPI:
    log.info("loading whisper model %r (this can take 10-30s the first time)", model_name)
    model = whisper.load_model(model_name)
    log.info("model %r ready", model_name)

    app = FastAPI(title="whisper-sidecar")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "model": model_name}

    @app.post("/inference")
    async def inference(
        file: UploadFile = File(...),
        language: str | None = Query(default=None),
        task: str = Query(default="transcribe"),
    ) -> dict:
        if task not in ("transcribe", "translate"):
            raise HTTPException(400, f"task must be 'transcribe' or 'translate', got {task!r}")

        # Whisper wants a filename (it dispatches decoder by extension). Round-trip through a temp WAV.
        data = await file.read()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as tmp:
            tmp.write(data)
            tmp.flush()
            result = model.transcribe(
                tmp.name,
                language=language,
                task=task,
                fp16=False,  # CPU/MPS-safe; whisper flips to fp16 on CUDA anyway
            )

        text = (result.get("text") or "").strip()
        return {"text": text, "language": result.get("language")}

    return app


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="small", help="tiny | base | small | medium | large")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--host", default="127.0.0.1")
    args = p.parse_args()

    app = build_app(args.model)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
