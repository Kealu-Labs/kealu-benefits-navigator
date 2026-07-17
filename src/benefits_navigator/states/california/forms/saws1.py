#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""California SAWS-1 form definition — field mappings and FormDefinition factory."""

from __future__ import annotations

from pathlib import Path

from benefits_navigator.applications.models import FormDefinition

# ---------------------------------------------------------------------------
# Field mappings: canonical key → PDF AcroForm field name
# ---------------------------------------------------------------------------

# Text fields
SAWS1_TEXT_FIELDS: dict[str, str] = {
    "name": "applicant_name",
    "other_name": "applicant_name_other",
    "home_address": "applicant_home_address",
    "home_unit": "applicant_home_unit",
    "home_city": "applicant_home_city",
    "home_state": "applicant_home_state",
    "home_zip": "applicant_home_zip",
    "home_county": "applicant_home_county",
    "mailing_address": "applicant_mailing_address",
    "mailing_unit": "applicant_mailing_unit",
    "mailing_city": "applicant_mailing_city",
    "mailing_state": "applicant_mailing_state",
    "mailing_zip": "applicant_mailing_zip",
    "mailing_county": "applicant_mailing_county",
    "phone_home": "applicant_phone_home",
    "phone_alternate": "applicant_phone_alternate",
    "email": "applicant_email",
    "ssn": "applicant_ssn",
    "date": "applicant_date",
    "language_speak": "applicant_language_speak",
    "language_read": "applicant_language_read",
}

# Checkbox fields
SAWS1_CHECKBOX_FIELDS: dict[str, str] = {
    "apply_calfresh": "applicant_programs_1",
    "apply_medical": "applicant_programs_2",
    "apply_calworks": "applicant_programs_3",
}

# Template lives alongside the other state PDFs in the package forms/ directory
_TEMPLATE_PATH = Path(__file__).parent.parent.parent.parent / "forms" / "CA-SAWS-1.pdf"


def get_saws1_form_definition() -> FormDefinition:
    """Return the FormDefinition for the California SAWS-1."""
    return FormDefinition(
        form_id="CA-SAWS-1",
        version="2023",
        state="CA",
        supported_programs=["CalFresh", "Medi-Cal", "CalWORKs"],
        template_path=_TEMPLATE_PATH,
        text_fields=SAWS1_TEXT_FIELDS,
        checkbox_fields=SAWS1_CHECKBOX_FIELDS,
        required_profile_fields=frozenset({"home_zip", "home_state"}),
        optional_profile_fields=frozenset({
            "applicant_name", "phone_home", "home_address",
            "home_city", "email", "language_speak",
        }),
        # SSN and DOB are intentionally left blank for privacy — applicant fills by hand
        manual_fields=frozenset({"ssn", "date_of_birth"}),
        signature_fields=frozenset({"signature", "signature_date"}),
        agency_only_fields=frozenset({"case_number", "worker_name", "office_use"}),
        checkbox_export_value="/On",
    )
