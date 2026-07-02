"""Step definitions for tool_routing.feature."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from pytest_bdd import given, parsers, scenario, then, when

import benefits_navigator.mcp_server as mcp_mod
from benefits_navigator.mcp_server import _execute_tool

from ..conftest import DEMO_PROFILE

# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@scenario(
    "../features/tool_routing.feature",
    "navigate_benefits invokes benefits-navigator workflow",
)
def test_invokes_workflow():
    pass


@scenario(
    "../features/tool_routing.feature", "Workflow variables are passed through to kvr"
)
def test_vars_passed():
    pass


@scenario(
    "../features/tool_routing.feature", "Empty optional fields are not passed to kvr"
)
def test_empty_fields_omitted():
    pass


@scenario(
    "../features/tool_routing.feature",
    "check_eligibility invokes kvr assist with program name",
)
def test_check_eligibility():
    pass


@scenario(
    "../features/tool_routing.feature",
    "compare_insurance_plans invokes kvr assist with zip code",
)
def test_compare_plans():
    pass


@scenario("../features/tool_routing.feature", "Unknown tool returns error message")
def test_unknown_tool():
    pass


@pytest.mark.allow_log_output  # audit INFO lines are intentional; asserted via caplog
@scenario(
    "../features/tool_routing.feature",
    "Tool handler exception is audited without leaking the message",
)
def test_exception_audit_no_pii():
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
        self.var_file_data: dict = {}


# ---------------------------------------------------------------------------
# Given steps
# ---------------------------------------------------------------------------


@given("a complete demo profile with skip_intake", target_fixture="ctx")
def given_demo_profile():
    ctx = RoutingContext()
    ctx.args = {**DEMO_PROFILE, "skip_intake": True}
    return ctx


@given("the profile includes")
def add_profile_fields(ctx, datatable):
    for row in datatable:
        ctx.args[row[0]] = row[1].strip()


@given(
    parsers.parse('a check_eligibility call for program "{program}"'),
    target_fixture="ctx",
)
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
        ctx.var_file_data = mock_kvr.var_file_data


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
                spawn_arg = cmd[i + 1]
                captured.task = spawn_arg
                # If the task references a file, read its contents
                if spawn_arg.startswith("Execute the task in "):
                    task_path = spawn_arg.removeprefix("Execute the task in ")
                    try:
                        captured.task_content = Path(task_path).read_text()
                    except FileNotFoundError:
                        pass
        result = MagicMock()
        result.stdout = "Mock kvr assist output"
        result.stderr = ""
        result.returncode = 0
        return result

    monkeypatch.setattr(sp, "run", mock_run)

    tool_name = (
        "check_eligibility" if "program" in ctx.args else "compare_insurance_plans"
    )
    ctx.result = _execute_tool(tool_name, ctx.args)
    ctx.kvr_cmd = getattr(captured, "cmd", [])
    ctx.assist_task = getattr(captured, "task_content", getattr(captured, "task", ""))


@when(parsers.parse('an unknown tool "{tool_name}" is executed'), target_fixture="ctx")
def execute_unknown(tool_name):
    ctx = RoutingContext()
    ctx.result = _execute_tool(tool_name, {})
    return ctx


# ---------------------------------------------------------------------------
# Then steps
# ---------------------------------------------------------------------------


@then(parsers.parse('kvr was invoked with workflow "{workflow}"'))
def check_workflow(ctx, workflow):
    assert any(workflow in arg for arg in ctx.kvr_cmd), (
        f"Expected '{workflow}' in kvr command: {ctx.kvr_cmd}"
    )


@then(parsers.parse('kvr was invoked with "{flag}" "{value}"'))
def check_flag(ctx, flag, value):
    for i, arg in enumerate(ctx.kvr_cmd):
        if arg == flag and i + 1 < len(ctx.kvr_cmd) and ctx.kvr_cmd[i + 1] == value:
            return
    raise AssertionError(f"Expected '{flag}' '{value}' in command: {ctx.kvr_cmd}")


@then(parsers.parse('the kvr command includes var "{key}" with value "{value}"'))
def check_var_arg(ctx, key, value):
    expected = f"{key}={value}"
    for i, arg in enumerate(ctx.kvr_cmd):
        if (
            arg == "--var"
            and i + 1 < len(ctx.kvr_cmd)
            and ctx.kvr_cmd[i + 1] == expected
        ):
            return
    raise AssertionError(f"Expected '--var' '{expected}' in command: {ctx.kvr_cmd}")


@then(parsers.parse('the kvr command does not include var "{key}"'))
def check_var_arg_absent(ctx, key):
    for i, arg in enumerate(ctx.kvr_cmd):
        if (
            arg == "--var"
            and i + 1 < len(ctx.kvr_cmd)
            and ctx.kvr_cmd[i + 1].startswith(f"{key}=")
        ):
            raise AssertionError(
                f"Found unexpected '--var' '{ctx.kvr_cmd[i + 1]}' in command"
            )


@then("kvr assist was invoked")
def check_assist_invoked(ctx):
    assert ctx.kvr_cmd, "kvr assist was not invoked"
    assert any("assist" in arg for arg in ctx.kvr_cmd), (
        f"Expected 'assist' in command: {ctx.kvr_cmd}"
    )


@then(parsers.parse('the task description includes "{text}"'))
def check_task_includes(ctx, text):
    assert text in ctx.assist_task, f"Expected '{text}' in task: {ctx.assist_task}"


@then(parsers.parse('the result contains "{text}"'))
def check_result_contains(ctx, text):
    assert text in ctx.result, f"Expected '{text}' in result: {ctx.result}"


# ---------------------------------------------------------------------------
# Exception-audit scenario context and steps
# ---------------------------------------------------------------------------


class ExceptionAuditContext:
    def __init__(self):
        self.tool_name: str = "_test_pii_tool"
        self.error_message: str = ""
        self.raised: BaseException | None = None
        self.audit_records: list = []
        self.audit_text: str = ""


@given(
    parsers.parse('a registered tool whose handler raises "{error_message}"'),
    target_fixture="exc_ctx",
)
def given_raising_handler(error_message, monkeypatch):
    ctx = ExceptionAuditContext()
    ctx.error_message = error_message

    def _raising_handler(args, *, progress_token=None):
        raise ValueError(error_message)

    monkeypatch.setitem(mcp_mod._TOOL_DISPATCH, ctx.tool_name, _raising_handler)
    return ctx


@when("the registered tool is executed and raises")
def when_tool_raises(exc_ctx, caplog):
    with caplog.at_level(logging.INFO, logger="benefits_navigator.mcp_server"):
        with pytest.raises(ValueError) as exc_info:
            _execute_tool(exc_ctx.tool_name, {})
    exc_ctx.raised = exc_info.value
    exc_ctx.audit_records = list(caplog.records)
    exc_ctx.audit_text = caplog.text


@then("the exception propagates")
def then_exception_propagates(exc_ctx):
    assert exc_ctx.raised is not None
    assert isinstance(exc_ctx.raised, ValueError)


@then(parsers.parse('the audit log records error_type "{expected_error_type}"'))
def then_audit_records_error_type(exc_ctx, expected_error_type):
    events = [_parse_audit_record(r) for r in exc_ctx.audit_records]
    matching = [
        e
        for e in events
        if e is not None
        and e.get("outcome") == "error"
        and e.get("details", {}).get("error_type") == expected_error_type
    ]
    assert matching, (
        f"No audit event with error_type={expected_error_type!r}; "
        f"records: {exc_ctx.audit_text!r}"
    )


@then(parsers.parse('the audit log does not contain "{pii_substring}"'))
def then_audit_no_pii(exc_ctx, pii_substring):
    assert pii_substring not in exc_ctx.audit_text, (
        f"PII substring {pii_substring!r} unexpectedly found in audit log"
    )


def _parse_audit_record(record) -> dict | None:
    msg = record.getMessage()
    if not msg.startswith("AUDIT "):
        return None
    try:
        return json.loads(msg[len("AUDIT ") :])
    except json.JSONDecodeError:
        return None
