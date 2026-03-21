"""Step definitions for form_filler.feature."""

from __future__ import annotations

import tempfile
from pathlib import Path

from pytest_bdd import given, parsers, scenario, then, when

from benefit_navigator.form_filler import (
    fill_official_form,
    generate_application,
    has_official_form,
)

# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@scenario("../features/form_filler.feature", "California gets the official SAWS-1 form filled")
def test_california_official():
    pass


@scenario("../features/form_filler.feature", "Texas falls back to the worksheet")
def test_texas_worksheet():
    pass


@scenario("../features/form_filler.feature", "California form has correct program checkboxes")
def test_california_checkboxes():
    pass


@scenario("../features/form_filler.feature", "State name is normalized to code")
def test_state_normalization():
    pass


@scenario("../features/form_filler.feature", "Illinois gets the official IL444-2378B form filled")
def test_illinois_official():
    pass


@scenario("../features/form_filler.feature", "New York gets the official LDSS-4826-DD form filled")
def test_new_york_official():
    pass


@scenario("../features/form_filler.feature", "Pennsylvania gets the official PA-600 form filled")
def test_pennsylvania_official():
    pass


@scenario("../features/form_filler.feature", "Unknown state falls back to worksheet")
def test_unknown_state():
    pass


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------


class FormContext:
    def __init__(self):
        self.args: dict = {}
        self.workflow_output: str = ""
        self.path: Path | None = None
        self.form_type: str = ""
        self.output_dir: Path = Path(tempfile.mkdtemp())


# ---------------------------------------------------------------------------
# Given steps
# ---------------------------------------------------------------------------


@given("a household profile for California", target_fixture="ctx")
def given_california_profile():
    ctx = FormContext()
    ctx.args = {
        "household_profile": "Single parent making $42k with two kids ages 4 and 9",
        "state": "CA",
        "zip_code": "90001",
        "county": "Los Angeles County",
    }
    return ctx


@given("a household profile for Texas", target_fixture="ctx")
def given_texas_profile():
    ctx = FormContext()
    ctx.args = {
        "household_profile": "Single parent making $42k with two kids ages 4 and 9",
        "state": "TX",
        "zip_code": "77001",
        "county": "Harris County",
    }
    return ctx


@given("a household profile for Illinois", target_fixture="ctx")
def given_illinois_profile():
    ctx = FormContext()
    ctx.args = {
        "household_profile": "Single parent making $42k with two kids ages 4 and 9",
        "state": "IL",
        "zip_code": "60601",
        "county": "Cook County",
    }
    return ctx


@given("a household profile for New York", target_fixture="ctx")
def given_new_york_profile():
    ctx = FormContext()
    ctx.args = {
        "household_profile": "Single parent making $42k with two kids ages 4 and 9",
        "state": "NY",
        "zip_code": "11201",
        "county": "Kings County",
    }
    return ctx


@given("a household profile for Pennsylvania", target_fixture="ctx")
def given_pennsylvania_profile():
    ctx = FormContext()
    ctx.args = {
        "household_profile": "Single parent making $42k with two kids ages 4 and 9",
        "state": "PA",
        "zip_code": "19101",
        "county": "Philadelphia County",
    }
    return ctx


@given(parsers.parse('a household profile with state "{state}"'), target_fixture="ctx")
def given_profile_with_state(state):
    ctx = FormContext()
    ctx.args = {
        "household_profile": "Single parent making $42k with two kids",
        "state": state,
        "zip_code": "90001",
    }
    return ctx


@given("workflow output mentioning SNAP and Medicaid")
def given_snap_medicaid_output(ctx):
    ctx.workflow_output = (
        "## Eligibility Results\n"
        "- SNAP: LIKELY ELIGIBLE\n"
        "- Medicaid: ELIGIBLE for children\n"
        "- Proof of income required\n"
    )


@given("workflow output mentioning CalFresh and Medi-Cal")
def given_calfresh_medical_output(ctx):
    ctx.workflow_output = (
        "## Eligibility Results\n"
        "- CalFresh (SNAP): LIKELY ELIGIBLE at 130% FPL\n"
        "- Medi-Cal: ELIGIBLE for children\n"
        "- CalWORKs: May be eligible for cash assistance\n"
    )


@given("workflow output mentioning SNAP")
def given_snap_output(ctx):
    ctx.workflow_output = "## Eligibility\n- SNAP: ELIGIBLE\n"


# ---------------------------------------------------------------------------
# When steps
# ---------------------------------------------------------------------------


@when("generate_application is called")
def call_generate(ctx):
    from benefit_navigator.mcp_server import _normalize_state

    _normalize_state(ctx.args)
    ctx.path, ctx.form_type = generate_application(
        ctx.args, ctx.workflow_output, output_dir=ctx.output_dir
    )


@when("the official form is filled")
def call_fill_official(ctx):
    ctx.path = fill_official_form(
        ctx.args, ctx.workflow_output, output_dir=ctx.output_dir
    )
    assert ctx.path is not None, "Expected official form but got None"


# ---------------------------------------------------------------------------
# Then steps
# ---------------------------------------------------------------------------


@then(parsers.parse('the form type is "{expected}"'))
def check_form_type(ctx, expected):
    assert ctx.form_type == expected, (
        f"Expected form type '{expected}', got '{ctx.form_type}'"
    )


@then("the output PDF exists")
def check_pdf_exists(ctx):
    assert ctx.path is not None
    assert ctx.path.exists(), f"PDF not found at {ctx.path}"
    assert ctx.path.stat().st_size > 0, "PDF is empty"


@then("the output PDF has fillable form fields")
def check_fillable_fields(ctx):
    from pypdf import PdfReader

    reader = PdfReader(str(ctx.path))
    fields = reader.get_fields()
    assert fields, "Expected fillable form fields in the PDF"
    assert len(fields) > 10, f"Expected many fields, got {len(fields)}"


@then(parsers.parse('the output PDF starts with "{header}"'))
def check_pdf_header(ctx, header):
    data = ctx.path.read_bytes()
    assert data[:len(header)] == header.encode(), (
        f"Expected PDF to start with '{header}', got {data[:20]}"
    )


@then("the CalFresh checkbox is checked")
def check_calfresh_checkbox(ctx):
    from pypdf import PdfReader

    reader = PdfReader(str(ctx.path))
    fields = reader.get_fields()
    field = fields.get("applicant_programs_1")
    assert field is not None, "CalFresh checkbox field not found"
    val = field.get("/V", "")
    assert val in ("/On", "/Yes", "/1"), f"CalFresh not checked: {val}"


@then("the Medi-Cal checkbox is checked")
def check_medical_checkbox(ctx):
    from pypdf import PdfReader

    reader = PdfReader(str(ctx.path))
    fields = reader.get_fields()
    field = fields.get("applicant_programs_2")
    assert field is not None, "Medi-Cal checkbox field not found"
    val = field.get("/V", "")
    assert val in ("/On", "/Yes", "/1"), f"Medi-Cal not checked: {val}"
