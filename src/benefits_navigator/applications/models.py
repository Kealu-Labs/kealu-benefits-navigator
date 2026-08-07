#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Canonical typed models for a benefits application profile and form definitions."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Values an applicant may give to decline an optional intake question.
# Stored verbatim on the profile so intake knows the question was answered,
# but converted to blank before any value reaches a generated form.
SKIP_SENTINELS: frozenset[str] = frozenset({"skip", "none", "n/a", "na"})


def is_skip_sentinel(value: str) -> bool:
    """True when *value* is an explicit decline-to-answer sentinel."""
    return value.strip().lower() in SKIP_SENTINELS


@dataclass
class ApplicationProfile:
    """Shared, strongly-typed representation of a benefits application.

    Common fields (identity, address, language, program selections) are
    declared here. State-specific answers that apply only to one state's forms
    belong in ``state_answers``, namespaced by state code, e.g.
    ``{"ca.other_name": "..."}``.
    """

    # Identity
    applicant_name: str = ""
    phone_home: str = ""
    email: str = ""

    # Home address
    home_address: str = ""
    home_city: str = ""
    home_state: str = ""
    home_zip: str = ""
    home_county: str = ""

    # Mailing address (optional; blank means "same as home")
    mailing_address: str = ""
    mailing_city: str = ""
    mailing_state: str = ""
    mailing_zip: str = ""
    mailing_county: str = ""

    # Language
    language_speak: str = ""
    language_read: str = ""

    # Program selections (used for PDF checkbox filling)
    apply_calfresh: bool = False
    apply_medical: bool = False
    apply_calworks: bool = False

    # Whether the applicant confirmed the review screen
    review_confirmed: bool = False

    # State-specific extension: keys namespaced by state code
    state_answers: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_args(cls, args: dict[str, Any]) -> ApplicationProfile:
        """Build a profile from the flat args dict used by MCP tool calls."""
        return cls(
            applicant_name=str(args.get("applicant_name") or args.get("name") or "").strip(),
            phone_home=str(args.get("phone_home") or "").strip(),
            email=str(args.get("email") or "").strip(),
            home_address=str(args.get("home_address") or "").strip(),
            home_city=str(args.get("home_city") or "").strip(),
            home_state=str(args.get("home_state") or args.get("state") or "").strip().upper(),
            home_zip=str(args.get("home_zip") or args.get("zip_code") or "").strip(),
            home_county=str(args.get("home_county") or args.get("county") or "").strip(),
            mailing_address=str(args.get("mailing_address") or "").strip(),
            mailing_city=str(args.get("mailing_city") or "").strip(),
            mailing_state=str(args.get("mailing_state") or "").strip().upper(),
            mailing_zip=str(args.get("mailing_zip") or "").strip(),
            mailing_county=str(args.get("mailing_county") or "").strip(),
            language_speak=str(args.get("language_speak") or "").strip(),
            language_read=str(args.get("language_read") or "").strip(),
            apply_calfresh=bool(args.get("apply_calfresh", False)),
            apply_medical=bool(args.get("apply_medical", False)),
            apply_calworks=bool(args.get("apply_calworks", False)),
            review_confirmed=bool(args.get("ca_review_confirmed", False)),
        )

    def to_args(self) -> dict[str, Any]:
        """Convert back to a flat args dict for compatibility with form_filler.

        Skip sentinels (e.g. an applicant answering "skip" to an optional
        question) are converted to blanks so they never appear on a form.
        """

        def _clean(value: str) -> str:
            return "" if is_skip_sentinel(value) else value

        return {
            "applicant_name": _clean(self.applicant_name),
            "name": _clean(self.applicant_name),
            "phone_home": _clean(self.phone_home),
            "email": _clean(self.email),
            "home_address": _clean(self.home_address),
            "home_city": _clean(self.home_city),
            "state": self.home_state,
            "home_state": self.home_state,
            "zip_code": self.home_zip,
            "home_zip": self.home_zip,
            "county": self.home_county,
            "home_county": self.home_county,
            "mailing_address": _clean(self.mailing_address),
            "mailing_city": _clean(self.mailing_city),
            "mailing_state": self.mailing_state,
            "mailing_zip": self.mailing_zip,
            "mailing_county": _clean(self.mailing_county),
            "language_speak": _clean(self.language_speak),
            "language_read": _clean(self.language_read),
            "apply_calfresh": self.apply_calfresh,
            "apply_medical": self.apply_medical,
            "apply_calworks": self.apply_calworks,
        }


@dataclass
class FormDefinition:
    """Describes an official government application form.

    Separates form metadata from the fill logic so that a form can be
    described, inspected, and tested independently of pypdf.
    """

    form_id: str                              # e.g. "CA-SAWS-1"
    version: str                              # e.g. "2023"
    state: str                                # two-letter state code
    supported_programs: list[str]             # human-readable program names
    template_path: Path                       # absolute path to PDF template
    text_fields: dict[str, str]               # canonical_key → pdf_field_name
    checkbox_fields: dict[str, str]           # canonical_key → pdf_field_name
    required_profile_fields: frozenset[str]   # ApplicationProfile attrs that must be set
    optional_profile_fields: frozenset[str]   # ApplicationProfile attrs included when present
    manual_fields: frozenset[str]             # fields applicant fills by hand (e.g. SSN, DOB)
    signature_fields: frozenset[str]          # fields requiring wet signature
    agency_only_fields: frozenset[str]        # fields completed by agency staff
    checkbox_export_value: str = "/On"        # AcroForm export value for a checked checkbox
