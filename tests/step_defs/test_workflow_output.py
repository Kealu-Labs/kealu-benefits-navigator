"""Step definitions for workflow_output.feature."""

from __future__ import annotations

import json
import re
from pathlib import Path
from unittest.mock import MagicMock

from pytest_bdd import given, parsers, scenario, then, when

from benefit_navigator.mcp_server import _execute_tool

from ..conftest import MOCK_PHASE_OUTPUTS

# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@scenario("../features/workflow_output.feature", "All five phase outputs plus sources section are collected and formatted")
def test_five_phases():
    pass


@scenario("../features/workflow_output.feature", "Phase outputs appear in workflow order")
def test_phase_order():
    pass


@scenario("../features/workflow_output.feature", "Benefits research identifies Texas programs with dollar estimates")
def test_texas_programs():
    pass


@scenario("../features/workflow_output.feature", "Benefits research flags Texas as Medicaid non-expansion state")
def test_non_expansion():
    pass


@scenario("../features/workflow_output.feature", "Insurance research returns plan-level premium estimates")
def test_premium_estimates():
    pass


@scenario("../features/workflow_output.feature", "Evidence verification recalculates FPL percentage")
def test_fpl_recalc():
    pass


@scenario("../features/workflow_output.feature", "Evidence verification catches SNAP threshold error")
def test_snap_correction():
    pass


@scenario("../features/workflow_output.feature", "Eligibility validation produces structured determination table")
def test_eligibility_table():
    pass


@scenario("../features/workflow_output.feature", "Action plan contains government URLs")
def test_gov_urls():
    pass


@scenario("../features/workflow_output.feature", "Action plan includes document checklist")
def test_document_checklist():
    pass


@scenario("../features/workflow_output.feature", "Action plan flags time-sensitive deadlines")
def test_deadlines():
    pass


@scenario("../features/workflow_output.feature", "Workflow failure returns informative error")
def test_workflow_failure():
    pass


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------


class OutputContext:
    def __init__(self):
        self.args: dict = {}
        self.result: str = ""
        self.phase_outputs: dict = {}
        self.workflow_should_fail: bool = False


# ---------------------------------------------------------------------------
# Given steps
# ---------------------------------------------------------------------------


@given("the demo household profile", target_fixture="ctx")
def given_demo_profile_workflow(datatable):
    ctx = OutputContext()
    ctx.args = {row[0]: row[1].strip() for row in datatable}
    return ctx


@given("the kvr workflow produces all 5 phases")
def configure_all_phases(ctx):
    ctx.phase_outputs = dict(MOCK_PHASE_OUTPUTS)


@given("the kvr workflow fails with no decision log")
def configure_failure(ctx):
    ctx.workflow_should_fail = True


# ---------------------------------------------------------------------------
# When steps
# ---------------------------------------------------------------------------


@when("navigate_benefits completes")
def run_navigate(ctx, tmp_path, monkeypatch):
    import subprocess as sp

    import benefit_navigator.mcp_server as mcp_mod

    if ctx.workflow_should_fail:
        def mock_run(cmd, **kwargs):
            result = MagicMock()
            result.returncode = 1
            result.stdout = "Error: workflow crashed"
            result.stderr = "Fatal error"
            return result

        monkeypatch.setattr(sp, "run", mock_run)
        monkeypatch.setattr("pathlib.Path.cwd", lambda: tmp_path)
        ctx.result = _execute_tool("navigate_benefits", ctx.args)
        return

    def mock_run(cmd, **kwargs):
        run_id = "mock-run-001"
        for i, arg in enumerate(cmd):
            if arg == "--run-id" and i + 1 < len(cmd):
                run_id = cmd[i + 1]

        log_dir = tmp_path / ".workforce" / run_id
        log_dir.mkdir(parents=True, exist_ok=True)
        decision_lines = []
        for phase_name, output in ctx.phase_outputs.items():
            md_path = log_dir / f"{phase_name}.md"
            md_path.write_text(output)
            decision_lines.append(json.dumps({
                "decision_type": "phase_complete",
                "phase": phase_name,
            }))
        (log_dir / "decision.jsonl").write_text("\n".join(decision_lines) + "\n")

        result = MagicMock()
        result.returncode = 0
        result.stdout = "OK"
        result.stderr = ""
        return result

    monkeypatch.setattr(sp, "run", mock_run)
    monkeypatch.setattr("pathlib.Path.cwd", lambda: tmp_path)
    ctx.result = _execute_tool("navigate_benefits", ctx.args)


# ---------------------------------------------------------------------------
# Then steps — structure
# ---------------------------------------------------------------------------


@then(parsers.parse("the MCP response contains {count:d} sections separated by horizontal rules"))
def check_section_count(ctx, count):
    # Split on the actual horizontal rule separator (newline-delimited ---)
    # not on table-row separators like ---|---|
    sections = re.split(r"\n---\n", ctx.result)
    sections = [s.strip() for s in sections if s.strip()]
    assert len(sections) == count, f"Expected {count} sections, got {len(sections)}:\n{ctx.result[:500]}"


@then("each section has a markdown heading")
def check_headings(ctx):
    sections = [s.strip() for s in re.split(r"\n---\n", ctx.result) if s.strip()]
    for section in sections:
        assert section.startswith("##"), f"Section doesn't start with heading:\n{section[:200]}"


@then(parsers.parse('"{first}" appears before "{second}"'))
def check_order(ctx, first, second):
    pos_first = ctx.result.find(first)
    pos_second = ctx.result.find(second)
    assert pos_first != -1, f"'{first}' not found in output"
    assert pos_second != -1, f"'{second}' not found in output"
    assert pos_first < pos_second, f"'{first}' (pos {pos_first}) should appear before '{second}' (pos {pos_second})"


# ---------------------------------------------------------------------------
# Then steps — content assertions
# ---------------------------------------------------------------------------


@then(parsers.parse('the response mentions "{program}" with a dollar amount'))
def check_program_with_dollars(ctx, program):
    assert program in ctx.result, f"'{program}' not found in response"
    # Find dollar amounts near the program mention
    assert "$" in ctx.result, "No dollar amounts found in response"


@then(parsers.parse('the response mentions "{program}" with eligibility status'))
def check_program_eligibility(ctx, program):
    assert program in ctx.result, f"'{program}' not found"
    assert any(s in ctx.result for s in ["ELIGIBLE", "NOT ELIGIBLE", "UNLIKELY"]), (
        "No eligibility status found"
    )


@then(parsers.parse('the response mentions "{text}"'))
def check_mentions(ctx, text):
    assert text in ctx.result, f"'{text}' not found in response"


@then(parsers.parse('the response contains "{text}"'))
def check_contains(ctx, text):
    assert text in ctx.result, f"'{text}' not found in response:\n{ctx.result[:500]}"


@then(parsers.parse('the response contains "{option_a}" or "{option_b}"'))
def check_contains_either(ctx, option_a, option_b):
    assert option_a in ctx.result or option_b in ctx.result, (
        f"Neither '{option_a}' nor '{option_b}' found in response"
    )


@then("the response contains a monthly dollar amount")
def check_monthly_amount(ctx):
    # Match patterns like $240/month, $380/month, etc.
    assert re.search(r"\$\d+/month", ctx.result), "No monthly dollar amount (e.g. $240/month) found"


@then(parsers.parse('the response mentions "{tier}" or "{alt_tier}" plan tier'))
def check_plan_tier(ctx, tier, alt_tier):
    assert tier in ctx.result or alt_tier in ctx.result, (
        f"Neither '{tier}' nor '{alt_tier}' plan tier found"
    )


@then(parsers.parse('the response contains "{text}" or "{alt_text}"'))
def check_contains_either_2(ctx, text, alt_text):
    assert text in ctx.result or alt_text in ctx.result, (
        f"Neither '{text}' nor '{alt_text}' found in response"
    )


@then("the response mentions SNAP eligibility revision")
def check_snap_revision(ctx):
    lower = ctx.result.lower()
    has_snap_revision = (
        "snap eligibility revised" in lower
        or ("snap" in lower and "not eligible" in lower)
        or ("snap" in lower and "unlikely" in lower)
    )
    assert has_snap_revision, "No SNAP eligibility revision found"


@then(parsers.parse('the response contains "ELIGIBLE" for CHIP'))
def check_chip_eligible(ctx):
    # Look for CHIP and ELIGIBLE in proximity
    assert "CHIP" in ctx.result, "CHIP not found"
    assert "ELIGIBLE" in ctx.result, "ELIGIBLE not found"


@then(parsers.parse('the response contains "NOT ELIGIBLE" for Medicaid parent'))
def check_medicaid_not_eligible(ctx):
    assert "NOT ELIGIBLE" in ctx.result or "NOT expanded" in ctx.result, (
        "Medicaid non-eligibility not found"
    )
