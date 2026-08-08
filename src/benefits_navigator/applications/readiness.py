#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Shared readiness utilities used by state adapters and the MCP layer."""

from __future__ import annotations


def format_intake_question(field: dict) -> str:
    """Format a field descriptor dict into a human-readable prompt block.

    Works with any field dict that has the standard keys:
    ``label``, ``why``, ``prompt``, ``example``, ``required``.
    """
    required_marker = " *(required)*" if field.get("required") == "true" else ""
    lines = [
        f"**{field['label']}{required_marker}**",
        f"*{field['why']}*",
        "",
        field["prompt"],
        "",
        f"Example: {field['example']}",
    ]
    if field.get("key"):
        skip_hint = (
            ""
            if field.get("required") == "true"
            else ' (or "skip" to leave it blank)'
        )
        lines += [
            "",
            f"When calling this tool again, pass the applicant's answer as "
            f"the `{field['key']}` argument{skip_hint}, along with all "
            f"previously collected answers.",
        ]
    return "\n".join(lines)
