"""Clipper stage — YouTube/MP4 → self-contained, sentence-aligned video clips.

This package is one stage in a larger pipeline. It ingests a video, transcribes
it to word-level timestamps, segments it into self-contained moments, snaps the
moment boundaries to natural pauses (never mid-sentence), renders clips, and
labels them. Each stage writes a JSON artifact to the job directory so the
pipeline is resumable.
"""

__version__ = "0.1.0"
