#
# Copyright 2025 Kealu Inc. All rights reserved.
# Licensed under the Kealu Vector License v1.0 — PATENT PENDING
#
"""California SAWS-1 intake field definitions and profile-based helpers."""

from __future__ import annotations

from benefits_navigator.applications.models import ApplicationProfile, is_skip_sentinel

# ---------------------------------------------------------------------------
# Field definitions — ordered list surfaced one-at-a-time during intake
# ---------------------------------------------------------------------------

CA_APPLICATION_FIELDS: list[dict[str, str]] = [
    {
        "key": "applicant_name",
        "label": "Full Legal Name",
        "why": "Required on the SAWS-1 form to identify your application",
        "prompt": (
            "What is your full legal name as it appears on official documents? "
            "(First Middle Last)"
        ),
        "example": "Jane Marie Smith",
        "required": "true",
    },
    {
        "key": "phone_home",
        "label": "Phone Number",
        "why": "CDSS may call you about your application status",
        "prompt": "What is your best phone number?",
        "example": "(555) 123-4567",
        "required": "false",
    },
    {
        "key": "home_address",
        "label": "Street Address",
        "why": "Your county office uses this to assign your case worker",
        "prompt": "What is your street address? (Do not include city or ZIP here)",
        "example": "123 Main Street, Apt 4B",
        "required": "false",
    },
    {
        "key": "home_city",
        "label": "City",
        "why": "Determines which county office processes your application",
        "prompt": "What city do you live in?",
        "example": "Los Angeles",
        "required": "false",
    },
    {
        "key": "email",
        "label": "Email Address",
        "why": "Optional — county may send application notices electronically",
        "prompt": (
            "What is your email address? "
            "(Optional — press Enter or type 'skip' to leave blank)"
        ),
        "example": "jane@example.com",
        "required": "false",
    },
    {
        "key": "language_speak",
        "label": "Primary Language Spoken",
        "why": (
            "You have the right to a free interpreter — "
            "CDSS will provide one for your interview"
        ),
        "prompt": "What language do you primarily speak?",
        "example": "English, Spanish, Cantonese, Vietnamese, etc.",
        "required": "false",
    },
]

# Minimum ApplicationProfile fields required to generate a partial SAWS-1.
# home_zip and home_state are guaranteed by Tier-1 intake.
CA_MINIMUM_REQUIRED_KEYS: frozenset[str] = frozenset({"home_zip", "home_state"})


def check_ca_readiness(profile: ApplicationProfile) -> list[dict[str, str]]:
    """Return blocking issues that prevent SAWS-1 generation.

    Checks that the profile has a California ZIP code and state. Returns a
    list of ``{key, label, prompt}`` dicts — empty means ready.
    """
    missing: list[dict[str, str]] = []

    if not profile.home_zip:
        missing.append({
            "key": "zip_code",
            "label": "California ZIP Code",
            "prompt": "What is your California ZIP code?",
        })

    state = profile.home_state.upper().strip()
    if state not in {"CA", "CALIFORNIA"}:
        missing.append({
            "key": "state",
            "label": "California State",
            "prompt": (
                "This application form is specific to California. "
                "Please confirm you are applying for California benefits."
            ),
        })

    return missing


def get_next_ca_field(profile: ApplicationProfile) -> dict[str, str] | None:
    """Return the next unanswered CA intake field, or None when all are answered.

    An optional field counts as answered when the applicant declines it with a
    skip sentinel ("skip", "none", ...); a required field does not, so it is
    asked again rather than shipping a blank on the form.
    """
    for field in CA_APPLICATION_FIELDS:
        value = str(getattr(profile, field["key"], "") or "").strip()
        if is_skip_sentinel(value):
            if field["required"] == "true":
                return field
            continue
        if not value:
            return field
    return None


def format_ca_review_summary(profile: ApplicationProfile) -> str:
    """Render all collected CA fields as a markdown confirmation table."""
    lines = [
        "## Review Your California SAWS-1 Application",
        "",
        "Please review the information below before your form is generated.",
        "Reply **'confirm'** to generate the PDF, or let me know what to correct.",
        "",
        "| Field | Your Answer |",
        "|-------|-------------|",
    ]
    for field in CA_APPLICATION_FIELDS:
        value = str(getattr(profile, field["key"], "") or "").strip()
        if is_skip_sentinel(value):
            display = "*(skipped — will be left blank)*"
        elif value:
            display = value
        else:
            display = "*(not provided)*"
        lines.append(f"| {field['label']} | {display} |")

    zip_display = profile.home_zip or "*(not provided)*"
    lines.append(f"| ZIP Code | {zip_display} |")
    lines.append("| State | California |")

    lines += [
        "",
        "When you're ready, reply **'confirm'** and I will generate your pre-filled SAWS-1 form.",
        "To correct a field, tell me what to change.",
    ]
    return "\n".join(lines)
