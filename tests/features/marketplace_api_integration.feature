Feature: Healthcare.gov Marketplace API integration tests
  Live tests against the CMS Marketplace API to verify contract compatibility.
  These tests require CMS_API_KEY to be set and are skipped otherwise.

  @integration
  Scenario: Live ZIP code resolves to county
    When the live API resolves ZIP "77001"
    Then the live county result has at least 1 county
    And the live county has a FIPS code and state

  @integration
  Scenario: Live eligibility estimate returns APTC fields
    Given live county FIPS for ZIP "77001"
    When live eligibility is estimated for income 42000 with 3 people
    Then the live result contains "aptc" and "csr" fields
    And the live APTC is greater than 0

  @integration
  Scenario: Live plan search returns real plans
    Given live county FIPS for ZIP "77001"
    When live plans are searched with income 42000
    Then at least 1 live plan is returned
    And each live plan has name, issuer, metal_level, premium, and premium_w_credit
