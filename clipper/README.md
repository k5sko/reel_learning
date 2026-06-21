# Clipper Stage

Takes a YouTube URL or an uploaded MP4 and produces **self-contained `.mp4` clips**
that never cut mid-sentence, plus a DB record per clip for downstream stages.

This is one stage in a larger pipeline. It does **not** include the app, auth, or
downstream systems (recommendation, RAG, compression) — those are separate stages.

## Architecture

Server-side Python pipeline; the phone/web client is a thin consumer that streams
the rendered clips and reads clip metadata from the DB (clips are encoded
`yuv420p` + `+faststart`, optionally 9:16, for mobile playback). Heavy work
(download, transcription, ffmpeg) stays on the backend — not on the device.

Two load-bearing decisions make the "no mid-sentence cut" guarantee *structural*
rather than prompt-dependent:

1. **The LLM works only in sentence-index space.** `segment.py` returns
   `{start_sentence, end_sentence, reason}` — never timestamps. It literally
   cannot express a mid-word cut.
2. **`boundaries.py` is the sole authority on time.** It maps indices to times,
   snaps each edge into inter-sentence silence (bounded by neighbor word edges,
   so a cut can never enter an adjacent sentence), pads with clamping, enforces
   duration, de-dups, and **asserts no boundary lands inside a word span** —
   dropping any clip that can't satisfy it.

Word-level timestamps from ASR are the source of truth for every cut. The ASR
backend is behind `asr.py` (faster-whisper now, OpenAI Whisper API swappable via
`CLIPPER_ASR_BACKEND`); storage is behind `storage.py` (local disk now,
S3-swappable). Every stage writes a JSON artifact to the job dir and skips
recomputation when its artifact exists, so the pipeline is resumable.

## Pipeline

| Stage | Module | Artifact |
|---|---|---|
| Ingest | `pipeline/ingest.py` | `video.mp4`, `audio.wav`, `ingest.json` |
| Transcribe | `pipeline/transcribe.py` + `asr.py` | `transcript.json` |
| Sentences | `pipeline/sentences.py` | `sentences.json` |
| Segment (LLM) | `pipeline/segment.py` + `llm.py` | `moments.json` |
| Boundaries | `pipeline/boundaries.py` | `boundaries.json` |
| Render | `pipeline/render.py` + `ffmpeg.py` | `clips/<id>.mp4`, `render.json` |
| Label (LLM) | `pipeline/label.py` | `clips.json` + DB rows |

## Setup

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r clipper/requirements.txt          # includes static-ffmpeg for local dev
cp clipper/.env.example clipper/.env             # set ANTHROPIC_API_KEY
```

Requires `ffmpeg`, `ffprobe`, and `yt-dlp` on PATH. `static-ffmpeg` (a dependency)
provides ffmpeg/ffprobe for local dev; in production install a system ffmpeg
instead — `config.py` defers to a real one on PATH. The binary check runs at
import and raises loudly if anything is missing (`CLIPPER_SKIP_BINARY_CHECK=1`
bypasses it for tests).

> Target runtime is Python 3.11. The code is also verified on 3.9. For
> production, use 3.11 (faster-whisper performance) and ideally a GPU for the
> ASR model; CPU + a smaller model (`CLIPPER_ASR_MODEL=small`) is the dev default.

## Usage

```bash
python -m clipper "https://www.youtube.com/watch?v=..."
python -m clipper /path/to/video.mp4
python -m clipper /path/to/video.mp4 --force segment,boundaries   # reuse transcript
```

Programmatic:

```python
from clipper.pipeline.orchestrator import process
job_id = process("/path/to/video.mp4")   # runs all stages, writes DB + clips.json
```

## Tests

```bash
python -m pytest clipper/tests -q
```

The logic phases (sentences, **boundaries**) are tested with fixture transcripts;
ingest/transcribe/render run real ffmpeg + faster-whisper (`tiny`) over
`say`-synthesized speech; the capstone E2E runs the whole pipeline with the LLM
faked (no API key needed). Media tests skip themselves if a binary is missing.
The live YouTube path runs with `CLIPPER_LIVE_YT_TEST=1`.

## Configuration

All tunables are env vars (prefix `CLIPPER_`) — see `.env.example`. Key ones:
ASR model/device, LLM model/effort, boundary padding + duration targets +
pause-gap threshold, `CLIPPER_VERTICAL` for 9:16.

## Stretch (TODO — not built)

- Active-speaker vertical crop (vs. center-crop blurred-fill)
- Karaoke / word-highlight captions
- YouTube caption fast-path (skip Whisper when good captions exist; `ingest.py`
  already fetches auto-subs to `autosub.en.vtt` as a signal)
- WhisperX forced alignment for tighter word boundaries on dense speech
- Hybrid structural+LLM segmentation for very long videos
- Render speed: per-clip accurate seek currently does a short pre-roll decode;
  fine for now, revisit for very long sources
