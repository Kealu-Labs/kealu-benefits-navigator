"""Shared fixtures for benefit-navigator BDD tests."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest

from benefit_navigator.mcp_server import (
    _check_intake_completeness,
    _execute_tool,
    _handle_request,
)

# ---------------------------------------------------------------------------
# Demo household profile — single parent, Harris County TX
# ---------------------------------------------------------------------------

DEMO_PROFILE = {
    "household_profile": "Single parent, 2 kids ages 4 and 9, $42k income",
    "zip_code": "77001",
    "state": "Texas",
    "county": "Harris County",
}

DEMO_PROFILE_FULL = {
    **DEMO_PROFILE,
    "income_type": "W-2 employee",
    "current_coverage": "uninsured, lost employer coverage 3 months ago",
    "medications": "Metformin 500mg 2x/day",
    "providers": "Dr. Smith, Memorial Hermann Pediatrics",
    "premium_budget": "$300/month",
    "health_needs": "Type 2 diabetes management",
}


# ---------------------------------------------------------------------------
# Realistic mock phase outputs for the demo scenario
# ---------------------------------------------------------------------------

MOCK_PHASE_OUTPUTS = {
    "benefits-research": (
        "## Benefits Research — Harris County, Texas\n\n"
        "### SNAP (Supplemental Nutrition Assistance Program)\n"
        "- **Eligibility:** LIKELY ELIGIBLE — household of 3 at $42,000/yr "
        "is ~161% FPL (gross income limit: 130% FPL = $2,311/month gross)\n"
        "- **Estimated benefit:** $459–$573/month\n"
        "- **Note:** Texas uses gross income test. Net income must be ≤100% FPL.\n\n"
        "### CHIP (Children's Health Insurance Program)\n"
        "- **Eligibility:** LIKELY ELIGIBLE — Texas CHIP covers children in families "
        "up to 201% FPL. Two children (ages 4 and 9) qualify.\n"
        "- **Estimated value:** $0 premium (income likely below 150% FPL tier)\n\n"
        "### Medicaid\n"
        "- **Eligibility:** NOT ELIGIBLE for parent — Texas has NOT expanded Medicaid. "
        "Parent income at 161% FPL exceeds Texas limit (14% FPL for parents).\n"
        "- **Children:** May qualify for Medicaid (under 133% FPL) or CHIP (up to 201% FPL).\n\n"
        "### LIHEAP (Low Income Home Energy Assistance)\n"
        "- **Eligibility:** LIKELY ELIGIBLE — Harris County program through BakerRipley\n"
        "- **Estimated value:** $200–$500/year utility assistance\n\n"
        "### WIC (Women, Infants, and Children)\n"
        "- **Eligibility:** NOT ELIGIBLE — youngest child is 4 (WIC covers up to age 5), "
        "may qualify for remaining months\n"
    ),
    "insurance-research": (
        "## Insurance Research — ZIP 77001\n\n"
        "### ACA Marketplace (healthcare.gov)\n"
        "- **APTC Subsidy:** Estimated $380/month based on 161% FPL, household of 3\n"
        "- **Silver Plan (benchmark):** ~$620/month pre-subsidy → ~$240/month after APTC\n"
        "- **Bronze Plan:** ~$480/month pre-subsidy → ~$100/month after APTC\n"
        "- **CSR Eligible:** YES — at 161% FPL, Silver CSR-87 plan reduces deductible to ~$750\n\n"
        "### Off-Marketplace\n"
        "- **Blue Cross Blue Shield TX:** Plans available but no APTC subsidy\n"
        "- Not recommended at this income level — APTC makes marketplace plans cheaper\n\n"
        "### Short-Term Plans\n"
        "- Available in Texas (state allows up to 364 days)\n"
        "- NOT recommended: no coverage for pre-existing conditions (diabetes)\n"
    ),
    "evidence-verification": (
        "## Evidence Verification\n\n"
        "### FPL Calculation\n"
        "- Household of 3, 2025 FPL (48-state): $25,820\n"
        "- $42,000 / $25,820 = **162.7% FPL** (research phase stated 161% — CORRECTION: 162.7%)\n"
        "- Impact: minimal — does not change any eligibility threshold crossings\n\n"
        "### Medicaid Expansion Status\n"
        "- Texas: **CONFIRMED** — has NOT expanded Medicaid as of 2025\n\n"
        "### SNAP Threshold Verification\n"
        "- 130% FPL for household of 3 = $33,566/year = $2,797/month gross\n"
        "- Research phase stated $2,311/month — CORRECTION: should be $2,797/month\n"
        "- At $42,000/yr ($3,500/month gross), household EXCEEDS 130% FPL gross limit\n"
        "- **SNAP eligibility revised: LIKELY NOT ELIGIBLE** unless categorical eligibility applies\n\n"
        "### CHIP Threshold Verification\n"
        "- Texas CHIP: 201% FPL = $51,898 for household of 3\n"
        "- $42,000 < $51,898 — **CONFIRMED ELIGIBLE**\n"
    ),
    "eligibility-validation": (
        "## Eligibility Validation (Cross-Referenced)\n\n"
        "| Program | Status | Confidence | Notes |\n"
        "|---------|--------|------------|-------|\n"
        "| CHIP | ✅ ELIGIBLE | High | Children ages 4, 9 qualify at 162.7% FPL |\n"
        "| Medicaid (children) | ✅ ELIGIBLE | High | Under 133% FPL threshold for children |\n"
        "| Medicaid (parent) | ❌ NOT ELIGIBLE | High | TX non-expansion, 14% FPL limit |\n"
        "| SNAP | ⚠️ UNLIKELY | Medium | Gross income exceeds 130% FPL; check categorical |\n"
        "| ACA Marketplace | ✅ ELIGIBLE | High | APTC + CSR-87 at 162.7% FPL |\n"
        "| LIHEAP | ✅ ELIGIBLE | Medium | Income within Harris County thresholds |\n\n"
        "### Coverage Gap Identified\n"
        "Parent is in the Medicaid coverage gap — too much income for TX Medicaid, "
        "but eligible for ACA marketplace with substantial subsidies.\n"
    ),
    "action-plan": (
        "## Prioritized Action Plan\n\n"
        "### Priority 1: Children's Health Coverage (CHIP/Medicaid)\n"
        "1. Apply at https://www.yourtexasbenefits.com/\n"
        "2. Documents needed: birth certificates, proof of income (2 recent pay stubs), "
        "Social Security numbers, proof of Texas residency\n"
        "3. Timeline: apply immediately — processing takes 30-45 days\n\n"
        "### Priority 2: Parent Health Insurance (ACA Marketplace)\n"
        "1. Apply at https://www.healthcare.gov/\n"
        "2. Special Enrollment Period: 60 days from loss of coverage — **deadline approaching**\n"
        "3. Select Silver CSR-87 plan for lowest out-of-pocket with diabetes management\n"
        "4. Estimated cost: ~$240/month after APTC subsidy\n"
        "5. Documents needed: proof of prior coverage loss, income verification\n\n"
        "### Priority 3: Utility Assistance (LIHEAP)\n"
        "1. Apply through BakerRipley: https://www.bakerripley.org/\n"
        "2. Seasonal program — apply during open enrollment window\n\n"
        "### Contingency: SNAP\n"
        "- Apply at https://www.yourtexasbenefits.com/ — categorical eligibility "
        "may apply if children receive Medicaid\n"
        "- Worth applying; determination is free and takes ~30 days\n"
    ),
}


def build_decision_jsonl(phase_outputs: dict[str, str]) -> str:
    """Build a realistic decision.jsonl string from phase outputs."""
    lines = []
    for phase_name, output in phase_outputs.items():
        entry = {
            "type": "PHASE_RESULT",
            "phase_name": phase_name,
            "metadata": {"output": output},
        }
        lines.append(json.dumps(entry))
    return "\n".join(lines) + "\n"


@pytest.fixture
def demo_profile():
    """The demo household profile (tier-1 complete)."""
    return dict(DEMO_PROFILE)


@pytest.fixture
def demo_profile_full():
    """Fully populated demo profile."""
    return dict(DEMO_PROFILE_FULL)


@pytest.fixture
def mock_phase_outputs():
    """Realistic phase outputs for the demo scenario."""
    return dict(MOCK_PHASE_OUTPUTS)


@pytest.fixture
def mock_kvr(tmp_path, monkeypatch):
    """Mock kvr subprocess to return realistic phase output files.

    Returns a helper that lets tests configure which phases appear.
    """

    class KvrMock:
        def __init__(self):
            self.called_with: list[list[str]] = []
            self.phase_outputs = dict(MOCK_PHASE_OUTPUTS)
            self.var_file_data: dict = {}

        def configure(self, **overrides):
            self.phase_outputs.update(overrides)

        def _run(self, cmd, **kwargs):
            self.called_with.append(list(cmd))

            # Capture var-file data before it gets cleaned up
            for i, arg in enumerate(cmd):
                if arg == "--var-file" and i + 1 < len(cmd):
                    try:
                        import pathlib
                        self.var_file_data = json.loads(pathlib.Path(cmd[i + 1]).read_text())
                    except (FileNotFoundError, json.JSONDecodeError):
                        pass

            # Extract run-id from command
            run_id = "mock-run-001"
            for i, arg in enumerate(cmd):
                if arg == "--run-id" and i + 1 < len(cmd):
                    run_id = cmd[i + 1]

            # Write phase output .md files and decision.jsonl (matching real kvr format)
            log_dir = tmp_path / ".workforce" / run_id
            log_dir.mkdir(parents=True, exist_ok=True)
            decision_lines = []
            for phase_name, output in self.phase_outputs.items():
                md_path = log_dir / f"{phase_name}.md"
                md_path.write_text(output)
                decision_lines.append(json.dumps({
                    "decision_type": "phase_complete",
                    "phase": phase_name,
                }))
            (log_dir / "decision.jsonl").write_text("\n".join(decision_lines) + "\n")

            result = MagicMock()
            result.returncode = 0
            result.stdout = "Workflow completed successfully"
            result.stderr = ""
            return result

    mock = KvrMock()

    # Patch subprocess.run inside the mcp_server module
    import benefit_navigator.mcp_server as mcp_mod

    original_run = mcp_mod._run_benefit_navigator

    def patched_run_benefit_navigator(args, *, progress_token=None):
        import subprocess as sp

        monkeypatch.setattr(sp, "run", mock._run)
        # Also patch Path.cwd() to return tmp_path
        monkeypatch.setattr("pathlib.Path.cwd", lambda: tmp_path)
        return original_run(args, progress_token=progress_token)

    monkeypatch.setattr(mcp_mod, "_run_benefit_navigator", patched_run_benefit_navigator)

    return mock
