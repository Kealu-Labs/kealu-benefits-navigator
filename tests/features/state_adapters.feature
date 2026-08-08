Feature: State application adapter registry
  As a developer extending the benefits navigator to new states,
  I want a registry-based adapter pattern so that adding a state
  requires only implementing the adapter protocol and registering it,
  with no changes to the shared MCP or application layer.

  # ---------------------------------------------------------------------------
  # Registry correctness
  # ---------------------------------------------------------------------------

  Scenario: California adapter is registered in the state registry
    Given the state registry is initialized
    When I look up state "CA" in the registry
    Then a non-None adapter is returned
    And the adapter supports programs "CalFresh", "Medi-Cal", and "CalWORKs"

  Scenario: Unsupported state returns None from the registry
    Given the state registry is initialized
    When I look up state "TX" in the registry
    Then the registry returns None

  Scenario: State code lookup is case-insensitive
    Given the state registry is initialized
    When I look up state "ca" in the registry
    Then a non-None adapter is returned

  # ---------------------------------------------------------------------------
  # Fake adapter registration
  # ---------------------------------------------------------------------------

  Scenario: A fake adapter can be registered and invoked through the registry
    Given a fake adapter is registered for state "ZZ"
    When I call generate_documents on the fake adapter via the registry
    Then the fake adapter's generate_documents method is called
    And the registry is cleaned up after the test

  # ---------------------------------------------------------------------------
  # Readiness determinism
  # ---------------------------------------------------------------------------

  Scenario: Readiness check is deterministic for the same profile
    Given a California profile with ZIP "90001" and state "CA"
    When readiness_blockers is called twice on the same profile
    Then both results are identical and empty

  Scenario: Readiness check blocks when ZIP is missing
    Given a California profile with no ZIP and state "CA"
    When readiness_blockers is called on the profile
    Then the blockers list contains a "zip_code" entry

  # ---------------------------------------------------------------------------
  # Intake flow through adapter
  # ---------------------------------------------------------------------------

  Scenario: MCP generate_application_draft requires review confirmation before PDF
    Given a CA generate_application_draft request with all personal details but no confirmation
    When generate_application_draft is executed via the MCP layer
    Then the result shows the review confirmation screen

  Scenario: MCP generate_application_draft generates PDF after confirmation
    Given a CA generate_application_draft request with all personal details confirmed
    When generate_application_draft is executed via the MCP layer
    Then the result contains the SAWS-1 file path
    And the result contains California submission instructions

  # ---------------------------------------------------------------------------
  # Fallback behavior for unsupported states
  # ---------------------------------------------------------------------------

  Scenario: Unsupported state bypasses adapter and uses fallback path
    Given a Texas generate_application_draft request
    When generate_application_draft is executed via the MCP layer
    Then the result contains a PDF file path
    And the result does not mention SAWS-1 submission instructions
