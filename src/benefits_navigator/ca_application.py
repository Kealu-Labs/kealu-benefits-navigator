"""California SAWS-1 application intake field definitions and submission instructions.

This module defines the structured personal-detail fields needed beyond the
basic household intake to pre-fill the official CA SAWS-1 form
(CalFresh / Medi-Cal / CalWORKs).  It also provides the deterministic
readiness check and the manual submission instructions displayed to the
applicant after the PDF is generated.
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Application field definitions — what personal info to collect for SAWS-1
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

# Minimum field keys required to produce a useful partial SAWS-1.
# ZIP + CA state are guaranteed by Tier 1 intake; name improves the form
# but is technically optional for the PDF to have value.
CA_MINIMUM_REQUIRED_KEYS: frozenset[str] = frozenset({"zip_code", "state"})

# ---------------------------------------------------------------------------
# Manual submission instructions
# ---------------------------------------------------------------------------

CA_SUBMISSION_INSTRUCTIONS: str = """\
## How to Submit Your SAWS-1 Application

Your pre-filled SAWS-1 application is ready to download. Review every field
carefully, fill in any blanks (especially your name, DOB, and SSN — which we
intentionally left blank for your privacy), sign and date the form, then submit
using ONE of these methods:

### Option 1: In-Person (Fastest Processing)
Drop off the signed form at your county CDSS office:
- Bring a government-issued photo ID
- Bring proof of income (recent pay stub, employer letter, or tax return)
- Ask for a date-stamped receipt — your benefit eligibility begins the date you submit

**Find your county office:**
https://www.cdss.ca.gov/county-offices

### Option 2: Online Application
- **BenefitsCal (CalFresh, Medi-Cal, CalWORKs):** https://www.benefitscal.com
- **Covered California (Medi-Cal / ACA plans):** https://www.coveredca.com
- **Phone:** 1-800-300-1506

The online form covers the same programs as the SAWS-1 — use whichever method is
more convenient. The pre-filled SAWS-1 is useful as a reference when completing
the online form.

### Option 3: Mail
Mail the completed, signed application to your county CDSS office. Allow 5–7
business days for delivery; your benefit date starts when the county receives it.

### Option 4: Fax
Call your county office for the current fax number.

---

## What Happens After You Apply

| Program | Decision timeline |
|---------|------------------|
| **CalFresh** | Within 30 days. Expedited within 3 days if monthly income ≤ $150 or net income ≤ $100 |
| **Medi-Cal** | Within 45 days (90 days for disability-based eligibility) |
| **CalWORKs** | Within 45 days |

You may be contacted for a phone or in-person interview. You have the right to
schedule the interview by phone and have a free interpreter provided.

---

## Documents to Bring / Have Ready

- [ ] Government-issued photo ID (driver license, passport, or state ID)
- [ ] Social Security cards for all household members applying
- [ ] Proof of income — last 30 days (pay stubs, employer letter, or tax return)
- [ ] Proof of California residency (lease, utility bill, or bank statement)
- [ ] Birth certificates for children (required for Medi-Cal / CHIP for kids)
- [ ] Proof of citizenship or immigration status (for programs that require it)

---

*This is an AI-generated draft. Review all fields carefully before submitting.
Eligibility determinations are estimates and subject to official county verification.*
"""


# ---------------------------------------------------------------------------
# Readiness check
# ---------------------------------------------------------------------------


def check_ca_readiness(args: dict[str, Any]) -> list[dict[str, str]]:
    """Return a list of missing fields blocking a meaningful SAWS-1 pre-fill.

    Parameters
    ----------
    args:
        Tool arguments or session vars.  Expects at minimum ``zip_code`` and
        ``state`` (or ``home_zip`` / ``home_state`` as already-normalized keys).

    Returns
    -------
    List of ``{key, label, prompt}`` dicts for each missing REQUIRED field.
    An empty list means the system has enough data to generate the PDF.
    """
    missing: list[dict[str, str]] = []

    # ZIP code — populated from intake Tier 1
    has_zip = bool(args.get("zip_code") or args.get("home_zip"))
    if not has_zip:
        missing.append({
            "key": "zip_code",
            "label": "California ZIP Code",
            "prompt": "What is your California ZIP code?",
        })

    # State = CA — must be California for SAWS-1
    state_raw = str(args.get("state") or args.get("home_state") or "").upper().strip()
    # Accept "CA", "California", "california", etc.
    is_california = state_raw in {"CA", "CALIFORNIA"}
    if not is_california:
        missing.append({
            "key": "state",
            "label": "California State",
            "prompt": (
                "This application form is specific to California. "
                "Please confirm you are applying for California benefits."
            ),
        })

    return missing


def format_ca_application_field(field: dict[str, str]) -> str:
    """Format a CA application field as a human-readable prompt block."""
    required_marker = " *(required)*" if field.get("required") == "true" else ""
    lines = [
        f"**{field['label']}{required_marker}**",
        f"*{field['why']}*",
        "",
        field["prompt"],
        "",
        f"Example: {field['example']}",
    ]
    return "\n".join(lines)


def get_next_ca_field(args: dict[str, Any]) -> dict[str, str] | None:
    """Return the next unanswered CA application field, or None if all answered.

    Checks each field in ``CA_APPLICATION_FIELDS`` order and returns the first
    whose key is absent or empty in *args*.  Optional fields are still surfaced
    so the user can decide whether to provide them.
    """
    for field in CA_APPLICATION_FIELDS:
        value = str(args.get(field["key"]) or "").strip()
        if not value:
            return field
    return None


def format_ca_review_summary(args: dict[str, Any]) -> str:
    """Format the collected CA application fields as a review/confirmation screen.

    Displays each field's label and current value (or '(not provided)' for
    optional blanks) so the user can confirm or correct before PDF generation.
    """
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
        value = str(args.get(field["key"]) or "").strip()
        display = value if value else "*(not provided)*"
        lines.append(f"| {field['label']} | {display} |")

    # Always show ZIP and state since those come from Tier 1 intake
    zip_code = str(args.get("zip_code") or args.get("home_zip") or "").strip()
    lines.append(f"| ZIP Code | {zip_code or '*(not provided)*'} |")
    lines.append(f"| State | California |")

    lines += [
        "",
        "When you're ready, reply **'confirm'** and I will generate your pre-filled SAWS-1 form.",
        "To correct a field, tell me what to change.",
    ]
    return "\n".join(lines)
