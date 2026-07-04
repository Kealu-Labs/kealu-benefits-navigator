"""Step definitions for mcp_protocol.feature."""

from __future__ import annotations

import logging
import re

import pytest
from pytest_bdd import parsers, scenario, then, when

from benefits_navigator.mcp_server import _execute_tool, _handle_request

from ..conftest import _parse_audit_record

# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@scenario(
    "../features/mcp_protocol.feature",
    "Initialize handshake returns server capabilities",
)
def test_initialize():
    pass


@scenario(
    "../features/mcp_protocol.feature", "Initialized notification returns no response"
)
def test_initialized_notification():
    pass


@scenario("../features/mcp_protocol.feature", "Tools list returns all navigator tools")
def test_tools_list():
    pass


@scenario(
    "../features/mcp_protocol.feature",
    "navigate_benefits tool has required household_profile field",
)
def test_navigate_required_fields():
    pass


@scenario(
    "../features/mcp_protocol.feature",
    "check_eligibility tool requires both profile and program",
)
def test_eligibility_required_fields():
    pass


@scenario(
    "../features/mcp_protocol.feature",
    "compare_insurance_plans tool requires profile and zip",
)
def test_compare_required_fields():
    pass


@scenario("../features/mcp_protocol.feature", "Tool call returns MCP content array")
def test_tool_call_content():
    pass


@scenario("../features/mcp_protocol.feature", "Unknown method returns JSON-RPC error")
def test_unknown_method_error():
    pass


@scenario("../features/mcp_protocol.feature", "Unknown method without id is silent")
def test_unknown_method_silent():
    pass


@scenario("../features/mcp_protocol.feature", "Ping returns empty result")
def test_ping():
    pass


@pytest.mark.allow_log_output  # audit INFO lines are intentional; asserted via caplog
@scenario(
    "../features/mcp_protocol.feature",
    "Initialize captures session identity for audit attribution",
)
def test_initialize_session_identity():
    pass


@pytest.mark.allow_log_output  # audit INFO lines are intentional; asserted via caplog
@scenario(
    "../features/mcp_protocol.feature",
    "Hostile clientInfo actor is sanitized in audit events",
)
def test_hostile_clientinfo_sanitized():
    pass


@pytest.mark.allow_log_output  # audit INFO lines are intentional; asserted via caplog
@scenario(
    "../features/mcp_protocol.feature",
    "Non-dict clientInfo does not crash the initialize handler",
)
def test_non_dict_clientinfo_no_crash():
    pass


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------


class McpContext:
    def __init__(self):
        self.response: dict | None = None
        self.tools: list[dict] = []
        self.audit_records: list = []


def _send(method, req_id=None, params=None):
    ctx = McpContext()
    request = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if req_id is not None:
        request["id"] = req_id
    ctx.response = _handle_request(request)
    if (
        ctx.response
        and "result" in ctx.response
        and "tools" in ctx.response.get("result", {})
    ):
        ctx.tools = ctx.response["result"]["tools"]
    return ctx


# ---------------------------------------------------------------------------
# When steps
# ---------------------------------------------------------------------------


@when(
    parsers.re(
        r'the server receives an? "(?P<method>[^"]+)" request with id (?P<req_id>\d+)'
    ),
    target_fixture="ctx",
)
def send_request(method, req_id):
    return _send(method, req_id=int(req_id))


@when(
    parsers.re(r'the server receives an? "(?P<method>[^"]+)" notification'),
    target_fixture="ctx",
)
def send_notification(method):
    return _send(method)


@when(
    parsers.re(
        r'the server receives an? "tools/call" for "(?P<tool_name>[^"]+)" with id (?P<req_id>\d+)'
    ),
    target_fixture="ctx",
)
def send_tool_call(tool_name, req_id, datatable):
    ctx = McpContext()
    arguments = {row[0]: row[1].strip() for row in datatable}
    ctx.response = _handle_request(
        {
            "jsonrpc": "2.0",
            "id": int(req_id),
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }
    )
    return ctx


@when(
    parsers.re(
        r'the server receives an unknown method "(?P<method>[^"]+)" with id (?P<req_id>\d+)'
    ),
    target_fixture="ctx",
)
def send_unknown_with_id(method, req_id):
    return _send(method, req_id=int(req_id))


@when(
    parsers.re(
        r'the server receives an unknown method "(?P<method>[^"]+)" without an id'
    ),
    target_fixture="ctx",
)
def send_unknown_without_id(method):
    return _send(method)


@when(
    parsers.re(
        r'the server receives an "initialize" request with clientInfo name "(?P<client_name>[^"]+)" version "(?P<client_version>[^"]+)"'
    ),
    target_fixture="ctx",
)
def send_initialize_with_client_info(client_name, client_version):
    return _send(
        "initialize",
        req_id=1,
        params={"clientInfo": {"name": client_name, "version": client_version}},
    )


# ---------------------------------------------------------------------------
# Then steps
# ---------------------------------------------------------------------------


@then(parsers.parse('the response includes protocolVersion "{version}"'))
def check_protocol_version(ctx, version):
    assert ctx.response is not None
    assert ctx.response["result"]["protocolVersion"] == version


@then(parsers.parse('the response includes serverInfo name "{name}"'))
def check_server_name(ctx, name):
    assert ctx.response is not None
    assert ctx.response["result"]["serverInfo"]["name"] == name


@then(parsers.parse('the capabilities include "{capability}"'))
def check_capability(ctx, capability):
    assert ctx.response is not None
    assert capability in ctx.response["result"]["capabilities"]


@then("no response is sent")
def check_no_response(ctx):
    assert ctx.response is None


@then(parsers.parse("the response contains {count:d} tools"))
def check_tool_count(ctx, count):
    assert len(ctx.tools) == count


@then(parsers.parse('the tools include "{tool_name}"'))
def check_tool_present(ctx, tool_name):
    names = [t["name"] for t in ctx.tools]
    assert tool_name in names, f"Tool '{tool_name}' not found in {names}"


@then(parsers.parse('the "{tool_name}" tool requires "{field}"'))
def check_tool_required_field(ctx, tool_name, field):
    tool = next((t for t in ctx.tools if t["name"] == tool_name), None)
    assert tool is not None, f"Tool '{tool_name}' not found"
    required = tool["inputSchema"].get("required", [])
    assert field in required, (
        f"'{field}' not in required fields {required} for {tool_name}"
    )


@then("the response has a content array")
def check_content_array(ctx):
    assert ctx.response is not None
    content = ctx.response["result"]["content"]
    assert isinstance(content, list)
    assert len(content) > 0


@then(parsers.parse('the first content item has type "{content_type}"'))
def check_content_type(ctx, content_type):
    assert ctx.response["result"]["content"][0]["type"] == content_type


@then(parsers.parse("the response is a JSON-RPC error with code {code:d}"))
def check_error_code(ctx, code):
    assert ctx.response is not None
    assert "error" in ctx.response
    assert ctx.response["error"]["code"] == code


@then("the response result is empty")
def check_empty_result(ctx):
    assert ctx.response is not None
    assert ctx.response["result"] == {}


@then(parsers.parse('the audit actor is "{expected_actor}"'))
def check_audit_actor_value(ctx, expected_actor):
    actors = _get_audit_actors(ctx.audit_records)
    assert actors, "No audit records with actor field found"
    assert expected_actor in actors, (
        f"Expected actor {expected_actor!r} not in {actors}"
    )


@then("the audit session id matches the 12-char hex format")
def check_audit_session_id_shape(ctx):
    session_ids = [
        e["session_id"]
        for e in _parse_audit_records(ctx.audit_records)
        if "session_id" in e
    ]
    assert session_ids, "No audit records with session_id field found"
    for sid in session_ids:
        assert re.fullmatch(r"[0-9a-f]{12}", sid), (
            f"session_id {sid!r} does not match ^[0-9a-f]{{12}}$"
        )


# ---------------------------------------------------------------------------
# Non-dict clientInfo regression scenario
# ---------------------------------------------------------------------------

_NON_DICT_CLIENTINFO = {
    "string": "malicious-client",
    "list": [],
    "integer": 5,
    "null": None,
    "boolean": True,
}


@when(
    parsers.re(
        r'the server receives an "initialize" request with a non-dict '
        r'clientInfo of type "(?P<kind>[^"]+)"'
    ),
    target_fixture="ctx",
)
def send_initialize_non_dict_clientinfo(kind):
    return _send("initialize", req_id=1, params={"clientInfo": _NON_DICT_CLIENTINFO[kind]})


# ---------------------------------------------------------------------------
# Hostile clientInfo sanitization scenario
# ---------------------------------------------------------------------------


@when("the server is initialized with a hostile clientInfo name", target_fixture="ctx")
def send_hostile_initialize():
    # Build hostile name in code — control chars cannot be written in Gherkin
    hostile_name = "evil\r\nlog\x00inject\t" + "A" * 200
    return _send(
        "initialize",
        req_id=1,
        params={"clientInfo": {"name": hostile_name, "version": "1.0"}},
    )


@when("an audit event is triggered by calling an unknown tool")
def trigger_audit_event(ctx, caplog):
    with caplog.at_level(logging.INFO, logger="benefits_navigator.mcp_server"):
        _execute_tool("_probe", {})
    ctx.audit_records = list(caplog.records)


def _parse_audit_records(records: list) -> list[dict]:
    return [e for r in records if (e := _parse_audit_record(r)) is not None]


def _get_audit_actors(records: list) -> list[str]:
    return [e["actor"] for e in _parse_audit_records(records) if "actor" in e]


@then("the audit actor contains only printable characters")
def check_actor_printable(ctx):
    actors = _get_audit_actors(ctx.audit_records)
    assert actors, (
        f"No audit records with actor field found; records: "
        f"{[r.getMessage() for r in ctx.audit_records]}"
    )
    for actor in actors:
        for ch in actor:
            assert ch.isprintable(), (
                f"Non-printable character {ch!r} in actor {actor!r}"
            )


@then("the audit actor is at most 128 characters long")
def check_actor_length(ctx):
    actors = _get_audit_actors(ctx.audit_records)
    assert actors, "No audit records with actor field found"
    for actor in actors:
        assert len(actor) <= 128, f"Actor length {len(actor)} exceeds 128: {actor!r}"
