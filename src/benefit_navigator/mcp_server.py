"""Minimal MCP (Model Context Protocol) server exposing the Benefit Navigator as tools.

Uses only the Python standard library (stdin/stdout JSON-RPC 2.0) so it
adds **zero** new dependencies.

Example ``mcp_config.json`` entry::

    {
      "mcpServers": {
        "benefits-navigator": {
          "command": "/bin/zsh",
          "args": ["-c", "set -a && [ -f ~/.env ] && source ~/.env; [ -f .env ] && source .env && set +a && exec .venv/bin/python -m benefit_navigator"],
          "cwd": "/path/to/kealu-benefits-navigator"
        }
      }
    }

MCP protocol reference: https://modelcontextprotocol.io/specification
"""

from __future__ import annotations

import concurrent.futures
import datetime
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Precompiled regex patterns
_ZIP_RE = re.compile(r"\b\d{5}(?:-\d{4})?\b")
_ZIP_EXACT_RE = re.compile(r"\b(\d{5})\b")
_AGE_PATTERNS = [
    re.compile(r"ages?\s+(\d+)\s+and\s+(\d+)", re.IGNORECASE),
    re.compile(r"(\d+)\s+and\s+(\d+)\s+year", re.IGNORECASE),
    re.compile(r"age\s+(\d+)", re.IGNORECASE),
    re.compile(r"(\d+)\s*(?:yo|y/o|year.?old)", re.IGNORECASE),
]
_FAMILY_SIZE_RE = re.compile(r"(?:family|household)\s+of\s+(\d+)", re.IGNORECASE)
_KID_COUNT_RE = re.compile(r"(\d+)\s*kid|(\d+)\s*child", re.IGNORECASE)
_INCOME_PATTERNS = [
    re.compile(r"\$\s*([\d,]+)\s*k?\s*/?\s*(?:yr|year|annual)", re.IGNORECASE),
    re.compile(r"\$\s*([\d,]+)\s*k\b", re.IGNORECASE),
    re.compile(r"\$\s*([\d,]+)\b", re.IGNORECASE),
    re.compile(r"([\d,]+)\s*(?:income|salary|earn)", re.IGNORECASE),
]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_HOUSEHOLD_SIZE = 20
DEFAULT_ADULT_AGE = 30
DEFAULT_CHILD_AGE = 8
DEFAULT_INCOME = 30_000
KVR_TIMEOUT = int(os.environ.get("KVR_TIMEOUT", "120"))

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
                "annual_income": {
                    "type": "string",
                    "description": (
                        "Annual household income before taxes "
                        "(e.g. '$42,000', '42000', '$42k')"
                    ),
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
                    "type": "boolean",
                    "description": (
                        "Set to true to skip intake questions and run the analysis "
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
                "zip_code": {
                    "type": "string",
                    "description": "5-digit ZIP code for county/state resolution and Medicaid lookup",
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
            "Generate a pre-filled PDF application for benefit programs. "
            "For states with official fillable forms (e.g. California SAWS-1), "
            "fills the actual government form. For other states, generates an "
            "Application Preparation Worksheet. Call AFTER navigate_benefits. "
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
                    "description": "US state (e.g. 'California', 'TX')",
                },
                "zip_code": {
                    "type": "string",
                    "description": "5-digit ZIP code",
                },
                "county": {
                    "type": "string",
                    "description": "County name (e.g. 'Los Angeles County')",
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
# Audit logging
# ---------------------------------------------------------------------------


def _audit_log(
    action: str,
    resource: str,
    outcome: str,
    *,
    correlation_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Emit a structured audit event for data access and tool invocations."""
    event = {
        "audit": True,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "action": action,
        "resource": resource,
        "outcome": outcome,
        "correlation_id": correlation_id or "none",
    }
    if details:
        event["details"] = details
    logger.info("AUDIT %s", json.dumps(event, default=str))


# ---------------------------------------------------------------------------
# kvr resolution
# ---------------------------------------------------------------------------


def _resolve_kvr() -> str:
    """Resolve the kvr binary path, raising RuntimeError if not found."""
    path = shutil.which("kvr")
    if not path:
        raise RuntimeError(
            "kvr not found on PATH. Install Kealu Vector CLI (https://kealu.com) "
            "and ensure 'kvr' is available in your shell PATH."
        )
    return path


# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------

_TOOL_DISPATCH: dict[str, Any] = {}  # populated after function definitions


def _execute_tool(name: str, arguments: dict[str, Any], *, progress_token: str | None = None) -> str:
    """Execute a tool by name via dispatch table.

    Returns the workflow output as a string.
    """
    corr_id = uuid.uuid4().hex[:12]
    _audit_log("tool_call", name, "started", correlation_id=corr_id, details={"has_zip": bool(arguments.get("zip_code"))})
    handler = _TOOL_DISPATCH.get(name)
    if handler is None:
        _audit_log("tool_call", name, "error", correlation_id=corr_id, details={"reason": "unknown_tool"})
        return f"Unknown tool: {name}"
    try:
        result = handler(arguments, progress_token=progress_token)
        _audit_log("tool_call", name, "completed", correlation_id=corr_id)
        return result
    except Exception as e:
        _audit_log("tool_call", name, "error", correlation_id=corr_id, details={"error": str(e)})
        raise


def _handle_navigate_benefits(arguments: dict[str, Any], *, progress_token: str | None = None) -> str:
    if not arguments.get("skip_intake"):
        missing = _check_intake_completeness(arguments)
        if missing:
            return missing
    return _run_benefit_navigator(arguments, progress_token=progress_token)


def _handle_check_eligibility(arguments: dict[str, Any], *, progress_token: str | None = None) -> str:
    return _run_eligibility_check(arguments)


def _handle_compare_insurance(arguments: dict[str, Any], *, progress_token: str | None = None) -> str:
    return _run_insurance_comparison(arguments)


def _handle_generate_application_draft(arguments: dict[str, Any], *, progress_token: str | None = None) -> str:
    return _run_generate_application_draft(arguments)


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
    has_income = bool(args.get("annual_income")) or any(
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
    return bool(_ZIP_RE.search(text))


def _summarize_provided(args: dict[str, Any], profile: str) -> str:
    """Summarize what we already know from the user's input."""
    parts = []
    if profile:
        parts.append(f"Profile: {profile}")
    for key in [
        "annual_income",
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
            "proceed with a general analysis. Set `skip_intake` to `true` (boolean) "
            "to skip these questions and run immediately with available data."
        )

    return "\n".join(lines)



def _run_benefit_navigator(args: dict[str, Any], *, progress_token: str | None = None) -> str:
    """Run the full benefits-navigator workflow with optional progress streaming."""
    try:
        kvr = _resolve_kvr()
        run_id = f"mcp-navigator-{uuid.uuid4().hex[:8]}"

        cmd = [
            kvr,
            "run",
            "benefits-navigator",
            "--mode",
            "automated",
            "--no-progress",
            "--run-id",
            run_id,
        ]

        # Pass through KVR_TOOL env var as --tool flag for AI provider selection
        kvr_tool = os.environ.get("KVR_TOOL")
        if kvr_tool:
            cmd.extend(["--tool", kvr_tool])

        if progress_token:
            cmd.extend(["--phase-stream", "stdout"])

        var_keys = [
            "annual_income",
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

        logger.info("Running benefits-navigator run_id=%s", run_id)

        if progress_token:
            # Stream mode: read phase events in real time
            returncode = _run_with_progress(cmd, progress_token)
        else:
            # Simple mode: wait for completion
            result = subprocess.run(
                cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                text=True, timeout=KVR_TIMEOUT,
            )
            if result.returncode != 0:
                logger.warning("kvr exited with code %d: %s", result.returncode, result.stderr[:500])
            returncode = result.returncode

        log_dir = Path.cwd() / ".workforce" / run_id

        if not log_dir.exists():
            return (
                f"Workflow failed to produce output directory (exit code {returncode}). "
                f"Check that kvr is installed (>= 0.114.13) and the "
                f"benefits-navigator workflow exists."
            )

        phase_outputs: dict[str, str] = {}

        # Determine phase ordering from decision.jsonl phase_complete events
        phase_order: list[str] = []
        log_path = log_dir / "decision.jsonl"
        if log_path.exists():
            with open(log_path) as f:
                for line in f:
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    if data.get("decision_type") == "phase_complete" and data.get("phase"):
                        phase_order.append(data["phase"])
                    # Legacy format fallback
                    elif data.get("type") == "PHASE_RESULT" and data.get("phase_name"):
                        phase_outputs[data["phase_name"]] = data.get("metadata", {}).get("output", "")

        # Primary: read {phase-name}.md files written by kvr
        md_outputs: dict[str, str] = {}
        for md_file in log_dir.glob("*.md"):
            phase_name = md_file.stem  # e.g. "benefits-research"
            if phase_name == "summary":
                continue  # skip kvr's own summary file
            content = md_file.read_text(encoding="utf-8").strip()
            if content:
                md_outputs[phase_name] = content

        if md_outputs:
            # Use phase_order from decision.jsonl if available, otherwise alphabetical
            if phase_order:
                for name in phase_order:
                    if name in md_outputs:
                        phase_outputs[name] = md_outputs.pop(name)
            # Append any remaining .md files not in the decision log
            for name, content in md_outputs.items():
                phase_outputs[name] = content

        # Clean up run directory to avoid PII accumulation
        try:
            shutil.rmtree(log_dir)
        except OSError:
            logger.debug("Could not clean up run directory at %s", log_dir)

        return _collect_output({"phase_outputs": phase_outputs})
    except Exception as e:
        logger.exception("benefits-navigator workflow failed")
        return f"Error running benefit navigator: {e}"


_PHASE_STREAM_PREFIX = "[PHASE_STREAM] "


def _run_with_progress(cmd: list[str], progress_token: str) -> int:
    """Run kvr with --phase-stream stdout, emitting MCP progress notifications.

    Reads stdout line by line. Lines prefixed with [PHASE_STREAM] are parsed
    as phase events and translated to MCP notifications/progress messages.
    Stderr is drained in a background thread to prevent pipe buffer deadlock.
    """
    completed_phases = 0
    total_phases = 0

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    # Drain stderr in background to prevent deadlock when kvr emits >64KB
    stderr_output: list[str] = []
    stderr_thread = threading.Thread(
        target=lambda: stderr_output.append(proc.stderr.read()),
        daemon=True,
    )
    stderr_thread.start()

    try:
        for line in proc.stdout:
            if _shutdown_requested:
                proc.terminate()
                break

            line = line.rstrip("\n")
            if not line.startswith(_PHASE_STREAM_PREFIX):
                continue

            try:
                event = json.loads(line[len(_PHASE_STREAM_PREFIX):])
            except json.JSONDecodeError:
                logger.warning("Malformed phase-stream JSON: %s", line[:200])
                continue

            event_type = event.get("event_type", "")
            phase = event.get("phase", "")
            metadata = event.get("metadata", {})

            if event_type == "workflow_start":
                total_phases = event.get("total_phases", 0)
                _send_progress(progress_token, 0, total_phases, "Starting workflow...")

            elif event_type == "phase_start":
                total = metadata.get("total_phases", total_phases)
                phase_label = phase.replace("-", " ").title()
                _send_progress(progress_token, completed_phases, total, f"Running: {phase_label}")

            elif event_type == "phase_complete":
                completed_phases += 1
                phase_label = phase.replace("-", " ").title()
                _send_progress(progress_token, completed_phases, total_phases, f"Completed: {phase_label}")

    finally:
        proc.wait()
        stderr_thread.join(timeout=5)
        if stderr_output and stderr_output[0]:
            logger.debug("kvr stderr: %s", stderr_output[0][:1000])

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
                m = _ZIP_EXACT_RE.search(args.get("household_profile", ""))
                if m:
                    zip_code = m.group(1)

            if zip_code and re.fullmatch(r"\d{5}", zip_code):
                county_data = resolve_county(zip_code)
                counties = county_data.get("counties", [])
                if counties:
                    county = counties[0]
                    fips = county["fips"]
                    state = county["state"]

                    people = _parse_household_for_api(args)
                    income = _parse_income(args)

                    # Parallelize eligibility and Medicaid lookup
                    elig = None
                    medicaid = None
                    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                        elig_future = executor.submit(estimate_eligibility, income, people, state, fips, zip_code)
                        medicaid_future = executor.submit(get_state_medicaid, state)
                        try:
                            elig = elig_future.result()
                        except Exception:
                            logger.debug("Eligibility estimate failed", exc_info=True)
                        try:
                            medicaid = medicaid_future.result()
                        except Exception:
                            logger.debug("Medicaid enrichment failed for state %s", state, exc_info=True)

                    estimates = (elig or {}).get("estimates", [{}])
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

                        if medicaid:
                            lines.append(f"### {state} Medicaid Thresholds")
                            for group in medicaid.get("poverty_levels", []):
                                lines.append(
                                    f"- {group.get('group', 'Unknown')}: {group.get('percentage', 'N/A')}% FPL"
                                )
                            lines.append("")

                        enrichment = "\n".join(lines) + "\n---\n\n"
        except Exception:
            logger.debug("CMS enrichment failed for eligibility check", exc_info=True)

    # Always run kvr assist for the detailed analysis
    task_file = None
    try:
        kvr = _resolve_kvr()
        program = args.get("program", "unknown program")
        # Write task details to temp file to avoid PII in OS process table
        task = (
            f"Check eligibility for {program} "
            f"for this household: {args.get('household_profile', '')}. "
            f"Use the benefits-navigator context for FPL tables and program reference."
        )
        task_file = tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", prefix="kvr-task-", delete=False,
        )
        task_file.write(task)
        task_file.close()
        result = subprocess.run(
            [kvr, "assist", "--spawn", f"Execute the task in {task_file.name}"],
            capture_output=True,
            text=True,
            timeout=KVR_TIMEOUT,
        )
        assist_output = result.stdout.strip() or result.stderr.strip() or f"Exit code: {result.returncode}"
        return enrichment + assist_output
    except Exception as e:
        logger.exception("eligibility check failed")
        return enrichment + f"Error checking eligibility: {e}"
    finally:
        if task_file and os.path.exists(task_file.name):
            os.unlink(task_file.name)


def _run_insurance_comparison(args: dict[str, Any]) -> str:
    """Run insurance comparison using Healthcare.gov Marketplace API for real plan data.

    Falls back to kvr assist if the API is unavailable or CMS_API_KEY is not set.
    """
    zip_code = args.get("zip_code", "")
    if not zip_code:
        return "ZIP code is required for insurance plan comparison."

    if not re.fullmatch(r"\d{5}", zip_code):
        return f"Invalid ZIP code format: {zip_code!r} (expected 5 digits, e.g. '77001')."

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

        # Step 3 & 4: Get eligibility and search plans in parallel
        eligibility = None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            elig_future = executor.submit(estimate_eligibility, income, people, state, fips, zip_code)
            plans_future = executor.submit(search_plans, income, people, fips, state, zip_code)

            try:
                eligibility = elig_future.result()
            except Exception:
                logger.warning("Eligibility estimate failed — continuing without APTC", exc_info=True)

            result = plans_future.result()

        return format_plans_summary(result, eligibility)

    except _MissingAPIKeyError:
        return _run_insurance_comparison_fallback(args)
    except Exception as e:
        logger.exception("Marketplace API call failed — falling back to kvr assist")
        fallback = _run_insurance_comparison_fallback(args)
        return f"*Note: Live marketplace data unavailable ({e}). Showing AI-generated estimates:*\n\n{fallback}"


def _run_insurance_comparison_fallback(args: dict[str, Any]) -> str:
    """Fallback: run insurance comparison via kvr assist."""
    task_file = None
    try:
        kvr = _resolve_kvr()
        zip_code = args.get("zip_code", "unknown")
        # Write task details to temp file to avoid PII in OS process table
        task = (
            f"Compare all insurance options (ACA marketplace, off-marketplace, "
            f"short-term, health sharing, ICHRA/QSEHRA) for zip code "
            f"{zip_code}. "
            f"Household: {args.get('household_profile', '')}. "
            f"Use the benefits-navigator context for insurance channel reference."
        )
        task_file = tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", prefix="kvr-task-", delete=False,
        )
        task_file.write(task)
        task_file.close()
        result = subprocess.run(
            [kvr, "assist", "--spawn", f"Execute the task in {task_file.name}"],
            capture_output=True,
            text=True,
            timeout=KVR_TIMEOUT,
        )
        return result.stdout.strip() or result.stderr.strip() or f"Exit code: {result.returncode}"
    except Exception as e:
        logger.exception("insurance comparison fallback failed")
        return f"Error comparing insurance plans: {e}"
    finally:
        if task_file and os.path.exists(task_file.name):
            os.unlink(task_file.name)


def _parse_household_for_api(args: dict[str, Any]) -> list[dict[str, Any]]:
    """Parse household_profile text into CMS API people list."""
    profile = args.get("household_profile", "")
    profile_lower = profile.lower()
    people: list[dict[str, Any]] = []

    # Detect gender hints from profile text
    male_markers = ["husband", "father", "dad", "male", "man ", "boy", "son "]
    female_markers = ["wife", "mother", "mom", "female", "woman", "girl", "daughter"]
    has_male_hint = any(marker in profile_lower for marker in male_markers)
    has_female_hint = any(marker in profile_lower for marker in female_markers)

    # Determine primary applicant gender from context
    primary_gender = "Female"  # CMS API default
    if has_male_hint and not has_female_hint:
        primary_gender = "Male"

    # Determine child gender — if both genders mentioned, alternate; else use CMS default
    child_gender = "Female"  # CMS API default
    if any(m in profile_lower for m in ["boy", "son "]) and not any(m in profile_lower for m in ["girl", "daughter"]):
        child_gender = "Male"

    child_ages = []
    adult_age = DEFAULT_ADULT_AGE

    for pattern in _AGE_PATTERNS:
        matches = pattern.findall(profile)
        for match in matches:
            if isinstance(match, tuple):
                for age_str in match:
                    try:
                        age = int(age_str)
                    except ValueError:
                        continue
                    if age < 19:
                        child_ages.append(age)
                    else:
                        adult_age = age
            else:
                try:
                    age = int(match)
                except ValueError:
                    continue
                if age < 19:
                    child_ages.append(age)
                else:
                    adult_age = age

    # Primary applicant
    people.append({"age": adult_age, "gender": primary_gender, "uses_tobacco": False})

    # Children
    for age in child_ages:
        people.append({"age": age, "gender": child_gender, "uses_tobacco": False})

    # If "family of N" or "household of N" mentioned, pad to that size
    size_match = _FAMILY_SIZE_RE.search(profile)
    if size_match:
        try:
            target = int(size_match.group(1))
        except ValueError:
            target = len(people)
        target = min(target, MAX_HOUSEHOLD_SIZE)
        while len(people) < target:
            people.append({"age": DEFAULT_ADULT_AGE, "gender": "Female", "uses_tobacco": False})

    # If we only have 1 person but "kids" or "children" are mentioned, add defaults
    kid_match = _KID_COUNT_RE.search(profile)
    if kid_match and not child_ages:
        try:
            n_kids = int(kid_match.group(1) or kid_match.group(2))
        except ValueError:
            n_kids = 0
        n_kids = min(n_kids, MAX_HOUSEHOLD_SIZE - len(people))
        for _ in range(n_kids):
            people.append({"age": DEFAULT_CHILD_AGE, "gender": "Female", "uses_tobacco": False})

    # Cap total household size
    people = people[:MAX_HOUSEHOLD_SIZE]

    return people


def _parse_income(args: dict[str, Any]) -> int:
    """Parse income from args, with fallback extraction from household_profile.

    Returns parsed income or DEFAULT_INCOME if no income pattern matched.
    Logs a warning when using the default since it may produce incorrect
    CMS API results near ACA subsidy cutoffs.
    """
    # Check explicit annual_income field first — bare numbers are valid here
    explicit = args.get("annual_income", "")
    if explicit:
        raw = re.sub(r"[^\d]", "", explicit)
        if raw:
            try:
                income = int(raw)
            except ValueError:
                pass
            else:
                if income < 1000:
                    income *= 1000
                return income

    # Fall back to pattern matching in household_profile text
    profile = args.get("household_profile", "")
    if profile:
        for pattern in _INCOME_PATTERNS:
            match = pattern.search(profile)
            if match:
                raw = match.group(1).replace(",", "")
                try:
                    income = int(raw)
                except ValueError:
                    continue
                if income < 1000:
                    income *= 1000
                return income

    logger.warning("No income found in profile, using default %d — results may be inaccurate", DEFAULT_INCOME)
    return DEFAULT_INCOME


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
    from collections import OrderedDict

    all_text = "\n".join(phase_outputs.values())

    # Extract URLs with surrounding context for labeling
    url_entries: OrderedDict[str, str] = OrderedDict()
    for line in all_text.split("\n"):
        urls = re.findall(r"https?://[^\s\)\]>\"]+", line)
        for url in urls:
            url = url.rstrip(".,;:")
            if url not in url_entries:
                if ".gov" in url:
                    source_type = ".gov (official)"
                elif any(d in url for d in [".org", ".edu"]):
                    source_type = "nonprofit/edu"
                else:
                    source_type = "other"
                url_entries[url] = source_type

    # Extract verification summary from evidence-verification phase
    verify_text = phase_outputs.get("evidence-verify", phase_outputs.get("evidence-verification", ""))
    verify_summary = ""
    for line in verify_text.split("\n"):
        if "checks performed" in line.lower() or "total checks" in line.lower():
            verify_summary = re.sub(
                r"^[#*\s]*(?:SUMMARY:\s*)?", "", line,
            ).strip()
            break

    if not url_entries and not verify_summary:
        return ""

    parts = ["## Sources & References"]
    parts.append("")
    if verify_summary:
        parts.append(
            "All claims in this analysis can be independently verified using the "
            "sources below. The Evidence Verification phase audited every data point "
            "against official reference tables."
        )
    else:
        parts.append(
            "The following sources were cited in this analysis."
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

        seen_domains: dict[str, list[tuple[str, str]]] = {}
        for url, stype in url_entries.items():
            domain = re.sub(r"https?://(?:www\.)?", "", url).split("/")[0]
            seen_domains.setdefault(domain, []).append((url, stype))

        for domain, entries in seen_domains.items():
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
# State normalization
# ---------------------------------------------------------------------------

_STATE_CODES: dict[str, str] = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE",
    "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}


def _normalize_state(args: dict[str, Any]) -> None:
    """Normalize state field to 2-letter code in-place."""
    state = (args.get("state") or "").strip()
    if not state:
        return
    if len(state) == 2:
        args["state"] = state.upper()
        return
    code = _STATE_CODES.get(state.lower())
    if code:
        args["state"] = code


# ---------------------------------------------------------------------------
# Application draft generation
# ---------------------------------------------------------------------------


def _run_generate_application_draft(args: dict[str, Any]) -> str:
    """Generate a pre-filled PDF application from workflow output."""
    try:
        from benefit_navigator.form_filler import generate_application

        workflow_output = args.get("workflow_output", "")
        if not workflow_output:
            return (
                "Missing workflow_output. Run navigate_benefits first, then pass "
                "its full output as the workflow_output parameter."
            )

        _normalize_state(args)

        path, form_type = generate_application(args, workflow_output)

        if form_type == "official":
            return (
                f"Official state application form filled successfully.\n\n"
                f"**Form:** Pre-filled government application\n"
                f"**File:** `{path}`\n\n"
                f"**What was pre-filled:**\n"
                f"- State, ZIP code, county, and date\n"
                f"- Eligible program checkboxes\n"
                f"- Language preferences\n\n"
                f"**Next steps for the applicant:**\n"
                f"1. Open the PDF and review all pre-filled fields\n"
                f"2. Fill in personal details (name, DOB, SSN, address)\n"
                f"3. Complete remaining sections\n"
                f"4. Sign, date, and submit to your local county office\n\n"
                f"*This is a pre-filled DRAFT — review all fields before submitting.*"
            )

        return (
            f"Application Preparation Worksheet generated.\n\n"
            f"**File:** `{path}`\n\n"
            f"No official fillable form is available for this state, so an "
            f"Application Preparation Worksheet was generated instead. "
            f"Use it as a reference when filling out the official application.\n\n"
            f"**Next steps for the applicant:**\n"
            f"1. Open the PDF and review all pre-filled information\n"
            f"2. Visit the program-specific portals to access official forms\n"
            f"3. Use the worksheet to fill in the official application\n"
            f"4. Gather the documents listed in the checklist\n\n"
            f"*This is a DRAFT — verify all information before submitting.*"
        )
    except Exception:
        logger.exception("PDF generation failed")
        return "Error generating application draft. Check server logs for details."


# Populate dispatch table now that handlers are defined
_TOOL_DISPATCH.update({
    "navigate_benefits": _handle_navigate_benefits,
    "check_eligibility": _handle_check_eligibility,
    "compare_insurance_plans": _handle_compare_insurance,
    "generate_application_draft": _handle_generate_application_draft,
})


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
                    "name": "benefits-navigator",
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

_shutdown_requested = False


def _handle_sigterm(signum: int, frame: Any) -> None:
    """Handle SIGTERM for graceful shutdown."""
    global _shutdown_requested
    _shutdown_requested = True
    logger.info("SIGTERM received, shutting down gracefully")


def main() -> None:
    """Run the MCP server on stdin/stdout.

    Reads newline-delimited JSON-RPC messages from stdin and writes
    responses to stdout.  Logs go to stderr so they don't pollute the
    protocol stream.
    """
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stderr,
        format='{"level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}',
    )

    signal.signal(signal.SIGTERM, _handle_sigterm)

    # Startup validation
    if not shutil.which("kvr"):
        logger.warning("kvr not found on PATH — navigate_benefits and check_eligibility will fail")
    if not os.environ.get("CMS_API_KEY"):
        logger.warning("CMS_API_KEY not set — marketplace API features unavailable")

    logger.info("Benefit Navigator MCP server starting (stdio transport)")

    for line in sys.stdin:
        if _shutdown_requested:
            break

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
