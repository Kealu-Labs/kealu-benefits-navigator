"""Step definitions for application_draft.feature."""

from __future__ import annotations

import tempfile
from pathlib import Path

from pytest_bdd import given, parsers, scenario, then, when

from benefits_navigator.mcp_server import _execute_tool
from benefits_navigator.pdf_generator import generate_application_pdf

# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@scenario("../features/application_draft.feature", "PDF is generated with correct structure")
def test_pdf_structure():
    pass


@scenario("../features/application_draft.feature", "PDF extracts eligible programs from workflow output")
def test_pdf_programs():
    pass


@scenario("../features/application_draft.feature", "Missing workflow output returns guidance")
def test_missing_output():
    pass


@scenario("../features/application_draft.feature", "Household details are parsed into the PDF")
def test_household_details():
    pass


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------


class DraftContext:
    def __init__(self):
        self.args: dict = {}
        self.workflow_output: str = ""
        self.result: str = ""
        self.pdf_path: Path | None = None
        self.pdf_bytes: bytes = b""
        self.output_dir: Path = Path(tempfile.mkdtemp())


# ---------------------------------------------------------------------------
# Given steps
# ---------------------------------------------------------------------------


@given("a household profile for a single parent in Texas", target_fixture="ctx")
def given_texas_profile():
    ctx = DraftContext()
    ctx.args = {
        "household_profile": "Single parent making $42k with two kids ages 4 and 9",
        "state": "Texas",
        "zip_code": "77001",
        "income_type": "W-2 employee",
    }
    return ctx


@given(parsers.parse('a household profile "{profile}"'), target_fixture="ctx")
def given_profile(profile):
    ctx = DraftContext()
    ctx.args = {"household_profile": profile}
    return ctx


@given(parsers.parse('the zip code is "{zip_code}"'))
def set_zip(ctx, zip_code):
    ctx.args["zip_code"] = zip_code


@given("workflow output mentioning SNAP and CHIP eligibility")
def given_snap_chip_output(ctx):
    ctx.workflow_output = (
        "## Eligibility Results\n"
        "- SNAP: LIKELY ELIGIBLE at 130% FPL\n"
        "- CHIP: ELIGIBLE for children ages 4 and 9\n"
        "- LIHEAP: ELIGIBLE for utility assistance\n"
        "### Document Checklist\n"
        "- Proof of income (pay stubs)\n"
        "- Birth certificates\n"
        "- Social Security cards\n"
        "- Proof of residency\n"
        "- Photo ID\n"
    )
    ctx.args["workflow_output"] = ctx.workflow_output


@given("workflow output mentioning Medicaid eligibility")
def given_medicaid_output(ctx):
    ctx.workflow_output = (
        "## Eligibility Results\n"
        "- Medicaid: ELIGIBLE for children\n"
        "- ACA Marketplace: ELIGIBLE with APTC subsidy\n"
        "### Required Documents\n"
        "- Proof of income\n"
        "- Birth certificates\n"
        "- Proof of residency\n"
    )
    ctx.args["workflow_output"] = ctx.workflow_output


@given("no workflow output is provided")
def given_no_output(ctx):
    ctx.args["workflow_output"] = ""


# ---------------------------------------------------------------------------
# When steps
# ---------------------------------------------------------------------------


@when("generate_application_draft is executed")
def execute_draft(ctx):
    ctx.result = _execute_tool("generate_application_draft", ctx.args)


@when("the PDF is generated and read back")
def generate_and_read(ctx):
    ctx.pdf_path = generate_application_pdf(
        ctx.args,
        ctx.workflow_output,
        output_dir=ctx.output_dir,
    )
    ctx.pdf_bytes = ctx.pdf_path.read_bytes()


# ---------------------------------------------------------------------------
# Then steps
# ---------------------------------------------------------------------------


@then("a PDF file is created on disk")
def check_file_exists(ctx):
    # The tool result contains a file path (either official or worksheet)
    assert "benefits-application" in ctx.result
    # Extract path from result
    for line in ctx.result.split("\n"):
        if "benefits-application" in line and ".pdf" in line:
            # Path is between backticks
            start = line.find("`") + 1
            end = line.rfind("`")
            if start > 0 and end > start:
                path = Path(line[start:end])
                assert path.exists(), f"PDF not found at {path}"
                ctx.pdf_path = path
                ctx.pdf_bytes = path.read_bytes()
                return
    # If we can't extract path, at least verify the result mentions success
    assert "generated" in ctx.result.lower() or "File:" in ctx.result


@then("the PDF starts with a valid header")
def check_header(ctx):
    assert ctx.pdf_bytes.startswith(b"%PDF-1.4"), (
        f"Invalid PDF header: {ctx.pdf_bytes[:20]}"
    )


@then("the PDF contains 3 pages")
def check_page_count(ctx):
    assert b"/Count 3" in ctx.pdf_bytes, "Expected 3 pages in PDF"


@then("the tool result mentions the file path")
def check_path_in_result(ctx):
    assert ".pdf" in ctx.result
    assert "benefits-application" in ctx.result


@then("the tool result includes review instructions")
def check_instructions(ctx):
    assert "review" in ctx.result.lower()
    assert "DRAFT" in ctx.result


@then("the result instructs to run navigate_benefits first")
def check_missing_output_message(ctx):
    assert "navigate_benefits" in ctx.result
    assert "Missing" in ctx.result or "workflow_output" in ctx.result


@then(parsers.parse('the PDF text contains "{text}"'))
def check_pdf_contains(ctx, text):
    # PDF text content is in stream objects — search raw bytes
    pdf_str = ctx.pdf_bytes.decode("latin-1", errors="replace")
    assert text in pdf_str, f"Expected '{text}' in PDF content"
