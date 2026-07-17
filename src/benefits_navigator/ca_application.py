#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Backward-compatibility shim for the California SAWS-1 intake module.

The canonical implementation lives in:
    src/benefits_navigator/states/california/intake.py
    src/benefits_navigator/states/california/submission.py

This module re-exports the public API with the original args-dict signatures so
that existing tests and callers continue to work without modification.
"""

from __future__ import annotations

from typing import Any

from benefits_navigator.applications.models import ApplicationProfile
from benefits_navigator.applications.readiness import format_intake_question
from benefits_navigator.states.california.intake import (
    CA_APPLICATION_FIELDS,
    CA_MINIMUM_REQUIRED_KEYS,
    check_ca_readiness as _check_readiness,
    format_ca_review_summary as _format_review,
    get_next_ca_field as _get_next_field,
)
from benefits_navigator.states.california.submission import CA_SUBMISSION_INSTRUCTIONS

__all__ = [
    "CA_APPLICATION_FIELDS",
    "CA_MINIMUM_REQUIRED_KEYS",
    "CA_SUBMISSION_INSTRUCTIONS",
    "check_ca_readiness",
    "format_ca_application_field",
    "format_ca_review_summary",
    "get_next_ca_field",
]


def check_ca_readiness(args: dict[str, Any]) -> list[dict[str, str]]:
    """Return blocking issues for *args*. Empty list means ready for generation."""
    return _check_readiness(ApplicationProfile.from_args(args))


def get_next_ca_field(args: dict[str, Any]) -> dict[str, str] | None:
    """Return the next unanswered CA intake field dict, or None when all answered."""
    return _get_next_field(ApplicationProfile.from_args(args))


def format_ca_application_field(field: dict[str, str]) -> str:
    """Format a CA intake field dict into a human-readable prompt block."""
    return format_intake_question(field)


def format_ca_review_summary(args: dict[str, Any]) -> str:
    """Render collected CA fields as a markdown review/confirmation table."""
    return _format_review(ApplicationProfile.from_args(args))
