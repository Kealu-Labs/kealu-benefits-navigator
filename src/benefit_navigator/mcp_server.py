"""Minimal MCP (Model Context Protocol) server exposing the Benefit Navigator as tools.

Uses only the Python standard library (stdin/stdout JSON-RPC 2.0) so it
adds **zero** new dependencies.

Antigravity ``mcp_config.json`` entry::

    {
      "mcpServers": {
        "benefit-navigator": {
          "command": "/path/to/.venv/bin/python",
          "args": ["-m", "benefit_navigator"],
          "cwd": "/path/to/kealu-benefit-navigator"
        }
      }
    }

MCP protocol reference: https://modelcontextprotocol.io/specification
"""

from __future__ import annotations

import json
import logging
import sys
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

_TOOLS = [
    {
        "name": "navigate_benefits",
        "description": (
            "ALWAYS use this tool when users ask about government benefits, insurance, "
            "Medicaid, SNAP, CHIP, WIC, TANF, Section 8, LIHEAP, ACA marketplace plans, "
            "or eligibility for any public assistance program. "
            "Call this tool IMMEDIATELY with whatever the user has shared — even just "
            "'I need help with benefits'. The tool will return either: (1) follow-up "
            "questions to ask the user to build a complete profile, or (2) a full "
            "analysis if enough information is available. Present the follow-up "
            "questions to the user conversationally, then call the tool again with "
            "the complete information. Covers all 50 US states, DC, and territories."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "household_profile": {
                    "type": "string",
                    "description": (
                        "Whatever the user has shared about their household so far. "
                        "Can be as simple as 'single parent, two kids' or as detailed "
                        "as a full profile with income, ages, location, employment."
                    ),
                },
                "state": {
                    "type": "string",
                    "description": "US state or territory (e.g. 'Texas', 'Puerto Rico')",
                },
                "county": {
                    "type": "string",
                    "description": "County name (e.g. 'Harris County')",
                },
                "zip_code": {
                    "type": "string",
                    "description": "ZIP code for insurance marketplace lookup",
                },
                "income_type": {
                    "type": "string",
                    "description": "W-2 employee | self-employed | gig/1099 | mixed | unemployed",
                },
                "medications": {
                    "type": "string",
                    "description": (
                        "Current medications with dosage and frequency "
                        "(e.g. 'Metformin 500mg 2x/day, Lisinopril 10mg daily')"
                    ),
                },
                "providers": {
                    "type": "string",
                    "description": "Current doctors/providers to keep in-network (name, practice, specialty)",
                },
                "health_needs": {
                    "type": "string",
                    "description": "Chronic conditions, anticipated procedures, pregnancy plans, mental health needs",
                },
                "usage_pattern": {
                    "type": "string",
                    "description": (
                        "Estimated annual healthcare usage: PCP visits, specialist visits, "
                        "ER visits, urgent care visits (e.g. '8 PCP, 2 specialist, 1 ER')"
                    ),
                },
                "current_coverage": {
                    "type": "string",
                    "description": "Currently insured? Through what? COBRA eligible? Reason for coverage gap?",
                },
                "premium_budget": {
                    "type": "string",
                    "description": "Maximum monthly premium budget (e.g. '$300/month')",
                },
                "network_preference": {
                    "type": "string",
                    "description": "HMO acceptable? Need PPO? Referral concerns?",
                },
                "pharmacy_preference": {
                    "type": "string",
                    "description": "Preferred pharmacy (CVS, Walgreens, mail-order, etc.)",
                },
                "existing_benefits": {
                    "type": "string",
                    "description": "Benefits already receiving (SNAP, Medicaid, WIC, etc.)",
                },
                "assets": {
                    "type": "string",
                    "description": "Savings, property — needed for programs with asset tests",
                },
                "expected_income_change": {
                    "type": "string",
                    "description": "Anticipated raise, job change, or income reduction",
                },
                "skip_intake": {
                    "type": "string",
                    "description": (
                        "Set to 'true' to skip intake questions and run the analysis "
                        "with whatever data is available. Use after the user has answered "
                        "follow-up questions, or if the user wants to proceed without "
                        "providing additional details."
                    ),
                },
            },
            "required": ["household_profile"],
        },
    },
    {
        "name": "check_eligibility",
        "description": (
            "ALWAYS use this tool to check eligibility for a specific government "
            "program (Medicaid, CHIP, SNAP, WIC, LIHEAP, Section 8, TANF, ACA "
            "Marketplace, etc.). Validates against 2025 FPL thresholds and "
            "state-specific rules including Medicaid expansion status."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "household_profile": {
                    "type": "string",
                    "description": "Household details: income, size, ages, location",
                },
                "program": {
                    "type": "string",
                    "description": (
                        "Program to check: Medicaid, CHIP, SNAP, WIC, LIHEAP, "
                        "Section 8, TANF, ACA Marketplace, etc."
                    ),
                },
            },
            "required": ["household_profile", "program"],
        },
    },
    {
        "name": "compare_insurance_plans",
        "description": (
            "ALWAYS use this tool to compare health insurance plans. Analyzes all "
            "6 channels: ACA marketplace (with APTC subsidy calculation), "
            "off-marketplace carrier plans, short-term/gap insurance, health "
            "sharing ministries, ICHRA, and QSEHRA. Calculates cost-of-care "
            "scenarios and identifies optimal plan by household needs."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "household_profile": {
                    "type": "string",
                    "description": "Household details: income, size, ages, location",
                },
                "zip_code": {
                    "type": "string",
                    "description": "ZIP code for marketplace plan lookup",
                },
                "medications": {
                    "type": "string",
                    "description": "Current medications for formulary matching (drug name, dosage, frequency)",
                },
                "providers": {
                    "type": "string",
                    "description": "Current doctors/providers for network matching",
                },
                "health_needs": {
                    "type": "string",
                    "description": "Chronic conditions, anticipated procedures, mental health needs",
                },
                "usage_pattern": {
                    "type": "string",
                    "description": "Annual usage: PCP visits, specialist visits, ER visits, urgent care",
                },
                "premium_budget": {
                    "type": "string",
                    "description": "Maximum monthly premium budget",
                },
                "network_preference": {
                    "type": "string",
                    "description": "HMO acceptable? Need PPO? Referral concerns?",
                },
                "pharmacy_preference": {
                    "type": "string",
                    "description": "Preferred pharmacy (CVS, Walgreens, mail-order)",
                },
            },
            "required": ["household_profile", "zip_code"],
        },
    },
    {
        "name": "generate_application_draft",
        "description": (
            "Generate a pre-filled PDF application draft for benefit programs the "
            "user is eligible for. Call this AFTER navigate_benefits has returned "
            "results. The PDF is a DRAFT for the user to review — it pre-fills "
            "known fields (income, household size, location, eligible programs, "
            "required documents) and leaves sensitive fields blank (SSN, DOB). "
            "Returns the file path to the generated PDF."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "household_profile": {
                    "type": "string",
                    "description": "Household details (same as navigate_benefits)",
                },
                "state": {
                    "type": "string",
                    "description": "US state",
                },
                "zip_code": {
                    "type": "string",
                    "description": "5-digit ZIP code",
                },
                "income_type": {
                    "type": "string",
                    "description": "Employment, self-employment, unemployment, etc.",
                },
                "health_needs": {
                    "type": "string",
                    "description": "Health conditions and needs",
                },
                "workflow_output": {
                    "type": "string",
                    "description": (
                        "The full text output from navigate_benefits. Pass the "
                        "complete analysis so the PDF can extract eligible programs "
                        "and document requirements."
                    ),
                },
            },
            "required": ["household_profile", "workflow_output"],
        },
    },
]

# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------


def _execute_tool(name: str, arguments: dict[str, Any], *, progress_token: str | None = None) -> str:
    """Execute a tool by running the corresponding Vector workflow.

    Returns the workflow output as a string.
    """
    if name == "navigate_benefits":
        if arguments.get("skip_intake") != "true":
            missing = _check_intake_completeness(arguments)
            if missing:
                return missing
        return _run_benefit_navigator(arguments, progress_token=progress_token)
    if name == "check_eligibility":
        return _run_eligibility_check(arguments)
    if name == "compare_insurance_plans":
        return _run_insurance_comparison(arguments)
    if name == "generate_application_draft":
        return _run_generate_application_draft(arguments)
    return f"Unknown tool: {name}"


# ---------------------------------------------------------------------------
# Intake completeness check
# ---------------------------------------------------------------------------

# Fields grouped by intake priority.  Each entry is
# (arg_key, user-friendly label, why-it-matters, example prompt).
_INTAKE_FIELDS: list[tuple[str, str, str, str]] = [
    # --- Tier 1: Must-have for any analysis ---
    (
        "zip_code",
        "ZIP code",
        "determines which insurance plans are available and correct county/state",
        "What's your ZIP code?",
    ),
    (
        "income",
        "annual household income",
        "needed to calculate Federal Poverty Level and subsidy eligibility",
        "What is your approximate annual household income (before taxes)?",
    ),
    (
        "household_size_and_ages",
        "household size and ages",
        "different family members qualify for different programs (CHIP for kids, WIC for under 5, etc.)",
        "How many people are in your household, and what are their ages?",
    ),
    # --- Tier 2: Needed for personalized plan matching ---
    (
        "current_coverage",
        "current insurance status",
        "affects urgency — if you recently lost coverage, you may have a 60-day Special Enrollment window closing soon",
        "Do you currently have health insurance? If not, when did your coverage end and why?",
    ),
    (
        "medications",
        "current medications",
        "the same drug can cost $10 on one plan and $200 on another — we need to check formulary tiers",
        "Are you or your family members currently taking any prescription medications? If so, which ones and what dosage?",
    ),
    (
        "providers",
        "current doctors",
        "we need to verify your doctors are in-network for each plan we recommend",
        "Do you have doctors you want to keep seeing? If so, their names and practices?",
    ),
    # --- Tier 3: Refines the recommendation ---
    (
        "premium_budget",
        "monthly premium budget",
        "helps us eliminate plans you can't afford and find the best value within your budget",
        "What's the most you can afford per month for health insurance premiums?",
    ),
    (
        "health_needs",
        "health conditions or anticipated needs",
        "chronic conditions, planned surgeries, or pregnancy plans change which plan is the best value",
        "Does anyone in your household have ongoing health conditions, or do you anticipate any major medical needs this year (surgery, pregnancy, etc.)?",
    ),
]


def _check_intake_completeness(args: dict[str, Any]) -> str | None:
    """Return intake guidance if the profile is too sparse, or None if ready.

    Checks whether the user has provided enough information for a
    meaningful analysis.  If critical fields are missing, returns a
    structured response that tells the host agent which questions to ask.
    """
    profile = args.get("household_profile", "")
    profile_lower = profile.lower()

    # --- Tier 1: absolute minimum to run any analysis ---
    missing_critical: list[tuple[str, str, str]] = []
    missing_recommended: list[tuple[str, str, str]] = []

    # Check ZIP code — explicit field or embedded in profile
    has_zip = bool(args.get("zip_code")) or _contains_zip(profile)
    if not has_zip:
        missing_critical.append(
            (
                "ZIP code",
                "determines which insurance plans are available and correct county/state",
                "What's your ZIP code?",
            )
        )

    # Check income — explicit field or mentioned in profile
    has_income = any(
        marker in profile_lower
        for marker in [
            "$",
            "income",
            "salary",
            "earn",
            "make",
            "making",
            "k/yr",
            "k per",
            "per year",
        ]
    )
    if not has_income:
        missing_critical.append(
            (
                "annual household income",
                "needed to calculate Federal Poverty Level (FPL) — the foundation for almost all benefit eligibility",
                "What is your approximate annual household income (before taxes)?",
            )
        )

    # Check household composition
    has_household = any(
        marker in profile_lower
        for marker in [
            "kid",
            "child",
            "son",
            "daughter",
            "spouse",
            "wife",
            "husband",
            "single",
            "married",
            "family of",
            "household of",
            "age",
            "ages",
            "year old",
            "years old",
            "yr old",
        ]
    )
    if not has_household:
        missing_critical.append(
            (
                "household size and ages",
                "different family members qualify for different programs (CHIP for kids under 19, WIC for under 5, Medicaid varies by age)",
                "How many people are in your household, and what are their ages?",
            )
        )

    # If any critical fields are missing, return guidance immediately
    if missing_critical:
        return _format_intake_response(
            stage="getting_started",
            message=(
                "I'd love to help you find every benefit and insurance option you qualify for. "
                "To give you a personalized analysis (not generic advice), I need a few key details."
            ),
            questions=missing_critical,
            provided=_summarize_provided(args, profile),
        )

    # --- Tier 2: recommended for personalized plan matching ---
    if not args.get("current_coverage") and not any(
        m in profile_lower
        for m in [
            "uninsured",
            "no insurance",
            "lost coverage",
            "cobra",
            "no health",
            "without insurance",
            "between jobs",
        ]
    ):
        missing_recommended.append(
            (
                "current insurance status",
                "if you recently lost coverage, you may have a 60-day Special Enrollment window closing soon — this is urgent",
                "Do you currently have health insurance? If not, when did your coverage end and why (job loss, aged out, etc.)?",
            )
        )

    if (
        not args.get("medications")
        and "medication" not in profile_lower
        and "prescription" not in profile_lower
    ):
        missing_recommended.append(
            (
                "current medications",
                "the same drug can cost $10 on one plan and $200 on another — we check each plan's formulary to find the cheapest option",
                "Are you or your family members taking any prescription medications regularly? If so, which ones?",
            )
        )

    if not args.get("providers") and not any(
        m in profile_lower for m in ["doctor", "dr.", "provider", "pediatrician", "physician"]
    ):
        missing_recommended.append(
            (
                "current doctors",
                "we verify your doctors are in-network — choosing a plan where your doctor is out-of-network can cost you thousands",
                "Do you have doctors you want to keep seeing? If so, their names and practices?",
            )
        )

    if (
        not args.get("premium_budget")
        and "budget" not in profile_lower
        and "afford" not in profile_lower
    ):
        missing_recommended.append(
            (
                "monthly premium budget",
                "helps us eliminate plans you can't afford and find the best value within your range",
                "What's the most you can comfortably spend per month on health insurance premiums?",
            )
        )

    if missing_recommended:
        return _format_intake_response(
            stage="personalizing",
            message=(
                "Great — I have the basics. I can run a general analysis now, but "
                "a few more details will make the results much more accurate and "
                "help me find the actual best plan for your family (not just a generic recommendation)."
            ),
            questions=missing_recommended,
            provided=_summarize_provided(args, profile),
            can_proceed=True,
        )

    # All checks passed — ready to run the full workflow
    return None


def _contains_zip(text: str) -> bool:
    """Check if text contains something that looks like a US ZIP code."""
    import re

    return bool(re.search(r"\b\d{5}(?:-\d{4})?\b", text))


def _summarize_provided(args: dict[str, Any], profile: str) -> str:
    """Summarize what we already know from the user's input."""
    parts = []
    if profile:
        parts.append(f"Profile: {profile}")
    for key in [
        "state",
        "county",
        "zip_code",
        "income_type",
        "medications",
        "providers",
        "current_coverage",
        "premium_budget",
    ]:
        val = args.get(key)
        if val:
            parts.append(f"{key.replace('_', ' ').title()}: {val}")
    return "; ".join(parts) if parts else "No details provided yet."


def _format_intake_response(
    *,
    stage: str,
    message: str,
    questions: list[tuple[str, str, str]],
    provided: str,
    can_proceed: bool = False,
) -> str:
    """Format the intake guidance as a structured response."""
    lines = [
        f"## Intake Status: {stage}",
        "",
        message,
        "",
        f"**What I know so far:** {provided}",
        "",
        "**To personalize your analysis, please ask the user:**",
        "",
    ]
    for i, (field, why, prompt) in enumerate(questions, 1):
        lines.append(f"{i}. **{field}** — {why}")
        lines.append(f'   *Suggested question:* "{prompt}"')
        lines.append("")

    if can_proceed:
        lines.append(
            "**Note:** You can call this tool again with the additional details "
            "for a personalized analysis, or call it again with the same data to "
            'proceed with a general analysis. Add `skip_intake` = "true" to skip '
            "these questions and run immediately with available data."
        )

    return "\n".join(lines)



def _run_benefit_navigator(args: dict[str, Any], *, progress_token: str | None = None) -> str:
    """Run the full benefit-navigator workflow with optional progress streaming."""
    import json
    import shutil
    import subprocess
    import uuid
    from pathlib import Path

    try:
        kvr = shutil.which("kvr") or "/Users/sempi/.local/bin/kvr"
        run_id = f"mcp-navigator-{uuid.uuid4().hex[:8]}"

        cmd = [
            kvr,
            "run",
            "benefit-navigator",
            "--mode",
            "automated",
            "--no-progress",
            "--run-id",
            run_id,
        ]

        if progress_token:
            cmd.extend(["--phase-stream", "stdout"])

        var_keys = [
            "household_profile",
            "state",
            "county",
            "zip_code",
            "income_type",
            "medications",
            "providers",
            "health_needs",
            "usage_pattern",
            "current_coverage",
            "premium_budget",
            "network_preference",
            "pharmacy_preference",
            "existing_benefits",
            "assets",
            "expected_income_change",
        ]
        for key in var_keys:
            val = args.get(key)
            if val:
                cmd.extend(["--var", f"{key}={val}"])

        logger.info("Running: %s", " ".join(cmd))

        if progress_token:
            # Stream mode: read phase events in real time
            returncode = _run_with_progress(cmd, progress_token)
        else:
            # Simple mode: wait for completion
            result = subprocess.run(cmd, capture_output=True, text=True)
            returncode = result.returncode

        run_dir = Path.cwd() / ".workforce" / run_id

        if not run_dir.exists():
            return f"Workflow failed to produce output directory. Exit code {returncode}."

        # Phase outputs are stored as {phase-name}.md files in the run directory
        phase_outputs = {}
        phase_names = [
            "benefits-research",
            "insurance-research",
            "evidence-verification",
            "eligibility-validation",
            "action-plan",
        ]
        for phase_name in phase_names:
            phase_file = run_dir / f"{phase_name}.md"
            if phase_file.exists():
                phase_outputs[phase_name] = phase_file.read_text()

        if not phase_outputs:
            # Fallback: check phases subdirectory
            phases_dir = run_dir / "phases"
            if phases_dir.exists():
                for phase_dir in sorted(phases_dir.iterdir()):
                    output_file = phase_dir / "output.md"
                    if output_file.exists():
                        # Extract phase name from dir name like "01-benefits-research"
                        name = "-".join(phase_dir.name.split("-")[1:])
                        phase_outputs[name] = output_file.read_text()

        return _collect_output({"phase_outputs": phase_outputs})
    except Exception as e:
        logger.exception("benefit-navigator workflow failed")
        return f"Error running benefit navigator: {e}"


_PHASE_STREAM_PREFIX = "[PHASE_STREAM] "


def _run_with_progress(cmd: list[str], progress_token: str) -> int:
    """Run kvr with --phase-stream stdout, emitting MCP progress notifications.

    Reads stdout line by line. Lines prefixed with [PHASE_STREAM] are parsed
    as phase events and translated to MCP notifications/progress messages.
    """
    import subprocess

    completed_phases = 0
    total_phases = 0

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        for line in proc.stdout:
            line = line.rstrip("\n")
            if not line.startswith(_PHASE_STREAM_PREFIX):
                continue

            try:
                event = json.loads(line[len(_PHASE_STREAM_PREFIX):])
            except json.JSONDecodeError:
                continue

            event_type = event.get("event_type", "")
            phase = event.get("phase", "")
            metadata = event.get("metadata", {})

            if event_type == "workflow_start":
                total_phases = event.get("total_phases", 0)
                _send_progress(progress_token, 0, total_phases, "Starting workflow...")

            elif event_type == "phase_start":
                idx = metadata.get("phase_index", 0)
                total = metadata.get("total_phases", total_phases)
                phase_label = phase.replace("-", " ").title()
                _send_progress(progress_token, completed_phases, total, f"Running: {phase_label}")

            elif event_type == "phase_complete":
                completed_phases += 1
                phase_label = phase.replace("-", " ").title()
                _send_progress(progress_token, completed_phases, total_phases, f"Completed: {phase_label}")

    finally:
        proc.wait()

    return proc.returncode


def _send_progress(token: str, progress: int, total: int, message: str) -> None:
    """Write an MCP notifications/progress message to stdout."""
    notification = {
        "jsonrpc": "2.0",
        "method": "notifications/progress",
        "params": {
            "progressToken": token,
            "progress": progress,
            "total": total,
            "message": message,
        },
    }
    sys.stdout.write(json.dumps(notification, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _run_eligibility_check(args: dict[str, Any]) -> str:
    """Run eligibility check, enriched with real CMS data when available."""
    import os
    import shutil
    import subprocess

    enrichment = ""

    # Try to enrich with real CMS Marketplace data
    if os.environ.get("CMS_API_KEY") and args.get("household_profile"):
        try:
            from benefit_navigator.marketplace_api import (
                estimate_eligibility,
                get_state_medicaid,
                resolve_county,
            )

            zip_code = args.get("zip_code", "")
            if not zip_code:
                # Try to extract from profile
                import re

                m = re.search(r"\b(\d{5})\b", args.get("household_profile", ""))
                if m:
                    zip_code = m.group(1)

            if zip_code:
                county_data = resolve_county(zip_code)
                counties = county_data.get("counties", [])
                if counties:
                    county = counties[0]
                    fips = county["fips"]
                    state = county["state"]

                    people = _parse_household_for_api(args)
                    income = _parse_income(args)

                    elig = estimate_eligibility(income, people, state, fips, zip_code)
                    estimates = elig.get("estimates", [{}])
                    if estimates:
                        est = estimates[0]
                        lines = ["## CMS Marketplace Data (Live)\n"]
                        lines.append(f"- **APTC (tax credit):** ${est.get('aptc', 0):.2f}/month")
                        csr = est.get("csr", "none")
                        if csr and csr != "none":
                            lines.append(f"- **Cost-sharing reduction:** {csr}")
                        if est.get("is_medicaid_chip"):
                            lines.append("- **Medicaid/CHIP:** Household likely qualifies")
                        fpl_pct = est.get("fpl", 0)
                        if fpl_pct:
                            lines.append(f"- **Federal Poverty Level:** {fpl_pct:.1f}%")
                        lines.append("")

                        # Get state Medicaid thresholds
                        try:
                            medicaid = get_state_medicaid(state)
                            if medicaid:
                                lines.append(f"### {state} Medicaid Thresholds")
                                for group in medicaid.get("poverty_levels", []):
                                    lines.append(
                                        f"- {group.get('group', 'Unknown')}: {group.get('percentage', 'N/A')}% FPL"
                                    )
                                lines.append("")
                        except Exception:
                            pass

                        enrichment = "\n".join(lines) + "\n---\n\n"
        except Exception:
            logger.debug("CMS enrichment failed for eligibility check", exc_info=True)

    # Always run kvr assist for the detailed analysis
    try:
        kvr = shutil.which("kvr") or "/Users/sempi/.local/bin/kvr"
        task = (
            f"Check eligibility for {args.get('program', 'unknown program')} "
            f"for this household: {args.get('household_profile', '')}. "
            f"Use the benefit-navigator context for FPL tables and program reference."
        )
        result = subprocess.run(
            [kvr, "assist", "--spawn", task],
            capture_output=True,
            text=True,
            timeout=120,
        )
        assist_output = result.stdout.strip() or result.stderr.strip() or f"Exit code: {result.returncode}"
        return enrichment + assist_output
    except Exception as e:
        logger.exception("eligibility check failed")
        return enrichment + f"Error checking eligibility: {e}"


def _run_insurance_comparison(args: dict[str, Any]) -> str:
    """Run insurance comparison using Healthcare.gov Marketplace API for real plan data.

    Falls back to kvr assist if the API is unavailable or CMS_API_KEY is not set.
    """
    import os

    zip_code = args.get("zip_code", "")
    if not zip_code:
        return "ZIP code is required for insurance plan comparison."

    # If no API key, fall back to kvr assist
    if not os.environ.get("CMS_API_KEY"):
        return _run_insurance_comparison_fallback(args)

    try:
        from benefit_navigator.marketplace_api import (
            MissingAPIKeyError as _MissingAPIKeyError,
            estimate_eligibility,
            format_plans_summary,
            resolve_county,
            search_plans,
        )

        # Step 1: Resolve ZIP to county
        county_data = resolve_county(zip_code)
        counties = county_data.get("counties", [])
        if not counties:
            return f"No marketplace data found for ZIP code {zip_code}."
        county = counties[0]
        fips = county["fips"]
        state = county["state"]

        # Step 2: Parse household into API format
        people = _parse_household_for_api(args)
        income = _parse_income(args)

        # Step 3: Get eligibility estimates (APTC, CSR)
        eligibility = None
        try:
            eligibility = estimate_eligibility(income, people, state, fips, zip_code)
        except Exception:
            logger.warning("Eligibility estimate failed — continuing without APTC", exc_info=True)

        # Step 4: Search real plans
        result = search_plans(income, people, fips, state, zip_code)

        return format_plans_summary(result, eligibility)

    except _MissingAPIKeyError:
        return _run_insurance_comparison_fallback(args)
    except Exception as e:
        logger.exception("Marketplace API call failed — falling back to kvr assist")
        fallback = _run_insurance_comparison_fallback(args)
        return f"*Note: Live marketplace data unavailable ({e}). Showing AI-generated estimates:*\n\n{fallback}"


def _run_insurance_comparison_fallback(args: dict[str, Any]) -> str:
    """Fallback: run insurance comparison via kvr assist."""
    import shutil
    import subprocess

    try:
        kvr = shutil.which("kvr") or "/Users/sempi/.local/bin/kvr"
        task = (
            f"Compare all insurance options (ACA marketplace, off-marketplace, "
            f"short-term, health sharing, ICHRA/QSEHRA) for zip code "
            f"{args.get('zip_code', 'unknown')}. "
            f"Household: {args.get('household_profile', '')}. "
            f"Special needs: {args.get('special_needs', 'none specified')}. "
            f"Use the benefit-navigator context for insurance channel reference."
        )
        result = subprocess.run(
            [kvr, "assist", "--spawn", task],
            capture_output=True,
            text=True,
            timeout=120,
        )
        return result.stdout.strip() or result.stderr.strip() or f"Exit code: {result.returncode}"
    except Exception as e:
        logger.exception("insurance comparison fallback failed")
        return f"Error comparing insurance plans: {e}"


def _parse_household_for_api(args: dict[str, Any]) -> list[dict[str, Any]]:
    """Parse household_profile text into CMS API people list."""
    import re

    profile = args.get("household_profile", "")
    people: list[dict[str, Any]] = []

    # Extract ages from profile text
    age_patterns = [
        r"ages?\s+(\d+)\s+and\s+(\d+)",  # "ages 4 and 9"
        r"(\d+)\s+and\s+(\d+)\s+year",  # "4 and 9 year old"
        r"age\s+(\d+)",  # "age 35"
        r"(\d+)\s*(?:yo|y/o|year.?old)",  # "35yo", "35 year old"
    ]

    child_ages = []
    adult_age = 30  # default

    for pattern in age_patterns:
        matches = re.findall(pattern, profile, re.IGNORECASE)
        for match in matches:
            if isinstance(match, tuple):
                for age_str in match:
                    age = int(age_str)
                    if age < 19:
                        child_ages.append(age)
                    else:
                        adult_age = age
            else:
                age = int(match)
                if age < 19:
                    child_ages.append(age)
                else:
                    adult_age = age

    # Primary applicant
    people.append({"age": adult_age, "gender": "Female", "uses_tobacco": False})

    # Children
    for age in child_ages:
        people.append({"age": age, "gender": "Female", "uses_tobacco": False})

    # If "family of N" or "household of N" mentioned, pad to that size
    size_match = re.search(r"(?:family|household)\s+of\s+(\d+)", profile, re.IGNORECASE)
    if size_match:
        target = int(size_match.group(1))
        while len(people) < target:
            people.append({"age": 30, "gender": "Female", "uses_tobacco": False})

    # If we only have 1 person but "kids" or "children" are mentioned, add defaults
    kid_match = re.search(r"(\d+)\s*kid|(\d+)\s*child", profile, re.IGNORECASE)
    if kid_match and not child_ages:
        n_kids = int(kid_match.group(1) or kid_match.group(2))
        for _ in range(n_kids):
            people.append({"age": 8, "gender": "Female", "uses_tobacco": False})

    return people


def _parse_income(args: dict[str, Any]) -> int:
    """Parse income from args, with fallback extraction from household_profile."""
    import re

    profile = args.get("household_profile", "")

    # Try explicit patterns
    patterns = [
        r"\$\s*([\d,]+)\s*k?\s*/?\s*(?:yr|year|annual)",  # $42k/yr, $42,000/year
        r"\$\s*([\d,]+)\s*k\b",  # $42k
        r"\$\s*([\d,]+)\b",  # $42000
        r"([\d,]+)\s*(?:income|salary|earn)",  # 42000 income
    ]
    for pattern in patterns:
        match = re.search(pattern, profile, re.IGNORECASE)
        if match:
            raw = match.group(1).replace(",", "")
            income = int(raw)
            # If it looks like shorthand (42 = $42k), multiply
            if income < 1000:
                income *= 1000
            return income

    return 30000  # conservative default for benefit eligibility


def _run_generate_application_draft(args: dict[str, Any]) -> str:
    """Generate a pre-filled PDF application draft from workflow output."""
    try:
        from benefit_navigator.pdf_generator import generate_application_pdf

        workflow_output = args.get("workflow_output", "")
        if not workflow_output:
            return (
                "Missing workflow_output. Run navigate_benefits first, then pass "
                "its full output as the workflow_output parameter."
            )

        path = generate_application_pdf(args, workflow_output)
        return (
            f"Application draft PDF generated successfully.\n\n"
            f"**File:** `{path}`\n\n"
            f"**Next steps for the applicant:**\n"
            f"1. Open the PDF and review all pre-filled information\n"
            f"2. Fill in blank fields (name, date of birth, SSN, signature)\n"
            f"3. Gather the documents listed in the checklist\n"
            f"4. Submit applications through the program-specific portals listed "
            f"in the Application Directory section of your benefits analysis\n\n"
            f"*This is a DRAFT — verify all information before submitting.*"
        )
    except Exception as e:
        logger.exception("PDF generation failed")
        return f"Error generating application draft: {e}"


def _collect_output(result: dict) -> str:
    """Collect workflow phase outputs into a single markdown string."""
    phase_outputs = result.get("phase_outputs", {})
    if not phase_outputs:
        return result.get("final_output", result.get("output", "No output produced."))

    sections = []
    for phase_name, output in phase_outputs.items():
        sections.append(f"## {phase_name.replace('-', ' ').title()}\n\n{output}")

    # Append consolidated sources & references section
    sources_section = _build_sources_section(phase_outputs)
    if sources_section:
        sections.append(sources_section)

    return "\n\n---\n\n".join(sections)


def _build_sources_section(phase_outputs: dict[str, str]) -> str:
    """Extract all cited URLs and verification statuses into a consolidated section."""
    import re
    from collections import OrderedDict

    all_text = "\n".join(phase_outputs.values())

    # Extract URLs with surrounding context for labeling
    url_entries: OrderedDict[str, str] = OrderedDict()
    for line in all_text.split("\n"):
        urls = re.findall(r"https?://[^\s\)\]>\"]+", line)
        for url in urls:
            url = url.rstrip(".,;:")
            if url not in url_entries:
                # Classify source type
                if ".gov" in url:
                    source_type = ".gov (official)"
                elif any(d in url for d in [".org", ".edu"]):
                    source_type = "nonprofit/edu"
                else:
                    source_type = "other"
                url_entries[url] = source_type

    # Extract verification summary from evidence-verification phase
    verify_text = phase_outputs.get("evidence-verification", "")
    verify_summary = ""
    for line in verify_text.split("\n"):
        if "checks performed" in line.lower() or "total checks" in line.lower():
            # Clean markdown formatting and leading labels
            verify_summary = re.sub(
                r"^[#*\s]*(?:SUMMARY:\s*)?", "", line,
            ).strip()
            break

    if not url_entries and not verify_summary:
        return ""

    parts = ["## Sources & References"]
    parts.append("")
    parts.append(
        "All claims in this analysis can be independently verified using the "
        "sources below. The Evidence Verification phase audited every data point "
        "against official reference tables."
    )

    if verify_summary:
        parts.append("")
        parts.append(f"**Verification summary:** {verify_summary}")

    if url_entries:
        parts.append("")
        parts.append("### Cited Sources")
        parts.append("")
        parts.append("| Source | Type |")
        parts.append("|--------|------|")

        # Deduplicate by domain, keep most specific URL per domain
        seen_domains: dict[str, list[tuple[str, str]]] = {}
        for url, stype in url_entries.items():
            domain = re.sub(r"https?://(?:www\.)?", "", url).split("/")[0]
            seen_domains.setdefault(domain, []).append((url, stype))

        for domain, entries in seen_domains.items():
            # Show the most specific (longest) URL per domain
            best_url, best_type = max(entries, key=lambda e: len(e[0]))
            parts.append(f"| [{domain}]({best_url}) | {best_type} |")

    parts.append("")
    parts.append(
        "*Every program recommendation cites its source. Claims marked "
        "UNVERIFIED or ESTIMATED should be confirmed with the issuing agency "
        "before acting.*"
    )

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# MCP JSON-RPC handler
# ---------------------------------------------------------------------------


def _handle_request(request: dict) -> dict | None:  # noqa: PLR0911
    """Handle a single MCP JSON-RPC request.

    Returns a JSON-RPC response dict, or None for notifications.
    """
    req_id = request.get("id")
    method = request.get("method", "")
    params = request.get("params", {})

    if method == "initialize":
        return _jsonrpc_result(
            req_id,
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {
                    "name": "benefit-navigator",
                    "version": "1.0.0",
                },
            },
        )

    if method == "notifications/initialized":
        # Client acknowledgment — no response needed.
        return None

    if method == "tools/list":
        return _jsonrpc_result(req_id, {"tools": _TOOLS})

    if method == "tools/call":
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})
        progress_token = params.get("_meta", {}).get("progressToken")
        output = _execute_tool(tool_name, arguments, progress_token=progress_token)
        return _jsonrpc_result(
            req_id,
            {
                "content": [{"type": "text", "text": output}],
            },
        )

    if method == "ping":
        return _jsonrpc_result(req_id, {})

    # Unknown method — return error only if it has an id (not a notification).
    if req_id is not None:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Unknown method: {method}"},
        }
    return None


def _jsonrpc_result(req_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


# ---------------------------------------------------------------------------
# Stdio transport
# ---------------------------------------------------------------------------


def main() -> None:
    """Run the MCP server on stdin/stdout.

    Reads newline-delimited JSON-RPC messages from stdin and writes
    responses to stdout.  Logs go to stderr so they don't pollute the
    protocol stream.
    """
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stderr,
        format="%(levelname)s %(name)s: %(message)s",
    )
    logger.info("Benefit Navigator MCP server starting (stdio transport)")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            logger.warning("Malformed JSON: %s", line[:100])
            continue

        response = _handle_request(request)
        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()

    logger.info("Benefit Navigator MCP server shutting down")


if __name__ == "__main__":
    main()
