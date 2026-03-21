"""Step definitions for mcp_protocol.feature."""

from __future__ import annotations

from pytest_bdd import parsers, scenario, then, when

from benefit_navigator.mcp_server import _handle_request

# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@scenario("../features/mcp_protocol.feature", "Initialize handshake returns server capabilities")
def test_initialize():
    pass


@scenario("../features/mcp_protocol.feature", "Initialized notification returns no response")
def test_initialized_notification():
    pass


@scenario("../features/mcp_protocol.feature", "Tools list returns all navigator tools")
def test_tools_list():
    pass


@scenario("../features/mcp_protocol.feature", "navigate_benefits tool has required household_profile field")
def test_navigate_required_fields():
    pass


@scenario("../features/mcp_protocol.feature", "check_eligibility tool requires both profile and program")
def test_eligibility_required_fields():
    pass


@scenario("../features/mcp_protocol.feature", "compare_insurance_plans tool requires profile and zip")
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


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------


class McpContext:
    def __init__(self):
        self.response: dict | None = None
        self.tools: list[dict] = []


def _send(method, req_id=None, params=None):
    ctx = McpContext()
    request = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if req_id is not None:
        request["id"] = req_id
    ctx.response = _handle_request(request)
    if ctx.response and "result" in ctx.response and "tools" in ctx.response.get("result", {}):
        ctx.tools = ctx.response["result"]["tools"]
    return ctx


# ---------------------------------------------------------------------------
# When steps
# ---------------------------------------------------------------------------


@when(
    parsers.re(r'the server receives an? "(?P<method>[^"]+)" request with id (?P<req_id>\d+)'),
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
    parsers.re(r'the server receives an? "tools/call" for "(?P<tool_name>[^"]+)" with id (?P<req_id>\d+)'),
    target_fixture="ctx",
)
def send_tool_call(tool_name, req_id, datatable):
    ctx = McpContext()
    arguments = {row[0]: row[1].strip() for row in datatable}
    ctx.response = _handle_request({
        "jsonrpc": "2.0",
        "id": int(req_id),
        "method": "tools/call",
        "params": {"name": tool_name, "arguments": arguments},
    })
    return ctx


@when(
    parsers.re(r'the server receives an unknown method "(?P<method>[^"]+)" with id (?P<req_id>\d+)'),
    target_fixture="ctx",
)
def send_unknown_with_id(method, req_id):
    return _send(method, req_id=int(req_id))


@when(
    parsers.re(r'the server receives an unknown method "(?P<method>[^"]+)" without an id'),
    target_fixture="ctx",
)
def send_unknown_without_id(method):
    return _send(method)


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
    assert field in required, f"'{field}' not in required fields {required} for {tool_name}"


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
