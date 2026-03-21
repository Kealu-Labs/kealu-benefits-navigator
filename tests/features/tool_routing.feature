Feature: Tool Execution and Routing
  Each MCP tool routes to the correct Vector workflow or kvr assist
  command, passing through all user-provided variables.

  Scenario: navigate_benefits invokes benefits-navigator workflow
    Given a complete demo profile with skip_intake
    When navigate_benefits is executed with mocked kvr
    Then kvr was invoked with workflow "benefits-navigator"
    And kvr was invoked with "--mode" "automated"

  Scenario: Workflow variables are passed through to kvr
    Given a complete demo profile with skip_intake
    And the profile includes
      | key          | value                |
      | medications  | Metformin 500mg      |
      | state        | Texas                |
      | county       | Harris County        |
    When navigate_benefits is executed with mocked kvr
    Then the kvr command includes var "household_profile" with value "Single parent, 2 kids ages 4 and 9, $42k income"
    And the kvr command includes var "zip_code" with value "77001"
    And the kvr command includes var "medications" with value "Metformin 500mg"
    And the kvr command includes var "state" with value "Texas"
    And the kvr command includes var "county" with value "Harris County"

  Scenario: Empty optional fields are not passed to kvr
    Given a complete demo profile with skip_intake
    When navigate_benefits is executed with mocked kvr
    Then the kvr command does not include var "medications"
    And the kvr command does not include var "providers"

  Scenario: check_eligibility invokes kvr assist with program name
    Given a check_eligibility call for program "SNAP"
      | household_profile | Single parent, 2 kids, $42k |
    When the tool is executed with mocked kvr assist
    Then kvr assist was invoked
    And the task description includes "SNAP"

  Scenario: compare_insurance_plans invokes kvr assist with zip code
    Given a compare_insurance_plans call
      | household_profile | Single parent, 2 kids, $42k |
      | zip_code          | 77001                       |
    When the tool is executed with mocked kvr assist
    Then kvr assist was invoked
    And the task description includes "77001"

  Scenario: Unknown tool returns error message
    When an unknown tool "nonexistent_tool" is executed
    Then the result contains "Unknown tool"
