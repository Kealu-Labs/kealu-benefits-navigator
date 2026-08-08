#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Regression tests: skip sentinels must never appear on generated documents.

These are plain pytest tests (not pytest-bdd) because they assert on the
actual bytes/fields of generated PDFs — the contract the review screen makes
("skipped — will be left blank") with the applicant.
"""

from __future__ import annotations

import pytest

pypdf = pytest.importorskip("pypdf")

from benefits_navigator.form_filler import generate_application  # noqa: E402

WORKFLOW_OUTPUT = "Eligible programs: Medicaid (Medi-Cal), SNAP (CalFresh)."

SENTINEL_ARGS = {
    "household_profile": "2 adults, 1 child age 4, income $42,000/year",
    "state": "CA",
    "zip_code": "90012",
    "county": "Los Angeles County",
    "applicant_name": "Jane Marie Smith",
    "phone_home": "skip",
    "home_address": "n/a",
    "home_city": "none",
    "email": "none",
    "language_speak": "skip",
}


def _dump_field_values(path) -> dict[str, str]:
    reader = pypdf.PdfReader(str(path))
    return {
        name: str(field.get("/V") or "")
        for name, field in (reader.get_fields() or {}).items()
    }


@pytest.mark.allow_log_output  # pypdf warns "No fields to update" on field-less pages
def test_official_form_never_contains_sentinels(tmp_path):
    path, form_type = generate_application(
        dict(SENTINEL_ARGS), WORKFLOW_OUTPUT, tmp_path
    )
    assert form_type == "official"

    values = _dump_field_values(path)
    filled = {k: v for k, v in values.items() if v}
    for field_name, value in filled.items():
        assert value.strip().lower() not in {"skip", "none", "n/a", "na"}, (
            f"sentinel {value!r} written to official form field {field_name!r}"
        )


@pytest.mark.allow_log_output  # pypdf warns "No fields to update" on field-less pages
def test_skipped_language_is_not_asserted_as_english(tmp_path):
    path, form_type = generate_application(
        dict(SENTINEL_ARGS), WORKFLOW_OUTPUT, tmp_path
    )
    assert form_type == "official"

    values = _dump_field_values(path)
    assert values.get("applicant_language_speak", "") == "", (
        "language was skipped by the applicant but the form asserts "
        f"{values['applicant_language_speak']!r}"
    )
    assert values.get("applicant_language_read", "") == "", (
        "language_read was never asked but the form asserts "
        f"{values['applicant_language_read']!r}"
    )


@pytest.mark.allow_log_output  # pypdf warns "No fields to update" on field-less pages
def test_signature_date_left_blank_on_official_form(tmp_path):
    path, form_type = generate_application(
        dict(SENTINEL_ARGS), WORKFLOW_OUTPUT, tmp_path
    )
    assert form_type == "official"

    values = _dump_field_values(path)
    assert values.get("applicant_date", "") == "", (
        "the SAWS-1 signature-date field must be left for the applicant, "
        f"but was pre-filled with {values['applicant_date']!r}"
    )


def test_worksheet_renders_collected_intake_answers(tmp_path):
    # Texas has no official template -> worksheet fallback path.
    args = dict(SENTINEL_ARGS)
    args.update({
        "state": "TX",
        "zip_code": "77001",
        "phone_home": "(555) 123-4567",
        "home_city": "Houston",
        "email": "jane@example.com",
        "home_address": "123 Main Street",
    })
    path, form_type = generate_application(args, WORKFLOW_OUTPUT, tmp_path)
    assert form_type == "worksheet"

    # Worksheet content streams are uncompressed latin-1 text (see
    # test_application_draft for the same technique).
    raw = path.read_bytes().decode("latin-1", errors="ignore")
    # NOTE: parentheses are backslash-escaped in PDF text streams, so expected
    # substrings must avoid them (e.g. the phone's area code).
    for expected in (
        "Jane Marie Smith",
        "123-4567",
        "jane@example.com",
        "123 Main Street",
        "42,000",
    ):
        assert expected in raw, f"worksheet is missing intake answer {expected!r}"


def test_worksheet_never_contains_sentinels(tmp_path):
    args = dict(SENTINEL_ARGS)
    args["state"] = "TX"
    path, form_type = generate_application(args, WORKFLOW_OUTPUT, tmp_path)
    assert form_type == "worksheet"

    raw = path.read_bytes().decode("latin-1", errors="ignore")
    for line in raw.splitlines():
        lowered = line.strip().lower()
        # Field-value lines render as "Label:  value"; a bare sentinel after
        # the label means a decline leaked through.
        for sentinel in ("skip", "n/a"):
            assert not lowered.endswith(f":  {sentinel}"), (
                f"sentinel leaked into worksheet line {line!r}"
            )
