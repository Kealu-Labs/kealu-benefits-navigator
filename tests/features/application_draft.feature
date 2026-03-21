Feature: Application Draft PDF Generation
  After the benefit navigator produces an analysis, users can generate
  a pre-filled PDF application draft for review before submitting to agencies.

  Scenario: PDF is generated with correct structure
    Given a household profile for a single parent in Texas
    And workflow output mentioning SNAP and CHIP eligibility
    When generate_application_draft is executed
    Then a PDF file is created on disk
    And the PDF starts with a valid header
    And the PDF contains 3 pages

  Scenario: PDF extracts eligible programs from workflow output
    Given a household profile for a single parent in Texas
    And workflow output mentioning SNAP and CHIP eligibility
    When generate_application_draft is executed
    Then the tool result mentions the file path
    And the tool result includes review instructions

  Scenario: Missing workflow output returns guidance
    Given a household profile for a single parent in Texas
    But no workflow output is provided
    When generate_application_draft is executed
    Then the result instructs to run navigate_benefits first

  Scenario: Household details are parsed into the PDF
    Given a household profile "Single parent making $42k with two kids ages 4 and 9"
    And the zip code is "77001"
    And workflow output mentioning Medicaid eligibility
    When the PDF is generated and read back
    Then the PDF text contains "77001"
    And the PDF text contains "42,000"
    And the PDF text contains "DRAFT"
