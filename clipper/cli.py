"""CLI: clip a YouTube URL or a local MP4 into self-contained clips.

    python -m clipper "https://youtube.com/watch?v=..."
    python -m clipper /path/to/video.mp4 --force segment,boundaries
"""

from __future__ import annotations

import argparse
import asyncio
from typing import Optional, Sequence

from .pipeline.orchestrator import STAGES, create_job, run_pipeline


def main(argv: Optional[Sequence[str]] = None) -> int:
    p = argparse.ArgumentParser(prog="clipper", description=__doc__)
    p.add_argument("source", help="YouTube URL or path to an .mp4 file")
    p.add_argument(
        "--force",
        default="",
        help="comma-separated stages to recompute: " + ",".join(STAGES),
    )
    args = p.parse_args(argv)

    force = {s.strip() for s in args.force.split(",") if s.strip()}
    bad = force - set(STAGES)
    if bad:
        p.error(f"unknown stage(s): {', '.join(sorted(bad))}")

    job_id = create_job(args.source)
    print(f"job: {job_id}")
    records = asyncio.run(run_pipeline(job_id, force=force))
    print(f"done: {len(records)} clips")
    for r in records:
        print(f"  {r['id']}  {r['start']:.1f}-{r['end']:.1f}s  score={r['score']:.2f}  {r['title']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
