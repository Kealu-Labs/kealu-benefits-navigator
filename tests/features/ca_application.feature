Feature: California SAWS-1 Application Intake Flow
  California residents applying for CalFresh, Medi-Cal, or CalWORKs follow a
  structured intake flow that collects personal details one field at a time
  before generating the official SAWS-1 form.

  # -----------------------------------------------------------------------
  # check_ca_readiness
  # -----------------------------------------------------------------------

  Scenario: Readiness check fails when ZIP code is missing
    Given California application args with state "CA" but no ZIP code
    When check_ca_readiness is called
    Then the blockers list contains a "zip_code" entry

  Scenario: Readiness check fails when state is not California
    Given California application args with zip code "90001" and state "TX"
    When check_ca_readiness is called
    Then the blockers list contains a "state" entry

  Scenario: Readiness check passes when ZIP and CA state are provided
    Given California application args with zip code "90001" and state "CA"
    When check_ca_readiness is called
    Then the blockers list is empty

  # -----------------------------------------------------------------------
  # get_next_ca_field
  # -----------------------------------------------------------------------

  Scenario: First unanswered field is applicant_name when nothing is provided
    Given empty California application args
    When get_next_ca_field is called
    Then the returned field key is "applicant_name"

  Scenario: Next unanswered field is phone_home when applicant_name is provided
    Given California application args with applicant_name "Jane Smith"
    When get_next_ca_field is called
    Then the returned field key is "phone_home"

  Scenario: No next field when all CA application fields are answered
    Given California application args with all fields answered
    When get_next_ca_field is called
    Then no next field is returned

  # -----------------------------------------------------------------------
  # generate_application_draft CA intake via MCP tool
  # -----------------------------------------------------------------------

  Scenario: CA draft without applicant_name prompts for full legal name
    Given a CA generate_application_draft request without personal details
    When generate_application_draft is executed
    Then the result prompts for the applicant name field

  Scenario: CA draft with all personal details shows review screen before PDF
    Given a CA generate_application_draft request with all personal details
    When generate_application_draft is executed
    Then the result shows the review confirmation screen

  Scenario: CA draft generates SAWS-1 PDF after review is confirmed
    Given a CA generate_application_draft request with all personal details confirmed
    When generate_application_draft is executed
    Then the result contains the SAWS-1 file path
    And the result contains California submission instructions

  Scenario: Non-CA state bypasses CA intake and returns worksheet
    Given a Texas generate_application_draft request
    When generate_application_draft is executed
    Then the result contains a PDF file path
    And the result does not mention SAWS-1 submission instructions

  # -----------------------------------------------------------------------
  # _extract_form_data field mapping
  # -----------------------------------------------------------------------

  Scenario: applicant_name arg is mapped to the name form field key
    Given form args with applicant_name "Jane Smith"
    When _extract_form_data is called
    Then the form data contains key "name" with value "Jane Smith"

  Scenario: phone_home arg is mapped to the phone_home form field key
    Given form args with phone_home "(555) 123-4567"
    When _extract_form_data is called
    Then the form data contains key "phone_home" with value "(555) 123-4567"

  Scenario: home_address arg is mapped to the home_address form field key
    Given form args with home_address "123 Main St"
    When _extract_form_data is called
    Then the form data contains key "home_address" with value "123 Main St"

  Scenario: home_city arg is mapped to the home_city form field key
    Given form args with home_city "Los Angeles"
    When _extract_form_data is called
    Then the form data contains key "home_city" with value "Los Angeles"

  Scenario: email arg is mapped to the email form field key
    Given form args with email "jane@example.com"
    When _extract_form_data is called
    Then the form data contains key "email" with value "jane@example.com"

  Scenario: language_speak arg overrides the default English
    Given form args with language_speak "Spanish"
    When _extract_form_data is called
    Then the form data contains key "language_speak" with value "Spanish"
