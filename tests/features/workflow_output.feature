Feature: Workflow Output Formatting
  The MCP server collects kvr phase outputs and returns structured
  results that Antigravity renders to the user. Mocked kvr responses
  use realistic Texas-specific data for the demo household profile.

  Background:
    Given the demo household profile
      | field             | value                                            |
      | household_profile | Single parent, 2 kids ages 4 and 9, $42k income  |
      | zip_code          | 77001                                            |
      | state             | Texas                                            |
      | county            | Harris County                                    |
      | skip_intake       | true                                             |

  # ---------------------------------------------------------------
  # End-to-end: intake → kvr → output → MCP response
  # ---------------------------------------------------------------

  Scenario: All five phase outputs plus sources section are collected and formatted
    Given the kvr workflow produces all 5 phases
    When navigate_benefits completes
    Then the MCP response contains 6 sections separated by horizontal rules
    And each section has a markdown heading

  Scenario: Phase outputs appear in workflow order
    Given the kvr workflow produces all 5 phases
    When navigate_benefits completes
    Then "Benefits Research" appears before "Insurance Research"
    And "Insurance Research" appears before "Evidence Verification"
    And "Evidence Verification" appears before "Eligibility Validation"
    And "Eligibility Validation" appears before "Action Plan"

  # ---------------------------------------------------------------
  # Benefits research: Texas-specific programs
  # ---------------------------------------------------------------

  Scenario: Benefits research identifies Texas programs with dollar estimates
    Given the kvr workflow produces all 5 phases
    When navigate_benefits completes
    Then the response mentions "SNAP" with a dollar amount
    And the response mentions "CHIP" with eligibility status
    And the response mentions "Medicaid"
    And the response mentions "LIHEAP"

  Scenario: Benefits research flags Texas as Medicaid non-expansion state
    Given the kvr workflow produces all 5 phases
    When navigate_benefits completes
    Then the response contains "NOT expanded Medicaid"

  # ---------------------------------------------------------------
  # Insurance research: ACA marketplace data
  # ---------------------------------------------------------------

  Scenario: Insurance research returns plan-level premium estimates
    Given the kvr workflow produces all 5 phases
    When navigate_benefits completes
    Then the response contains "APTC" or "subsidy"
    And the response contains a monthly dollar amount
    And the response mentions "Silver" or "Bronze" plan tier

  # ---------------------------------------------------------------
  # Evidence verification: adversarial fact-checking
  # ---------------------------------------------------------------

  Scenario: Evidence verification recalculates FPL percentage
    Given the kvr workflow produces all 5 phases
    When navigate_benefits completes
    Then the response contains "162.7% FPL" or "162.7%"

  Scenario: Evidence verification catches SNAP threshold error
    Given the kvr workflow produces all 5 phases
    When navigate_benefits completes
    Then the response contains "CORRECTION"
    And the response mentions SNAP eligibility revision

  # ---------------------------------------------------------------
  # Eligibility validation: cross-referenced determinations
  # ---------------------------------------------------------------

  Scenario: Eligibility validation produces structured determination table
    Given the kvr workflow produces all 5 phases
    When navigate_benefits completes
    Then the response contains "ELIGIBLE" for CHIP
    And the response contains "NOT ELIGIBLE" for Medicaid parent

  # ---------------------------------------------------------------
  # Action plan: actionable enrollment steps
  # ---------------------------------------------------------------

  Scenario: Action plan contains government URLs
    Given the kvr workflow produces all 5 phases
    When navigate_benefits completes
    Then the response contains "yourtexasbenefits.com"
    And the response contains "healthcare.gov"

  Scenario: Action plan includes document checklist
    Given the kvr workflow produces all 5 phases
    When navigate_benefits completes
    Then the response contains "birth certificates" or "pay stubs"
    And the response contains "documents" or "Documents"

  Scenario: Action plan flags time-sensitive deadlines
    Given the kvr workflow produces all 5 phases
    When navigate_benefits completes
    Then the response contains "Special Enrollment" or "deadline"

  # ---------------------------------------------------------------
  # Error handling
  # ---------------------------------------------------------------

  Scenario: Workflow failure returns informative error
    Given the kvr workflow fails with no decision log
    When navigate_benefits completes
    Then the response contains "failed"
