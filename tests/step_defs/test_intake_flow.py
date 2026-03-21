"""Step definitions for intake_flow.feature."""

from __future__ import annotations

from pytest_bdd import given, parsers, scenario, then, when

from benefit_navigator.mcp_server import _check_intake_completeness, _execute_tool

from ..conftest import DEMO_PROFILE_FULL

# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@scenario("../features/intake_flow.feature", "Minimal request triggers tier-1 questions")
def test_minimal_request():
    pass


@scenario("../features/intake_flow.feature", "ZIP code detected in profile text")
def test_zip_in_profile():
    pass


@scenario("../features/intake_flow.feature", "ZIP code provided as explicit field")
def test_zip_explicit_field():
    pass


@scenario("../features/intake_flow.feature", "ZIP+4 format is recognized")
def test_zip_plus_4():
    pass


@scenario("../features/intake_flow.feature", "Income keyword detection")
def test_income_keywords():
    pass


@scenario("../features/intake_flow.feature", "Household composition detected via family keywords")
def test_household_keywords():
    pass


@scenario("../features/intake_flow.feature", "Tier-1 complete triggers tier-2 personalization questions")
def test_tier2_questions():
    pass


@scenario("../features/intake_flow.feature", "Coverage status detected in natural language")
def test_coverage_detected():
    pass


@scenario("../features/intake_flow.feature", "Medications provided as explicit field skips that question")
def test_medications_explicit():
    pass


@scenario("../features/intake_flow.feature", "Fully complete profile skips intake entirely")
def test_full_profile():
    pass


@scenario("../features/intake_flow.feature", "skip_intake bypasses all checks")
def test_skip_intake():
    pass


@scenario("../features/intake_flow.feature", "Provided data is summarized back to the user")
def test_provided_summary():
    pass


# ---------------------------------------------------------------------------
# Context fixture
# ---------------------------------------------------------------------------


class IntakeContext:
    def __init__(self):
        self.args: dict = {}
        self.result: str | None = None
        self.tool_executed: bool = False


@given("a navigate_benefits call with only", target_fixture="ctx")
def given_navigate_call(datatable):
    ctx = IntakeContext()
    ctx.args = {row[0]: row[1].strip() for row in datatable}
    return ctx


@given("a navigate_benefits call with all fields populated", target_fixture="ctx")
def given_full_profile():
    ctx = IntakeContext()
    ctx.args = dict(DEMO_PROFILE_FULL)
    return ctx


# ---------------------------------------------------------------------------
# When steps
# ---------------------------------------------------------------------------


@when("the intake completeness check runs")
def run_intake_check(ctx):
    ctx.result = _check_intake_completeness(ctx.args)


@when("the tool is executed")
def execute_tool(ctx, monkeypatch):
    # Mock _run_benefit_navigator to avoid actually calling kvr
    import benefit_navigator.mcp_server as mcp_mod

    monkeypatch.setattr(mcp_mod, "_run_benefit_navigator", lambda args, **kw: "WORKFLOW_TRIGGERED")
    ctx.result = _execute_tool("navigate_benefits", ctx.args)
    ctx.tool_executed = True


# ---------------------------------------------------------------------------
# Then steps
# ---------------------------------------------------------------------------


@then(parsers.parse('the response stage is "{stage}"'))
def check_stage(ctx, stage):
    assert ctx.result is not None, "Expected intake response but got None (ready for analysis)"
    assert f"Intake Status: {stage}" in ctx.result


@then(parsers.parse('the response asks for "{field}"'))
def check_asks_for(ctx, field):
    assert ctx.result is not None, "Expected intake response but got None"
    assert field.lower() in ctx.result.lower(), f"Response should ask for '{field}' but doesn't:\n{ctx.result}"


@then(parsers.parse('the response does not ask for "{field}"'))
def check_does_not_ask(ctx, field):
    # None means intake is complete (ready) — the field is not being asked for, which is correct
    assert ctx.result is None or f"**{field}" not in ctx.result, (
        f"Response should NOT ask for '{field}' but does:\n{ctx.result}"
    )


@then("the response is None")
def check_none(ctx):
    assert ctx.result is None, f"Expected None (ready) but got:\n{ctx.result}"


@then("the response includes can_proceed guidance")
def check_can_proceed(ctx):
    assert ctx.result is not None
    assert "skip_intake" in ctx.result or "proceed" in ctx.result.lower()


@then("the intake check was skipped")
def check_skipped(ctx):
    assert ctx.tool_executed
    assert ctx.result == "WORKFLOW_TRIGGERED"


@then(parsers.parse('the provided summary includes "{text}"'))
def check_summary_includes(ctx, text):
    assert ctx.result is not None
    assert text in ctx.result, f"Summary should include '{text}':\n{ctx.result}"
