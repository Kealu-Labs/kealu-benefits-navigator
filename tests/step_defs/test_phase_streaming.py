"""Step definitions for phase_streaming.feature."""

from __future__ import annotations

import json
from io import StringIO
from unittest.mock import patch

from pytest_bdd import given, parsers, scenario, then, when

from benefit_navigator.mcp_server import (
    _PHASE_STREAM_PREFIX,
    _send_progress,
)

# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@scenario("../features/phase_streaming.feature", "Progress token enables phase streaming flag")
def test_token_enables_flag():
    pass


@scenario("../features/phase_streaming.feature", "No progress token omits phase streaming flag")
def test_no_token_no_flag():
    pass


@scenario("../features/phase_streaming.feature", "workflow_start event sends initial progress")
def test_workflow_start():
    pass


@scenario("../features/phase_streaming.feature", "phase_start event sends running progress")
def test_phase_start():
    pass


@scenario("../features/phase_streaming.feature", "phase_complete event increments progress")
def test_phase_complete():
    pass


@scenario("../features/phase_streaming.feature", "All phases completing reaches total")
def test_all_phases():
    pass


@scenario("../features/phase_streaming.feature", "Phase stream prefix is correctly parsed")
def test_prefix_parsed():
    pass


@scenario("../features/phase_streaming.feature", "Non-phase-stream lines are ignored")
def test_non_stream_ignored():
    pass


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------


class StreamContext:
    def __init__(self):
        self.progress_token: str | None = None
        self.cmd: list[str] = []
        self.notifications: list[dict] = []
        self.completed: int = 0
        self.total: int = 0
        self.line: str = ""
        self.is_stream_event: bool = False
        self.parsed_event: dict = {}


# ---------------------------------------------------------------------------
# Given steps
# ---------------------------------------------------------------------------


@given(parsers.parse('a navigate_benefits call with progress token "{token}"'), target_fixture="ctx")
def given_with_token(token):
    ctx = StreamContext()
    ctx.progress_token = token
    return ctx


@given("a navigate_benefits call without progress token", target_fixture="ctx")
def given_no_token():
    ctx = StreamContext()
    ctx.progress_token = None
    return ctx


@given(parsers.parse('a progress token "{token}"'), target_fixture="ctx")
def given_token(token):
    ctx = StreamContext()
    ctx.progress_token = token
    return ctx


@given(parsers.parse("{n:d} phase has already completed out of {total:d}"))
def given_completed(ctx, n, total):
    ctx.completed = n
    ctx.total = total


@given(parsers.parse("{n:d} phases have completed out of {total:d}"))
def given_completed_plural(ctx, n, total):
    ctx.completed = n
    ctx.total = total


@given(parsers.parse('a phase stream line for phase "{phase}"'), target_fixture="line_ctx")
def given_stream_line(phase):
    ctx = StreamContext()
    event = json.dumps({"event_type": "phase_start", "phase": phase})
    ctx.line = f"{_PHASE_STREAM_PREFIX}{event}"
    return ctx


@given(parsers.parse('a regular log line "{line}"'), target_fixture="line_ctx")
def given_log_line(line):
    ctx = StreamContext()
    ctx.line = line
    return ctx


# ---------------------------------------------------------------------------
# When steps
# ---------------------------------------------------------------------------


@when("the kvr command is built")
def build_command(ctx):
    import shutil

    import pytest

    kvr = shutil.which("kvr")
    if not kvr:
        pytest.skip("kvr not found on PATH")
    cmd = [kvr, "run", "benefit-navigator", "--mode", "automated", "--no-progress", "--run-id", "test"]
    if ctx.progress_token:
        cmd.extend(["--phase-stream", "stdout"])
    ctx.cmd = cmd


@when(parsers.parse("a workflow_start event arrives with {n:d} total phases"))
def workflow_start_event(ctx, n):
    ctx.total = n
    buf = StringIO()
    with patch("sys.stdout", buf):
        _send_progress(ctx.progress_token, 0, n, "Starting workflow...")
    ctx.notifications = _parse_notifications(buf.getvalue())


@when(parsers.parse('a phase_start event arrives for "{phase}"'))
def phase_start_event(ctx, phase):
    phase_label = phase.replace("-", " ").title()
    buf = StringIO()
    with patch("sys.stdout", buf):
        _send_progress(ctx.progress_token, ctx.completed, ctx.total, f"Running: {phase_label}")
    ctx.notifications = _parse_notifications(buf.getvalue())


@when(parsers.parse('a phase_complete event arrives for "{phase}"'))
def phase_complete_event(ctx, phase):
    ctx.completed += 1
    phase_label = phase.replace("-", " ").title()
    buf = StringIO()
    with patch("sys.stdout", buf):
        _send_progress(ctx.progress_token, ctx.completed, ctx.total, f"Completed: {phase_label}")
    ctx.notifications = _parse_notifications(buf.getvalue())


@when(parsers.parse("phase_complete events arrive for all {n:d} phases"))
def all_phases_complete(ctx, n):
    ctx.total = n
    phases = ["benefits-research", "insurance-research", "evidence-verification", "eligibility-validation", "action-plan"]
    buf = StringIO()
    with patch("sys.stdout", buf):
        for phase in phases[:n]:
            ctx.completed += 1
            label = phase.replace("-", " ").title()
            _send_progress(ctx.progress_token, ctx.completed, ctx.total, f"Completed: {label}")
    ctx.notifications = _parse_notifications(buf.getvalue())


# ---------------------------------------------------------------------------
# Then steps
# ---------------------------------------------------------------------------


@then(parsers.parse('the command includes "{flag}" "{value}"'))
def check_flag(ctx, flag, value):
    for i, arg in enumerate(ctx.cmd):
        if arg == flag and i + 1 < len(ctx.cmd) and ctx.cmd[i + 1] == value:
            return
    raise AssertionError(f"Expected '{flag}' '{value}' in command: {ctx.cmd}")


@then(parsers.parse('the command does not include "{flag}"'))
def check_no_flag(ctx, flag):
    assert flag not in ctx.cmd, f"Found unexpected '{flag}' in command: {ctx.cmd}"


@then(parsers.parse("an MCP progress notification is sent with progress {p:d} and total {t:d}"))
def check_progress(ctx, p, t):
    assert ctx.notifications, "No notifications sent"
    notif = ctx.notifications[-1]
    params = notif["params"]
    assert params["progress"] == p, f"Expected progress {p}, got {params['progress']}"
    assert params["total"] == t, f"Expected total {t}, got {params['total']}"


@then(parsers.parse('an MCP progress notification is sent with message containing "{text}"'))
def check_message(ctx, text):
    assert ctx.notifications, "No notifications sent"
    msg = ctx.notifications[-1]["params"]["message"]
    assert text in msg, f"Expected '{text}' in message: {msg}"


@then(parsers.parse('the message contains "{text}"'))
def check_message_contains(ctx, text):
    assert ctx.notifications, "No notifications sent"
    msg = ctx.notifications[-1]["params"]["message"]
    assert text in msg, f"Expected '{text}' in message: {msg}"


@then(parsers.parse("the final progress notification has progress {p:d} and total {t:d}"))
def check_final(ctx, p, t):
    assert ctx.notifications, "No notifications sent"
    last = ctx.notifications[-1]["params"]
    assert last["progress"] == p, f"Expected final progress {p}, got {last['progress']}"
    assert last["total"] == t, f"Expected final total {t}, got {last['total']}"


@then("it is recognized as a phase stream event")
def check_is_event(line_ctx):
    assert line_ctx.line.startswith(_PHASE_STREAM_PREFIX), f"Line not recognized as stream event: {line_ctx.line}"


@then(parsers.parse('the phase name is "{phase}"'))
def check_phase_name(line_ctx, phase):
    payload = line_ctx.line[len(_PHASE_STREAM_PREFIX):]
    event = json.loads(payload)
    assert event.get("phase") == phase, f"Expected phase '{phase}', got {event.get('phase')}"


@then("it is not recognized as a phase stream event")
def check_not_event(line_ctx):
    assert not line_ctx.line.startswith(_PHASE_STREAM_PREFIX), f"Line incorrectly recognized: {line_ctx.line}"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_notifications(output: str) -> list[dict]:
    """Parse MCP notifications from captured stdout."""
    notifications = []
    for line in output.strip().splitlines():
        if line:
            data = json.loads(line)
            if data.get("method") == "notifications/progress":
                notifications.append(data)
    return notifications
