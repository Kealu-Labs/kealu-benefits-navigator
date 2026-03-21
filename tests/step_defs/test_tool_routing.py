"""Step definitions for tool_routing.feature."""

from __future__ import annotations

from unittest.mock import MagicMock

from pytest_bdd import given, parsers, scenario, then, when

from benefit_navigator.mcp_server import _execute_tool

from ..conftest import DEMO_PROFILE

# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@scenario("../features/tool_routing.feature", "navigate_benefits invokes benefit-navigator workflow")
def test_invokes_workflow():
    pass


@scenario("../features/tool_routing.feature", "Workflow variables are passed through to kvr")
def test_vars_passed():
    pass


@scenario("../features/tool_routing.feature", "Empty optional fields are not passed to kvr")
def test_empty_fields_omitted():
    pass


@scenario("../features/tool_routing.feature", "check_eligibility invokes kvr assist with program name")
def test_check_eligibility():
    pass


@scenario("../features/tool_routing.feature", "compare_insurance_plans invokes kvr assist with zip code")
def test_compare_plans():
    pass


@scenario("../features/tool_routing.feature", "Unknown tool returns error message")
def test_unknown_tool():
    pass


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------


class RoutingContext:
    def __init__(self):
        self.args: dict = {}
        self.result: str = ""
        self.kvr_cmd: list[str] = []
        self.assist_task: str = ""


# ---------------------------------------------------------------------------
# Given steps
# ---------------------------------------------------------------------------


@given("a complete demo profile with skip_intake", target_fixture="ctx")
def given_demo_profile():
    ctx = RoutingContext()
    ctx.args = {**DEMO_PROFILE, "skip_intake": "true"}
    return ctx


@given("the profile includes")
def add_profile_fields(ctx, datatable):
    for row in datatable:
        ctx.args[row[0]] = row[1].strip()


@given(parsers.parse('a check_eligibility call for program "{program}"'), target_fixture="ctx")
def given_eligibility_call(program, datatable):
    ctx = RoutingContext()
    ctx.args = {row[0]: row[1].strip() for row in datatable}
    ctx.args["program"] = program
    return ctx


@given("a compare_insurance_plans call", target_fixture="ctx")
def given_compare_call(datatable):
    ctx = RoutingContext()
    ctx.args = {row[0]: row[1].strip() for row in datatable}
    return ctx


# ---------------------------------------------------------------------------
# When steps
# ---------------------------------------------------------------------------


@when("navigate_benefits is executed with mocked kvr")
def execute_navigate(ctx, mock_kvr):
    ctx.result = _execute_tool("navigate_benefits", ctx.args)
    if mock_kvr.called_with:
        ctx.kvr_cmd = mock_kvr.called_with[-1]


@when("the tool is executed with mocked kvr assist")
def execute_with_assist_mock(ctx, monkeypatch):
    import subprocess as sp

    # Ensure CMS API path is not taken so fallback (kvr assist) is used
    monkeypatch.delenv("CMS_API_KEY", raising=False)

    captured = MagicMock()

    def mock_run(cmd, **kwargs):
        captured.cmd = list(cmd)
        # Extract task from command — it's the last positional arg after --spawn
        for i, arg in enumerate(cmd):
            if arg == "--spawn" and i + 1 < len(cmd):
                captured.task = cmd[i + 1]
        result = MagicMock()
        result.stdout = "Mock kvr assist output"
        result.stderr = ""
        result.returncode = 0
        return result

    monkeypatch.setattr(sp, "run", mock_run)

    tool_name = "check_eligibility" if "program" in ctx.args else "compare_insurance_plans"
    ctx.result = _execute_tool(tool_name, ctx.args)
    ctx.kvr_cmd = getattr(captured, "cmd", [])
    ctx.assist_task = getattr(captured, "task", "")


@when(parsers.parse('an unknown tool "{tool_name}" is executed'), target_fixture="ctx")
def execute_unknown(tool_name):
    ctx = RoutingContext()
    ctx.result = _execute_tool(tool_name, {})
    return ctx


# ---------------------------------------------------------------------------
# Then steps
# ---------------------------------------------------------------------------


@then(parsers.parse('kvr was invoked with workflow "{workflow}"'))
def check_workflow(ctx):
    assert any("benefit-navigator" in arg for arg in ctx.kvr_cmd), (
        f"Expected 'benefit-navigator' in kvr command: {ctx.kvr_cmd}"
    )


@then(parsers.parse('kvr was invoked with "{flag}" "{value}"'))
def check_flag(ctx, flag, value):
    for i, arg in enumerate(ctx.kvr_cmd):
        if arg == flag and i + 1 < len(ctx.kvr_cmd) and ctx.kvr_cmd[i + 1] == value:
            return
    raise AssertionError(f"Expected '{flag}' '{value}' in command: {ctx.kvr_cmd}")


@then(parsers.parse('the kvr command includes "--var" "{var_value}"'))
def check_var(ctx, var_value):
    for i, arg in enumerate(ctx.kvr_cmd):
        if arg == "--var" and i + 1 < len(ctx.kvr_cmd) and ctx.kvr_cmd[i + 1] == var_value:
            return
    raise AssertionError(f"Expected '--var' '{var_value}' in command: {ctx.kvr_cmd}")


@then(parsers.parse('the kvr command does not include "--var" starting with "{prefix}"'))
def check_var_absent(ctx, prefix):
    for i, arg in enumerate(ctx.kvr_cmd):
        if arg == "--var" and i + 1 < len(ctx.kvr_cmd) and ctx.kvr_cmd[i + 1].startswith(prefix):
            raise AssertionError(f"Found unexpected '--var' '{ctx.kvr_cmd[i + 1]}' in command")


@then("kvr assist was invoked")
def check_assist_invoked(ctx):
    assert ctx.kvr_cmd, "kvr assist was not invoked"
    assert any("assist" in arg for arg in ctx.kvr_cmd), f"Expected 'assist' in command: {ctx.kvr_cmd}"


@then(parsers.parse('the task description includes "{text}"'))
def check_task_includes(ctx, text):
    assert text in ctx.assist_task, f"Expected '{text}' in task: {ctx.assist_task}"


@then(parsers.parse('the result contains "{text}"'))
def check_result_contains(ctx, text):
    assert text in ctx.result, f"Expected '{text}' in result: {ctx.result}"
