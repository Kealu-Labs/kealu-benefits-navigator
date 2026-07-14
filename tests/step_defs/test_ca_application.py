#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""Step definitions for ca_application.feature.

Tests cover:
- check_ca_readiness — readiness gate for SAWS-1 generation
- get_next_ca_field — field-by-field personal-detail collection
- _run_generate_application_draft — end-to-end CA intake via MCP tool
- _extract_form_data — field mapping from tool args to PDF keys
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any
from unittest.mock import patch

from pytest_bdd import given, parsers, scenario, then, when

from benefits_navigator.ca_application import (
    check_ca_readiness,
    get_next_ca_field,
)
from benefits_navigator.form_filler import _extract_form_data
from benefits_navigator.mcp_server import _execute_tool

# ---------------------------------------------------------------------------
# Scenario bindings
# ---------------------------------------------------------------------------


@scenario("../features/ca_application.feature", "Readiness check fails when ZIP code is missing")
def test_readiness_missing_zip():
    pass


@scenario("../features/ca_application.feature", "Readiness check fails when state is not California")
def test_readiness_wrong_state():
    pass


@scenario("../features/ca_application.feature", "Readiness check passes when ZIP and CA state are provided")
def test_readiness_passes():
    pass


@scenario("../features/ca_application.feature", "First unanswered field is applicant_name when nothing is provided")
def test_next_field_first():
    pass


@scenario("../features/ca_application.feature", "Next unanswered field is phone_home when applicant_name is provided")
def test_next_field_after_name():
    pass


@scenario("../features/ca_application.feature", "No next field when all CA application fields are answered")
def test_no_next_field():
    pass


@scenario("../features/ca_application.feature", "CA draft without applicant_name prompts for full legal name")
def test_ca_draft_prompts_for_name():
    pass


@scenario("../features/ca_application.feature", "CA draft with all personal details shows review screen before PDF")
def test_ca_draft_shows_review_screen():
    pass


@scenario("../features/ca_application.feature", "CA draft generates SAWS-1 PDF after review is confirmed")
def test_ca_draft_generates_pdf():
    pass


@scenario("../features/ca_application.feature", "Non-CA state bypasses CA intake and returns worksheet")
def test_non_ca_state_worksheet():
    pass


@scenario("../features/ca_application.feature", "applicant_name arg is mapped to the name form field key")
def test_extract_applicant_name():
    pass


@scenario("../features/ca_application.feature", "phone_home arg is mapped to the phone_home form field key")
def test_extract_phone_home():
    pass


@scenario("../features/ca_application.feature", "home_address arg is mapped to the home_address form field key")
def test_extract_home_address():
    pass


@scenario("../features/ca_application.feature", "home_city arg is mapped to the home_city form field key")
def test_extract_home_city():
    pass


@scenario("../features/ca_application.feature", "email arg is mapped to the email form field key")
def test_extract_email():
    pass


@scenario("../features/ca_application.feature", "language_speak arg overrides the default English")
def test_extract_language_speak():
    pass


# ---------------------------------------------------------------------------
# Shared context
# ---------------------------------------------------------------------------


class CaContext:
    def __init__(self):
        self.args: dict[str, Any] = {}
        self.blockers: list[dict[str, str]] = []
        self.next_field: dict[str, str] | None = None
        self.tool_result: str = ""
        self.form_data: dict[str, str] = {}
        self.output_dir: Path = Path(tempfile.mkdtemp())


# ---------------------------------------------------------------------------
# check_ca_readiness given steps
# ---------------------------------------------------------------------------


@given("California application args with state \"CA\" but no ZIP code", target_fixture="ctx")
def given_ca_no_zip():
    ctx = CaContext()
    ctx.args = {
        "household_profile": "Single parent, 2 kids",
        "state": "CA",
    }
    return ctx


@given(parsers.parse('California application args with zip code "{zip_code}" and state "{state}"'), target_fixture="ctx")
def given_ca_zip_and_state(zip_code, state):
    ctx = CaContext()
    ctx.args = {
        "household_profile": "Single parent, 2 kids",
        "zip_code": zip_code,
        "state": state,
    }
    return ctx


# ---------------------------------------------------------------------------
# get_next_ca_field given steps
# ---------------------------------------------------------------------------


@given("empty California application args", target_fixture="ctx")
def given_empty_args():
    ctx = CaContext()
    ctx.args = {}
    return ctx


@given(parsers.parse('California application args with applicant_name "{name}"'), target_fixture="ctx")
def given_args_with_name(name):
    ctx = CaContext()
    ctx.args = {"applicant_name": name}
    return ctx


@given("California application args with all fields answered", target_fixture="ctx")
def given_all_fields():
    ctx = CaContext()
    ctx.args = {
        "applicant_name": "Jane Marie Smith",
        "phone_home": "(555) 123-4567",
        "home_address": "123 Main Street",
        "home_city": "Los Angeles",
        "email": "jane@example.com",
        "language_speak": "English",
    }
    return ctx


# ---------------------------------------------------------------------------
# generate_application_draft given steps
# ---------------------------------------------------------------------------

_CA_WORKFLOW_OUTPUT = (
    "## Eligibility Results\n"
    "- CalFresh (SNAP): LIKELY ELIGIBLE\n"
    "- Medi-Cal: ELIGIBLE for children\n"
    "- CalWORKs: May be eligible\n"
)


@given("a CA generate_application_draft request without personal details", target_fixture="ctx")
def given_ca_request_no_details():
    ctx = CaContext()
    ctx.args = {
        "household_profile": "Single parent, 2 kids, $42k income",
        "state": "CA",
        "zip_code": "90001",
        "workflow_output": _CA_WORKFLOW_OUTPUT,
    }
    return ctx


@given("a CA generate_application_draft request with all personal details", target_fixture="ctx")
def given_ca_request_all_details(tmp_path):
    ctx = CaContext()
    ctx.output_dir = tmp_path
    ctx.args = {
        "household_profile": "Single parent, 2 kids, $42k income",
        "state": "CA",
        "zip_code": "90001",
        "county": "Los Angeles County",
        "workflow_output": _CA_WORKFLOW_OUTPUT,
        "applicant_name": "Jane Marie Smith",
        "phone_home": "(555) 123-4567",
        "home_address": "123 Main Street, Apt 4B",
        "home_city": "Los Angeles",
        "email": "jane@example.com",
        "language_speak": "English",
    }
    return ctx


@given("a CA generate_application_draft request with all personal details confirmed", target_fixture="ctx")
def given_ca_request_all_details_confirmed(tmp_path):
    ctx = CaContext()
    ctx.output_dir = tmp_path
    ctx.args = {
        "household_profile": "Single parent, 2 kids, $42k income",
        "state": "CA",
        "zip_code": "90001",
        "county": "Los Angeles County",
        "workflow_output": _CA_WORKFLOW_OUTPUT,
        "applicant_name": "Jane Marie Smith",
        "phone_home": "(555) 123-4567",
        "home_address": "123 Main Street, Apt 4B",
        "home_city": "Los Angeles",
        "email": "jane@example.com",
        "language_speak": "English",
        "ca_review_confirmed": True,
    }
    return ctx


@given("a Texas generate_application_draft request", target_fixture="ctx")
def given_texas_request(tmp_path):
    ctx = CaContext()
    ctx.output_dir = tmp_path
    ctx.args = {
        "household_profile": "Single parent, 2 kids, $42k income",
        "state": "TX",
        "zip_code": "77001",
        "county": "Harris County",
        "workflow_output": (
            "## Eligibility Results\n"
            "- SNAP: LIKELY ELIGIBLE\n"
            "- CHIP: ELIGIBLE for children\n"
        ),
    }
    return ctx


# ---------------------------------------------------------------------------
# _extract_form_data given steps
# ---------------------------------------------------------------------------


@given(parsers.parse('form args with applicant_name "{name}"'), target_fixture="ctx")
def given_form_args_name(name):
    ctx = CaContext()
    ctx.args = {"applicant_name": name, "state": "CA", "zip_code": "90001"}
    return ctx


@given(parsers.parse('form args with phone_home "{phone}"'), target_fixture="ctx")
def given_form_args_phone(phone):
    ctx = CaContext()
    ctx.args = {"phone_home": phone}
    return ctx


@given(parsers.parse('form args with home_address "{address}"'), target_fixture="ctx")
def given_form_args_address(address):
    ctx = CaContext()
    ctx.args = {"home_address": address}
    return ctx


@given(parsers.parse('form args with home_city "{city}"'), target_fixture="ctx")
def given_form_args_city(city):
    ctx = CaContext()
    ctx.args = {"home_city": city}
    return ctx


@given(parsers.parse('form args with email "{email}"'), target_fixture="ctx")
def given_form_args_email(email):
    ctx = CaContext()
    ctx.args = {"email": email}
    return ctx


@given(parsers.parse('form args with language_speak "{language}"'), target_fixture="ctx")
def given_form_args_language(language):
    ctx = CaContext()
    ctx.args = {"language_speak": language}
    return ctx


# ---------------------------------------------------------------------------
# When steps
# ---------------------------------------------------------------------------


@when("check_ca_readiness is called")
def when_check_ca_readiness(ctx):
    ctx.blockers = check_ca_readiness(ctx.args)


@when("get_next_ca_field is called")
def when_get_next_ca_field(ctx):
    ctx.next_field = get_next_ca_field(ctx.args)


@when("generate_application_draft is executed")
def when_generate_application_draft(ctx):
    ctx.tool_result = _execute_tool("generate_application_draft", ctx.args)


@when("_extract_form_data is called")
def when_extract_form_data(ctx):
    ctx.form_data = _extract_form_data(ctx.args)


# ---------------------------------------------------------------------------
# Then steps — check_ca_readiness
# ---------------------------------------------------------------------------


@then(parsers.parse('the blockers list contains a "{key}" entry'))
def then_blockers_contains(ctx, key):
    keys = [b["key"] for b in ctx.blockers]
    assert key in keys, (
        f"Expected blockers to contain '{key}', got keys: {keys}"
    )


@then("the blockers list is empty")
def then_blockers_empty(ctx):
    assert ctx.blockers == [], (
        f"Expected empty blockers list, got: {ctx.blockers}"
    )


# ---------------------------------------------------------------------------
# Then steps — get_next_ca_field
# ---------------------------------------------------------------------------


@then(parsers.parse('the returned field key is "{key}"'))
def then_field_key_is(ctx, key):
    assert ctx.next_field is not None, "Expected a field to be returned, got None"
    assert ctx.next_field["key"] == key, (
        f"Expected field key '{key}', got '{ctx.next_field['key']}'"
    )


@then("no next field is returned")
def then_no_next_field(ctx):
    assert ctx.next_field is None, (
        f"Expected None but got field: {ctx.next_field}"
    )


# ---------------------------------------------------------------------------
# Then steps — generate_application_draft (CA)
# ---------------------------------------------------------------------------


@then("the result prompts for the applicant name field")
def then_result_prompts_name(ctx):
    result = ctx.tool_result
    assert "California SAWS-1 Application" in result, (
        f"Expected SAWS-1 header in result:\n{result}"
    )
    assert "Full Legal Name" in result, (
        f"Expected 'Full Legal Name' prompt in result:\n{result}"
    )


@then("the result shows the review confirmation screen")
def then_result_shows_review(ctx):
    result = ctx.tool_result
    assert "Review Your California SAWS-1 Application" in result, (
        f"Expected review header in result:\n{result}"
    )
    assert "confirm" in result.lower(), (
        f"Expected 'confirm' prompt in review screen:\n{result}"
    )
    # Should list the collected fields in a review table
    assert "Full Legal Name" in result, (
        f"Expected 'Full Legal Name' in review table:\n{result}"
    )


@then("the result contains the SAWS-1 file path")
def then_result_contains_path(ctx):
    result = ctx.tool_result
    assert "SAWS-1" in result, f"Expected 'SAWS-1' in result:\n{result}"
    assert ".pdf" in result, f"Expected '.pdf' path in result:\n{result}"


@then("the result contains California submission instructions")
def then_result_contains_instructions(ctx):
    result = ctx.tool_result
    assert "How to Submit" in result, (
        f"Expected submission instructions in result:\n{result}"
    )
    assert "benefitscal.com" in result or "cdss.ca.gov" in result, (
        f"Expected CA portal links in result:\n{result}"
    )


# ---------------------------------------------------------------------------
# Then steps — generate_application_draft (non-CA)
# ---------------------------------------------------------------------------


@then("the result contains a PDF file path")
def then_result_has_pdf_path(ctx):
    result = ctx.tool_result
    assert ".pdf" in result, f"Expected PDF path in result:\n{result}"


@then("the result does not mention SAWS-1 submission instructions")
def then_result_no_saws1(ctx):
    result = ctx.tool_result
    assert "How to Submit Your SAWS-1" not in result, (
        f"Unexpected SAWS-1 instructions in non-CA result:\n{result[:500]}"
    )


# ---------------------------------------------------------------------------
# Then steps — _extract_form_data
# ---------------------------------------------------------------------------


@then(parsers.parse('the form data contains key "{key}" with value "{value}"'))
def then_form_data_has(ctx, key, value):
    assert key in ctx.form_data, (
        f"Expected key '{key}' in form data, got keys: {list(ctx.form_data.keys())}"
    )
    assert ctx.form_data[key] == value, (
        f"Expected form_data['{key}'] == '{value}', got '{ctx.form_data[key]}'"
    )
