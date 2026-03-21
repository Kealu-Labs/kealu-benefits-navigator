Feature: Phase streaming via MCP progress notifications
  The MCP server streams real-time workflow progress to the client
  using kvr's --phase-stream stdout and MCP notifications/progress.

  Scenario: Progress token enables phase streaming flag
    Given a navigate_benefits call with progress token "tok-123"
    When the kvr command is built
    Then the command includes "--phase-stream" "stdout"

  Scenario: No progress token omits phase streaming flag
    Given a navigate_benefits call without progress token
    When the kvr command is built
    Then the command does not include "--phase-stream"

  Scenario: workflow_start event sends initial progress
    Given a progress token "tok-456"
    When a workflow_start event arrives with 5 total phases
    Then an MCP progress notification is sent with progress 0 and total 5

  Scenario: phase_start event sends running progress
    Given a progress token "tok-456"
    And 1 phase has already completed out of 5
    When a phase_start event arrives for "evidence-verification"
    Then an MCP progress notification is sent with message containing "Running: Evidence Verification"

  Scenario: phase_complete event increments progress
    Given a progress token "tok-456"
    And 0 phases have completed out of 5
    When a phase_complete event arrives for "benefits-research"
    Then an MCP progress notification is sent with progress 1 and total 5
    And the message contains "Completed: Benefits Research"

  Scenario: All phases completing reaches total
    Given a progress token "tok-456"
    When phase_complete events arrive for all 5 phases
    Then the final progress notification has progress 5 and total 5

  Scenario: Phase stream prefix is correctly parsed
    Given a phase stream line for phase "action-plan"
    Then it is recognized as a phase stream event
    And the phase name is "action-plan"

  Scenario: Non-phase-stream lines are ignored
    Given a regular log line "INFO: Starting workflow..."
    Then it is not recognized as a phase stream event
