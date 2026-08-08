#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""CaliforniaAdapter — implements StateApplicationAdapter for SAWS-1 generation."""

from __future__ import annotations

from pathlib import Path

from benefits_navigator.applications.models import ApplicationProfile, FormDefinition
from benefits_navigator.states.california.forms.saws1 import get_saws1_form_definition
from benefits_navigator.states.california.intake import (
    check_ca_readiness,
    format_ca_review_summary,
    get_next_ca_field,
)
from benefits_navigator.states.california.submission import CA_SUBMISSION_INSTRUCTIONS


class CaliforniaAdapter:
    """Implements the StateApplicationAdapter protocol for California SAWS-1."""

    state_code = "CA"
    display_name = "California SAWS-1 Application"
    supported_programs = ["CalFresh", "Medi-Cal", "CalWORKs"]

    def missing_intake_questions(self, profile: ApplicationProfile) -> list[dict]:
        """Return a list containing the next unanswered CA intake field, or empty."""
        field = get_next_ca_field(profile)
        return [field] if field is not None else []

    def readiness_blockers(self, profile: ApplicationProfile) -> list[dict]:
        """Return blocking issues (missing ZIP or non-CA state)."""
        return check_ca_readiness(profile)

    def review_summary(self, profile: ApplicationProfile) -> str:
        """Return the SAWS-1 review confirmation screen."""
        return format_ca_review_summary(profile)

    def applicable_forms(self, profile: ApplicationProfile) -> list[FormDefinition]:
        """Return the SAWS-1 form definition."""
        return [get_saws1_form_definition()]

    def generate_documents(
        self,
        profile: ApplicationProfile,
        workflow_output: str,
        output_dir: Path | None,
    ) -> tuple[Path, str]:
        """Fill the SAWS-1 PDF via form_filler and return (path, form_type)."""
        # Lazy import avoids a circular dependency: form_filler imports saws1.py
        # for its constants at module load time; if adapter imported form_filler
        # at the top it would create a circular chain through states/__init__.py.
        from benefits_navigator import form_filler
        return form_filler.generate_application(profile.to_args(), workflow_output, output_dir)

    def submission_instructions(self, profile: ApplicationProfile) -> str:
        return CA_SUBMISSION_INSTRUCTIONS
