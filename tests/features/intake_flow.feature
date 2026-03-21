Feature: Benefit Navigator Intake Flow
  The MCP server guides users through a tiered intake process,
  collecting household data progressively before triggering analysis.

  # ---------------------------------------------------------------
  # Tier 1: Critical fields (ZIP, income, household composition)
  # ---------------------------------------------------------------

  Scenario: Minimal request triggers tier-1 questions
    Given a navigate_benefits call with only
      | household_profile | I need help with benefits |
    When the intake completeness check runs
    Then the response stage is "getting_started"
    And the response asks for "ZIP code"
    And the response asks for "annual household income"
    And the response asks for "household size and ages"

  Scenario: ZIP code detected in profile text
    Given a navigate_benefits call with only
      | household_profile | Single mom in 77001 making $42k with 2 kids |
    When the intake completeness check runs
    Then the response does not ask for "ZIP code"

  Scenario: ZIP code provided as explicit field
    Given a navigate_benefits call with only
      | household_profile | Single mom making $42k with 2 kids |
      | zip_code          | 77001                              |
    When the intake completeness check runs
    Then the response does not ask for "ZIP code"

  Scenario: ZIP+4 format is recognized
    Given a navigate_benefits call with only
      | household_profile | Family in 77001-1234 earning $50k with 3 kids |
    When the intake completeness check runs
    Then the response does not ask for "ZIP code"

  Scenario Outline: Income keyword detection
    Given a navigate_benefits call with only
      | household_profile | <profile> |
    When the intake completeness check runs
    Then the response does not ask for "annual household income"

    Examples:
      | profile                                    |
      | I make $40k in Houston 77001, single mom   |
      | salary is 42000, zip 77001, 2 kids         |
      | earning about 3500/month, 77001, family    |
      | single parent income $42k, 77001, 2 kids   |

  Scenario: Household composition detected via family keywords
    Given a navigate_benefits call with only
      | household_profile | Single parent with 2 kids ages 4 and 9, $42k, 77001 |
    When the intake completeness check runs
    Then the response does not ask for "household size and ages"

  # ---------------------------------------------------------------
  # Tier 2: Recommended fields (coverage, medications, providers)
  # ---------------------------------------------------------------

  Scenario: Tier-1 complete triggers tier-2 personalization questions
    Given a navigate_benefits call with only
      | household_profile | Single parent, 2 kids ages 4 and 9, $42k income, ZIP 77001 |
    When the intake completeness check runs
    Then the response stage is "personalizing"
    And the response asks for "current insurance status"
    And the response asks for "current medications"
    And the response asks for "current doctors"
    And the response asks for "monthly premium budget"
    And the response includes can_proceed guidance

  Scenario: Coverage status detected in natural language
    Given a navigate_benefits call with only
      | household_profile | Single parent, 2 kids ages 4 and 9, $42k, 77001, uninsured since January |
    When the intake completeness check runs
    Then the response does not ask for "current insurance status"

  Scenario: Medications provided as explicit field skips that question
    Given a navigate_benefits call with only
      | household_profile | Single parent, 2 kids ages 4 and 9, $42k, 77001 |
      | medications       | Metformin 500mg 2x/day                           |
    When the intake completeness check runs
    Then the response does not ask for "current medications"

  # ---------------------------------------------------------------
  # Full profile and skip_intake
  # ---------------------------------------------------------------

  Scenario: Fully complete profile skips intake entirely
    Given a navigate_benefits call with all fields populated
    When the intake completeness check runs
    Then the response is None

  Scenario: skip_intake bypasses all checks
    Given a navigate_benefits call with only
      | household_profile | I need help |
      | skip_intake       | true        |
    When the tool is executed
    Then the intake check was skipped

  # ---------------------------------------------------------------
  # Provided data summary
  # ---------------------------------------------------------------

  Scenario: Provided data is summarized back to the user
    Given a navigate_benefits call with only
      | household_profile | single mom |
      | zip_code          | 77001      |
    When the intake completeness check runs
    Then the provided summary includes "Zip Code: 77001"
    And the provided summary includes "single mom"
