#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Subprocess helper for generating a pre-filled benefit application draft.

Reads a JSON payload from stdin:
  {"args": {...}, "workflow_output": "...", "output_dir": "..."}

Writes one of two JSON payloads to stdout:
  Success: {"path": "<absolute_path>", "form_type": "official"|"worksheet"}
  Failure: {"error": "<message>"}  (exit code 1)

No LLM calls are made. No user PII is logged.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    """Read stdin payload, call generate_application, write result to stdout."""
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        sys.stdout.write(json.dumps({"error": f"Invalid stdin JSON: {exc}"}) + "\n")
        sys.exit(1)

    args = payload.get("args", {})
    workflow_output = payload.get("workflow_output", "")
    output_dir_str = payload.get("output_dir", "")

    if not output_dir_str:
        sys.stdout.write(json.dumps({"error": "output_dir is required"}) + "\n")
        sys.exit(1)

    output_dir = Path(output_dir_str)

    try:
        from benefits_navigator.form_filler import generate_application

        path, form_type = generate_application(args, workflow_output, output_dir)
        sys.stdout.write(
            json.dumps({"path": str(path), "form_type": form_type}) + "\n"
        )
    except Exception as exc:  # noqa: BLE001 — broad catch to ensure JSON error output
        sys.stdout.write(json.dumps({"error": str(exc)}) + "\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
