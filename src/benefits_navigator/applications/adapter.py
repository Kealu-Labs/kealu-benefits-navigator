#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""StateApplicationAdapter — structural Protocol every state adapter must satisfy."""

from __future__ import annotations

from pathlib import Path
from typing import Protocol, runtime_checkable

from benefits_navigator.applications.models import ApplicationProfile, FormDefinition


@runtime_checkable
class StateApplicationAdapter(Protocol):
    """Interface every state adapter must satisfy.

    The MCP layer and shared application logic depend only on this protocol.
    No concrete state module (e.g. ``states.california``) is imported at the
    shared layer — adapters are resolved at runtime through the registry.
    """

    state_code: str          # normalized two-letter code, e.g. "CA"
    display_name: str        # human-readable form title, e.g. "California SAWS-1 Application"
    supported_programs: list[str]

    def missing_intake_questions(self, profile: ApplicationProfile) -> list[dict]:
        """Return ordered list of unanswered intake questions.

        Each dict has keys: key, label, why, prompt, example, required.
        Returns an empty list when all required questions are answered.
        """
        ...

    def readiness_blockers(self, profile: ApplicationProfile) -> list[dict]:
        """Return blocking issues that prevent document generation.

        Each dict has keys: key, label, prompt.
        Returns an empty list when the profile is ready.
        """
        ...

    def review_summary(self, profile: ApplicationProfile) -> str:
        """Return a markdown review/confirmation screen for the applicant."""
        ...

    def applicable_forms(self, profile: ApplicationProfile) -> list[FormDefinition]:
        """Return form definitions that apply to this profile."""
        ...

    def generate_documents(
        self,
        profile: ApplicationProfile,
        workflow_output: str,
        output_dir: Path | None,
    ) -> tuple[Path, str]:
        """Generate application documents.

        Returns ``(path, form_type)`` where ``form_type`` is ``"official"``
        for a filled government PDF or ``"worksheet"`` for the fallback.
        """
        ...

    def submission_instructions(self, profile: ApplicationProfile) -> str:
        """Return markdown submission instructions for the applicant."""
        ...
