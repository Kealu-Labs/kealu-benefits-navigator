Feature: MCP Protocol Compliance
  The server implements MCP JSON-RPC 2.0 over stdio correctly,
  ensuring Antigravity can discover and invoke benefit navigator tools.

  Scenario: Initialize handshake returns server capabilities
    When the server receives an "initialize" request with id 1
    Then the response includes protocolVersion "2024-11-05"
    And the response includes serverInfo name "benefits-navigator"
    And the capabilities include "tools"

  Scenario: Initialized notification returns no response
    When the server receives a "notifications/initialized" notification
    Then no response is sent

  Scenario: Tools list returns all navigator tools
    When the server receives a "tools/list" request with id 2
    Then the response contains 4 tools
    And the tools include "navigate_benefits"
    And the tools include "check_eligibility"
    And the tools include "compare_insurance_plans"
    And the tools include "generate_application_draft"

  Scenario: navigate_benefits tool has required household_profile field
    When the server receives a "tools/list" request with id 3
    Then the "navigate_benefits" tool requires "household_profile"

  Scenario: check_eligibility tool requires both profile and program
    When the server receives a "tools/list" request with id 4
    Then the "check_eligibility" tool requires "household_profile"
    And the "check_eligibility" tool requires "program"

  Scenario: compare_insurance_plans tool requires profile and zip
    When the server receives a "tools/list" request with id 5
    Then the "compare_insurance_plans" tool requires "household_profile"
    And the "compare_insurance_plans" tool requires "zip_code"

  Scenario: Tool call returns MCP content array
    When the server receives a "tools/call" for "navigate_benefits" with id 10
      | household_profile | I need help with benefits |
    Then the response has a content array
    And the first content item has type "text"

  Scenario: Unknown method returns JSON-RPC error
    When the server receives an unknown method "foo/bar" with id 99
    Then the response is a JSON-RPC error with code -32601

  Scenario: Unknown method without id is silent
    When the server receives an unknown method "foo/bar" without an id
    Then no response is sent

  Scenario: Ping returns empty result
    When the server receives a "ping" request with id 42
    Then the response result is empty
