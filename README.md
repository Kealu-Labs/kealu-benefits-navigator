# Benefit & Insurance Navigator

Model-agnostic multi-agent system that discovers government benefits and insurance plans, validates eligibility, and produces prioritized enrollment action plans. Built with [Kealu Vector](https://kealu.com), an enterprise AI workflow orchestrator, and integrated with **Google Antigravity** via MCP. Kealu Vector supports any LLM provider — our target environment uses **Gemini**.

## The Problem

An estimated **$80 billion** in government benefits goes unclaimed every year in the United States — not because people don't qualify, but because they can't find or navigate the programs. SNAP alone leaves roughly [$13 billion unclaimed annually](https://www.fns.usda.gov/snap/participation-rates). Medicaid, CHIP, LIHEAP, Section 8, WIC, TANF — each has its own eligibility rules, application process, income thresholds, and deadlines, spread across federal, state, and county agencies with no single point of entry.

The people who need these programs most are the least equipped to navigate them. A single parent working two jobs doesn't have time to cross-reference 15 programs across 3 government levels, verify which income thresholds use gross vs. net, figure out whether Medicaid expansion applies in their state, or catch that qualifying for one program changes eligibility for another. The alternative — a benefits counselor — costs $100-300 per session, assuming one is available in your area.

**This is an information problem.** The data exists. The eligibility rules are public. But they're scattered across hundreds of `.gov` websites, updated on different schedules, and written in language that assumes you already know which program to look for. What's missing is a system that can gather all of it, validate it against your specific situation, and tell you exactly what to do — with the same rigor a professional counselor would apply, but accessible to anyone with a conversation.

## How It Works

A user asks Antigravity for help with benefits. Through the MCP server, Vector orchestrates a 5-phase workflow where each phase is handled by a specialized agent (Gemini in our target configuration, but Vector is model-agnostic):

```
                  ┌──────────────┐         ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
                  │  Phase 1     │         │  Phase 3     │    │  Phase 4     │    │  Phase 5     │
┌──────────┐      │  Benefits    ├───┐     │  Evidence    ├───▶│  Eligibility ├───▶│  Action      │
│ Antigrav.├─────▶│  Research    │   ├────▶│  Verification│    │  Validation  │    │  Plan        │
│  (user)  │      └──────────────┘   │     └───────┬──────┘    └──────────────┘    └──────────────┘
└──────────┘      ┌──────────────┐   │             │
                  │  Phase 2     │   │             │
                  │  Insurance   ├───┘             │
                  │  Research    │                 │
                  └──────────────┘                 │
                         ▲                         │
                         │   feedback loop         │
                         │  (on critical errors)   │
                         └─────────────────────────┘

                  ◀── parallel ──▶
```

1. **Benefits Research** — Discovers federal, state, and county assistance programs (SNAP, Medicaid, CHIP, WIC, LIHEAP, Section 8, TANF, etc.) with estimated dollar values
2. **Insurance Research** — Compares plans across 6 channels: ACA marketplace, off-marketplace, short-term, health sharing ministries, ICHRA, QSEHRA — with copay-level detail
3. **Evidence Verification** — Adversarial fact-checker that independently recalculates FPL, verifies Medicaid expansion status, cross-checks data consistency across phases, and validates every income threshold against reference tables. **If critical errors are found, a feedback loop sends corrections back to phases 1 & 2 for re-execution.**
4. **Eligibility Validation** — Cross-validates all determinations using verified data, detects coverage gaps and income cliffs
5. **Action Plan** — Produces a prioritized enrollment plan with deadlines, document checklists, application URLs, and contingency paths

Phases 1 & 2 run **in parallel** via a dependency DAG. Phase 3 acts as an adversarial checkpoint — if the research agents hallucinated data or made calculation errors, the feedback loop catches it before eligibility determinations are made. Quality gates enforce output completeness and catch vague language.

## Why Kealu Vector

Most AI tools give you a single prompt and a single model call. Vector orchestrates **multiple specialized agents** through structured, multi-phase workflows — each agent has a defined persona, domain context, and quality gates that validate its output before the next phase begins. Vector is model-agnostic: swap the underlying LLM by changing a single configuration value without touching workflow logic, personas, or quality gates.

What makes this different from a prompt chain or a simple agent loop:

- **Parallel execution with dependency DAGs** — phases that don't depend on each other run concurrently (benefits research and insurance research run in parallel, cutting wall-clock time in half)
- **Quality gates** — 12 gate types (contains, not_contains, model_eval, grounded_claims, etc.) with composite logic. The action planner can't produce "apply soon" — the gate catches vague language and forces specificity
- **Adversarial fact-checking with feedback loops** — a dedicated Evidence Verifier agent independently recalculates every FPL percentage, verifies Medicaid expansion status, and cross-checks data consistency. If it finds critical errors, a feedback loop automatically sends corrections back to the research phases for re-execution — agents correct each other, not just flag problems
- **Persona-driven agents** — each agent has explicit scope boundaries, a self-verification checklist, and anti-patterns to avoid. The insurance analyst knows to check formulary tiers and ER copays; the action planner knows to never say "contact your state agency" without providing the actual URL
- **Domain context injection** — agents receive reference data (FPL tables, Medicaid expansion status, program thresholds) as verified context, not as training data that might be stale or hallucinated
- **Full decision logging** — every prompt, output, cost, and quality gate result is logged for audit and debugging

Vector was built for enterprise environments where AI outputs need to be **verifiable, auditable, and safe** — not just impressive. The same platform has orchestrated 550,000+ lines of audited code for regulated industries through 18-phase code reviews with security analysis — the benefit navigator runs on the same infrastructure, not a hackathon prototype.

### Built with Vector

This benefit navigator was itself built using `kvr assist`, Vector's AI-powered development workflow. The personas, contexts, quality gates, and MCP integration in this repo were developed through Vector's intention-to-outcome alignment — where every task starts with a plan, executes through traceable steps, and produces auditable decision logs. The tool that orchestrates the benefit agents is the same tool that wrote them.

## Privacy & Data Sensitivity

Benefits navigation involves sensitive personal information — income, household composition, health conditions, medications, and immigration-adjacent data. While this tool does not store, persist, or transmit Protected Health Information (PHI) and is not a HIPAA-covered entity, the architecture is designed with data sensitivity in mind:

- **No data persistence** — user profile data lives only in the workflow run's memory and decision log. Nothing is written to a database or sent to third parties.
- **Local execution** — the MCP server runs on the user's machine. Household data flows directly from Antigravity to Gemini via Vector, never through an intermediary service.
- **Auditable outputs** — every determination cites its source (`.gov` URL, FPL table reference, or explicit "unverified" classification). Users can verify claims before acting.
- **No training on user data** — Gemini API calls do not use input data for model training.

- **Decision logs** — every prompt, agent output, quality gate result, and cost is recorded in append-only JSONL logs. If a user disputes a recommendation, the full reasoning chain is reconstructable. In a production deployment, Vector's enterprise features add encryption (RSA+AES) and cryptographic sealing for tamper-proof audit trails.

In a production deployment, Vector's enterprise features add further controls: data sovereignty zones (restricting which data reaches which model endpoints) and role-based access to audit trails.

## Coverage

- All 50 US states + DC
- US territories (Puerto Rico, Guam, USVI, American Samoa, CNMI)
- 2025 Federal Poverty Level tables (48-state, Alaska, Hawaii)
- Medicaid expansion status tracking (10 non-expansion states)

## Architecture

```
kealu-benefits-navigator/
├── src/benefits_navigator/     # MCP server (stdlib-only core, pypdf optional)
│   ├── mcp_server.py          # MCP JSON-RPC 2.0 over stdio + tool dispatch
│   ├── marketplace_api.py     # Healthcare.gov Marketplace API client (live plan data)
│   ├── form_filler.py         # Official form filling (pypdf) with worksheet fallback
│   ├── pdf_generator.py       # Zero-dependency PDF worksheet generator
│   ├── forms/                 # Official fillable form templates (4 states)
│   │   ├── CA-SAWS-1.pdf      # California SAWS-1 (CalFresh/Medi-Cal/CalWORKs)
│   │   ├── IL-444-2378B.pdf   # Illinois IL444-2378B (Cash/Medical/SNAP combined)
│   │   ├── NY-LDSS-4826-DD.pdf # New York LDSS-4826-DD (SNAP)
│   │   └── PA-600.pdf         # Pennsylvania PA-600 (Cash/Healthcare/SNAP)
│   ├── __main__.py            # python -m benefits_navigator
│   └── __init__.py
├── workflows/                 # Kealu Vector workflow definitions
│   └── benefits-navigator.yaml # 5-phase parallel workflow with quality gates
├── personas/community/        # Agent persona definitions
│   ├── benefits-researcher.md
│   ├── insurance-analyst.md
│   ├── evidence-verifier.md
│   ├── eligibility-analyst.md
│   └── action-planner.md
├── contexts/community/        # Domain knowledge contexts
│   └── benefits-navigator.md   # FPL tables, program reference, quality standards
├── tests/                     # 78 BDD tests (pytest-bdd) + 3 integration tests
│   ├── features/              # Gherkin scenarios
│   └── step_defs/             # Step implementations
├── .env.example               # CMS API key template
└── .env                       # Your API key (gitignored)
```

## Prerequisites

- Python 3.11+
- [Kealu Vector](https://kealu.com) CLI (`kvr`) >= 0.114.13 installed and on PATH
- (Optional) [CMS Marketplace API key](https://developer.cms.gov/marketplace-api/key-request.html) for live insurance plan data

## Setup

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install in development mode
pip install -e .

# Configure CMS API key (optional — enables live Healthcare.gov plan data)
cp .env.example .env
# Edit .env and add your CMS_API_KEY
```

## Usage

### With Google Antigravity (MCP)

Add to `~/.gemini/antigravity/mcp_config.json`:

```json
{
  "mcpServers": {
    "benefits-navigator": {
      "command": "/bin/zsh",
      "args": ["-c", "set -a && [ -f ~/.env ] && source ~/.env; [ -f /path/to/kealu-benefits-navigator/.env ] && source /path/to/kealu-benefits-navigator/.env && set +a && exec /path/to/kealu-benefits-navigator/.venv/bin/python -m benefits_navigator"],
      "cwd": "/path/to/kealu-benefits-navigator"
    }
  }
}
```

Then ask Antigravity: "I need help finding benefits and insurance options for my family"

The MCP server guides the conversation through a tiered intake flow — collecting ZIP code, income, household composition, medications, providers, and budget — before triggering the full 5-phase analysis.

### With Kealu Vector CLI

```bash
kvr run benefits-navigator \
  --var "household_profile=Single parent, 2 kids ages 4 and 9, $42k income" \
  --var "zip_code=77001" \
  --var "state=Texas" \
  --var "county=Harris County"
```

## Tools Exposed via MCP

| Tool | Data source | Description |
|------|-------------|-------------|
| `navigate_benefits` | Vector 5-phase workflow | Full analysis with guided intake flow |
| `check_eligibility` | CMS API + Vector | Single-program eligibility check, enriched with live APTC/FPL/Medicaid data. Accepts optional `zip_code` for county/state resolution. |
| `compare_insurance_plans` | CMS Marketplace API | Real plan names, premiums, deductibles, and subsidy calculations from Healthcare.gov |
| `generate_application_draft` | Official forms + local PDF | Fills real government forms (CA SAWS-1) or generates preparation worksheets |

When `CMS_API_KEY` is configured, `compare_insurance_plans` returns real marketplace plans with APTC-adjusted premiums and `check_eligibility` includes live CMS data (FPL percentage, APTC amount, state Medicaid thresholds). Without the key, both fall back gracefully to Vector's AI-powered analysis.

After analysis, `generate_application_draft` produces a pre-filled application PDF. For states with official fillable forms (CA, IL, NY, PA), it fills the actual government form — checking program eligibility boxes, pre-filling location and date fields. For other states, it generates an Application Preparation Worksheet. The system doesn't just advise — it takes action.

**Supported official forms:**
| State | Form | Programs |
|-------|------|----------|
| California | SAWS-1 | CalFresh, Medi-Cal, CalWORKs |
| Illinois | IL444-2378B | SNAP, Medicaid, Cash Assistance |
| New York | LDSS-4826-DD | SNAP |
| Pennsylvania | PA-600 | SNAP, Medicaid, Cash Assistance |

### Healthcare.gov Marketplace API

The CMS Marketplace API provides:
- **Real plan search** — actual plan names, issuers, premiums, deductibles, and out-of-pocket maximums for any US ZIP code
- **APTC subsidy calculation** — household-specific tax credit amounts based on income and FPL
- **CSR eligibility** — cost-sharing reduction levels that lower deductibles on Silver plans
- **Medicaid/CHIP screening** — flags households that may qualify before they spend time on marketplace plans
- **Provider/drug coverage** — API endpoints available for verifying doctor and medication coverage (not yet wired into MCP tools)

## Architecture & Decision Records

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system diagram, data flow, key boundaries, and 7 Architecture Decision Records covering zero-dependency design, CMS API integration, domain isolation, adversarial verification, BDD test strategy, progress streaming, and tiered intake flow.

## Technologies

- **Gemini** (target environment) — Powers all 5 specialized agents through Kealu Vector's model-agnostic orchestration
- **Google Antigravity** — Agent-first IDE providing the conversational interface via MCP
- **Healthcare.gov Marketplace API** — Live insurance plan data, subsidy calculations, and eligibility estimates from CMS
- **MCP (Model Context Protocol)** — stdio-based JSON-RPC 2.0 connecting Antigravity to the benefit navigator
- **Kealu Vector** — Enterprise workflow orchestrator with parallel phases, quality gates, persona-driven agents, and decision logging
