Feature: Healthcare.gov Marketplace API integration
  Real insurance plan data from CMS enriches the benefit navigator.

  Background:
    Given the demo household profile

  # --- County resolution ---

  Scenario: ZIP code resolves to county FIPS
    When the marketplace API resolves ZIP "77001"
    Then the county FIPS is "48201"
    And the county state is "TX"

  Scenario: Invalid ZIP returns empty county list
    When the marketplace API resolves ZIP "00000"
    Then the county list is empty

  # --- Eligibility estimates ---

  Scenario: Eligibility estimate returns APTC and FPL
    Given county FIPS "48201" in state "TX"
    When eligibility is estimated for income 42000 with 3 people
    Then the APTC is greater than 0
    And the FPL percentage is approximately 163

  Scenario: Low-income household flags Medicaid/CHIP
    Given county FIPS "48201" in state "TX"
    When eligibility is estimated for income 20000 with 3 people
    Then the result flags Medicaid/CHIP eligibility

  # --- Plan search ---

  Scenario: Plan search returns real marketplace plans
    Given county FIPS "48201" in state "TX"
    When plans are searched for ZIP "77001" with income 42000
    Then at least 1 plan is returned
    And each plan has a name, metal level, and premium

  Scenario: Plan search applies APTC to premiums
    Given county FIPS "48201" in state "TX"
    When plans are searched for ZIP "77001" with income 42000
    Then each plan has premium_w_credit less than or equal to premium

  Scenario: Plans can be filtered by metal level
    Given county FIPS "48201" in state "TX"
    When plans are searched for ZIP "77001" with income 42000 filtering "Silver"
    Then all returned plans have metal level "Silver"

  # --- Format output ---

  Scenario: Plan summary includes premium range and APTC
    Given a mock plan search result with 3 plans
    And a mock eligibility result with APTC 380.00
    When the results are formatted
    Then the summary includes "Healthcare.gov Marketplace Plans"
    And the summary includes "Estimated monthly tax credit"
    And the summary includes "Premium range"

  Scenario: Plan summary shows up to 5 plans
    Given a mock plan search result with 8 plans
    When the results are formatted
    Then the summary shows at most 5 plan details
    And the summary mentions "8" total plans

  # --- Insurance comparison integration ---

  Scenario: compare_insurance_plans uses marketplace API when key is set
    Given CMS_API_KEY is set
    When compare_insurance_plans is called for ZIP "77001"
    Then the result includes "Healthcare.gov Marketplace Plans"
    And the result includes real plan names

  Scenario: compare_insurance_plans falls back to kvr when no API key
    Given CMS_API_KEY is not set
    When compare_insurance_plans is called for ZIP "77001" with kvr fallback
    Then kvr assist was invoked

  Scenario: compare_insurance_plans falls back on API error
    Given CMS_API_KEY is set
    And the marketplace API is unreachable
    When compare_insurance_plans is called for ZIP "77001" with kvr fallback
    Then the result includes "Live marketplace data unavailable"

  # --- Eligibility enrichment ---

  Scenario: check_eligibility enriches with CMS data when key is set
    Given CMS_API_KEY is set
    When check_eligibility is called for "Medicaid" with kvr fallback
    Then the result includes "CMS Marketplace Data (Live)"
    And the result includes "APTC"

  # --- Household parsing ---

  Scenario: Household profile is parsed into API people list
    When the profile "Single parent, 2 kids ages 4 and 9, $42k income" is parsed
    Then 3 people are extracted
    And the ages include 4 and 9

  Scenario: Income is extracted from profile text
    When income is parsed from "Single parent, $42k income"
    Then the parsed income is 42000

  Scenario: Income shorthand is expanded
    When income is parsed from "making $52k/yr"
    Then the parsed income is 52000
