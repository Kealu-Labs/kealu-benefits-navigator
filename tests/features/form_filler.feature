Feature: Official Form Filling with Fallback
  When an official fillable form is available for the user's state,
  the system fills it. Otherwise it falls back to a worksheet.

  Scenario: California gets the official SAWS-1 form filled
    Given a household profile for California
    And workflow output mentioning SNAP and Medicaid
    When generate_application is called
    Then the form type is "official"
    And the output PDF exists
    And the output PDF has fillable form fields

  Scenario: Texas falls back to the worksheet
    Given a household profile for Texas
    And workflow output mentioning SNAP and Medicaid
    When generate_application is called
    Then the form type is "worksheet"
    And the output PDF exists
    And the output PDF starts with "%PDF-1.4"

  Scenario: California form has correct program checkboxes
    Given a household profile for California
    And workflow output mentioning CalFresh and Medi-Cal
    When the official form is filled
    Then the CalFresh checkbox is checked
    And the Medi-Cal checkbox is checked

  Scenario: State name is normalized to code
    Given a household profile with state "California"
    And workflow output mentioning SNAP
    When generate_application is called
    Then the form type is "official"

  Scenario: Illinois gets the official IL444-2378B form filled
    Given a household profile for Illinois
    And workflow output mentioning SNAP and Medicaid
    When generate_application is called
    Then the form type is "official"
    And the output PDF exists
    And the output PDF has fillable form fields

  Scenario: New York gets the official LDSS-4826-DD form filled
    Given a household profile for New York
    And workflow output mentioning SNAP and Medicaid
    When generate_application is called
    Then the form type is "official"
    And the output PDF exists
    And the output PDF has fillable form fields

  Scenario: Pennsylvania gets the official PA-600 form filled
    Given a household profile for Pennsylvania
    And workflow output mentioning SNAP and Medicaid
    When generate_application is called
    Then the form type is "official"
    And the output PDF exists
    And the output PDF has fillable form fields

  Scenario: Unknown state falls back to worksheet
    Given a household profile with state "Guam"
    And workflow output mentioning SNAP
    When generate_application is called
    Then the form type is "worksheet"
