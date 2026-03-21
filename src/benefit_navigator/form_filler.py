"""Fill official government benefit application PDFs when available.

Uses pypdf to fill AcroForm fields on real state application forms.
Falls back to the worksheet-style PDF when no official form is available
or when pypdf is not installed.

Template PDFs live in the ``forms/`` directory alongside this module.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_FORMS_DIR = Path(__file__).parent / "forms"

# ---------------------------------------------------------------------------
# Form registry — maps (state_code, program) to template + field mapping
# ---------------------------------------------------------------------------

# Field mapping: our canonical key → PDF AcroForm field name
_CA_SAWS1_FIELDS: dict[str, str] = {
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

# Checkbox fields: our key → PDF field name
_CA_SAWS1_CHECKBOXES: dict[str, str] = {
    "apply_calfresh": "applicant_programs_1",
    "apply_medical": "applicant_programs_2",
    "apply_calworks": "applicant_programs_3",
}

# Illinois IL444-2378B — combined Cash/Medical/SNAP application
# XFA-style field names with Form[0].#subform[N] prefix
_IL_2378B_FIELDS: dict[str, str] = {
    "home_address": "Form[0].#subform[0].Address[0]",
    "mailing_address": "Form[0].#subform[0].Address[1]",
    "home_city": "Form[0].#subform[0].City[1]",
    "home_zip": "Form[0].#subform[0].City[0]",
    "home_county": "Form[0].#subform[0].TextField1[4]",
    "mailing_city": "Form[0].#subform[0].City[4]",
    "mailing_zip": "Form[0].#subform[0].City[3]",
    "mailing_county": "Form[0].#subform[0].TextField1[5]",
    "home_state": "Form[0].#subform[0].State[0]",
    "mailing_state": "Form[0].#subform[0].State[1]",
    "date": "Form[0].#subform[0].DateTimeField1[0]",
    "first_name": "Form[0].#subform[0].TextField1[2]",
    "last_name": "Form[0].#subform[0].TextField1[3]",
    "phone_home": "Form[0].#subform[0].TextField2[2]",
    "phone_work": "Form[0].#subform[0].TextField2[1]",
}

# New York LDSS-4826-DD — SNAP Application/Recertification (fillable/accessible)
_NY_4826_FIELDS: dict[str, str] = {
    "first_name": "3 First Name",
    "last_name": "3 Last Name",
    "home_address": "4 Address where you live (do not give P. box). box)",
    "home_city": "4 City/Town/Village",
    "home_county": "4 County",
    "home_zip": "4 Zip Code",
    "mailing_address": "5 Address where you get your mail (if different than above)",
    "mailing_zip": "5 Zip Code",
    "phone_home": "8 Telephone (optional)",
    "email": "8 Email (optional)",
    "language_speak": "What is the Individuals primary language spoken?1",
}

# Pennsylvania PA-600 — combined Cash/Healthcare/SNAP application
_PA_600_FIELDS: dict[str, str] = {
    "name": "Applicant Name",
    "home_address": "Applicant Home Address",
    "mailing_address": "Mailing address",
    "home_county": "County",
    "how_long_at_address": "How long have you lived at this address?",
}

_FORM_REGISTRY: dict[str, dict[str, Any]] = {
    "CA": {
        "template": "CA-SAWS-1.pdf",
        "name": "SAWS-1 (CalFresh / Medi-Cal / CalWORKs)",
        "text_fields": _CA_SAWS1_FIELDS,
        "checkboxes": _CA_SAWS1_CHECKBOXES,
        "programs": ["CalFresh (SNAP)", "Medi-Cal (Medicaid)", "CalWORKs (TANF)"],
    },
    "IL": {
        "template": "IL-444-2378B.pdf",
        "name": "IL444-2378B (Cash / Medical / SNAP combined)",
        "text_fields": _IL_2378B_FIELDS,
        "checkboxes": {},
        "programs": ["SNAP", "Medicaid", "TANF (Cash Assistance)"],
    },
    "NY": {
        "template": "NY-LDSS-4826-DD.pdf",
        "name": "LDSS-4826-DD (SNAP Application/Recertification)",
        "text_fields": _NY_4826_FIELDS,
        "checkboxes": {},
        "programs": ["SNAP"],
    },
    "PA": {
        "template": "PA-600.pdf",
        "name": "PA-600 (Cash / Healthcare / SNAP combined)",
        "text_fields": _PA_600_FIELDS,
        "checkboxes": {},
        "programs": ["SNAP", "Medicaid", "TANF (Cash Assistance)"],
    },
}


def get_available_states() -> list[str]:
    """Return state codes that have official form templates."""
    return [
        code
        for code, info in _FORM_REGISTRY.items()
        if (_FORMS_DIR / info["template"]).exists()
    ]


def has_official_form(state: str) -> bool:
    """Check whether an official fillable form exists for *state*."""
    info = _FORM_REGISTRY.get(state.upper())
    if not info:
        return False
    return (_FORMS_DIR / info["template"]).exists()


# ---------------------------------------------------------------------------
# Data extraction — reuses patterns from pdf_generator but maps to form keys
# ---------------------------------------------------------------------------


def _extract_form_data(args: dict[str, Any]) -> dict[str, str]:
    """Map tool arguments to canonical form field keys."""
    profile = args.get("household_profile", "")
    data: dict[str, str] = {}

    # Date
    data["date"] = datetime.now(tz=timezone.utc).strftime("%m/%d/%Y")

    # State
    state = args.get("state", "")
    if state:
        data["home_state"] = state
        data["mailing_state"] = state

    # ZIP
    zip_code = args.get("zip_code", "")
    zip_match = re.search(r"\b(\d{5})\b", zip_code or profile)
    if zip_match:
        data["home_zip"] = zip_match.group(1)
        data["mailing_zip"] = zip_match.group(1)

    # County
    county = args.get("county", "")
    if county:
        data["home_county"] = county.replace(" County", "")
        data["mailing_county"] = county.replace(" County", "")

    # Language — default English
    data["language_speak"] = "English"
    data["language_read"] = "English"

    return data


def _determine_checkboxes(
    args: dict[str, Any],
    workflow_output: str,
) -> dict[str, bool]:
    """Determine which program checkboxes to check based on workflow output."""
    output_upper = workflow_output.upper()
    checks: dict[str, bool] = {}

    # CalFresh (SNAP)
    checks["apply_calfresh"] = any(
        kw in output_upper for kw in ["SNAP", "CALFRESH", "FOOD STAMP"]
    )
    # Medi-Cal (Medicaid)
    checks["apply_medical"] = any(
        kw in output_upper for kw in ["MEDICAID", "MEDI-CAL", "CHIP"]
    )
    # CalWORKs (TANF)
    checks["apply_calworks"] = any(
        kw in output_upper for kw in ["TANF", "CALWORKS", "CASH ASSISTANCE"]
    )

    return checks


# ---------------------------------------------------------------------------
# PDF form filling
# ---------------------------------------------------------------------------


def fill_official_form(
    args: dict[str, Any],
    workflow_output: str,
    output_dir: Path | None = None,
) -> Path | None:
    """Fill the official state application form if available.

    Returns the path to the filled PDF, or ``None`` if no form is available
    or pypdf is not installed.
    """
    state = (args.get("state") or "").upper()
    if state not in _FORM_REGISTRY:
        return None

    info = _FORM_REGISTRY[state]
    template_path = _FORMS_DIR / info["template"]
    if not template_path.exists():
        logger.warning("Template %s not found", template_path)
        return None

    try:
        from pypdf import PdfReader, PdfWriter
        from pypdf.generic import NameObject
    except ImportError:
        logger.info("pypdf not installed — falling back to worksheet")
        return None

    if output_dir is None:
        output_dir = Path.home() / "Documents" / "benefit-applications"
    output_dir.mkdir(parents=True, exist_ok=True)

    reader = PdfReader(str(template_path))
    writer = PdfWriter()
    writer.append(reader)

    # Fill text fields
    form_data = _extract_form_data(args)
    text_mapping = info["text_fields"]

    field_values: dict[str, str] = {}
    for our_key, pdf_field in text_mapping.items():
        if our_key in form_data and form_data[our_key]:
            field_values[pdf_field] = form_data[our_key]

    # Apply text fields to all pages (fields may span pages)
    for page in writer.pages:
        writer.update_page_form_field_values(page, field_values, auto_regenerate=False)

    # Fill checkboxes by directly setting /V and /AS on annotation objects
    checkbox_states = _determine_checkboxes(args, workflow_output)
    checkbox_mapping = info.get("checkboxes", {})
    fields_to_check: set[str] = set()
    for our_key, pdf_field in checkbox_mapping.items():
        if checkbox_states.get(our_key, False):
            fields_to_check.add(pdf_field)

    if fields_to_check:
        for page in writer.pages:
            annots = page.get("/Annots", [])
            for annot in annots:
                obj = annot.get_object()
                field_name = str(obj.get("/T", ""))
                if field_name in fields_to_check:
                    obj[NameObject("/V")] = NameObject("/On")
                    obj[NameObject("/AS")] = NameObject("/On")

    timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
    zip_code = form_data.get("home_zip", "unknown")
    filename = f"benefit-application-{state}-{zip_code}-{timestamp}.pdf"
    output_path = output_dir / filename
    writer.write(str(output_path))

    return output_path


# ---------------------------------------------------------------------------
# Public API — unified entry point with fallback
# ---------------------------------------------------------------------------


def generate_application(
    args: dict[str, Any],
    workflow_output: str,
    output_dir: Path | None = None,
) -> tuple[Path, str]:
    """Generate a benefit application PDF.

    Tries to fill an official state form first. Falls back to the
    worksheet-style PDF if no official form is available.

    Returns
    -------
    (path, form_type) where form_type is ``"official"`` or ``"worksheet"``.
    """
    # Try official form first
    path = fill_official_form(args, workflow_output, output_dir)
    if path is not None:
        return path, "official"

    # Fall back to worksheet
    from benefit_navigator.pdf_generator import generate_application_pdf

    path = generate_application_pdf(args, workflow_output, output_dir)
    return path, "worksheet"
