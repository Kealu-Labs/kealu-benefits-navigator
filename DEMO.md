# Demo Script

## Prerequisites

1. Antigravity running with benefit-navigator MCP server loaded
2. `CMS_API_KEY` configured (enables live Healthcare.gov data)

## MCP Config

```json
{
  "mcpServers": {
    "benefit-navigator": {
      "command": "/bin/zsh",
      "args": [
        "-c",
        "set -a && source /Users/sempi/.env && source /Users/sempi/dev/kealu-benefit-navigator/.env && set +a && exec /Users/sempi/dev/kealu-benefit-navigator/.venv/bin/python -m benefit_navigator"
      ],
      "cwd": "/Users/sempi/dev/kealu-benefit-navigator"
    }
  }
}
```

## Prompts

Paste each prompt after the previous response completes.

### Prompt 1 — Opening

> What benefits and health insurance options are available for my family in Houston?

**What happens:** Triggers tool discovery and tier-1 intake. The MCP server returns follow-up questions (ZIP, income, household) instead of generic advice.

**What to highlight:** Conversational intake flow — no parameter dump, no form to fill out.

### Prompt 2 — Full Profile

> My ZIP is 77001. I make $42,000/year as a W-2 employee. It's me and my two kids, ages 4 and 9. I lost my employer health insurance about 6 weeks ago — they offered COBRA but it's $1,400/month, way too expensive. My son takes Zyrtec daily for allergies and I take Lisinopril 10mg for blood pressure. We see Dr. Sarah Chen at Texas Children's Pediatrics and I see Dr. James Park at Kelsey-Seybold. I'd like to keep both doctors. I can afford maybe $250-300/month for premiums. My 4-year-old has asthma so we need good urgent care and ER coverage.

**What happens:** Hits all intake tiers, triggers the full 5-phase parallel workflow — benefits research, insurance research, evidence verification, eligibility validation, and action plan.

**What to highlight:**
- SEP urgency detection (6 weeks ago = ~2 weeks left on 60-day window)
- Texas non-expansion Medicaid coverage gap identified
- Adversarial evidence verification catches and corrects FPL calculation
- Prioritized action plan with .gov URLs and deadlines

### Prompt 3 — Insurance Comparison (Live API)

> Can you compare the actual health insurance plans available to me?

**What happens:** Calls the CMS Marketplace API with the household profile. Returns real Healthcare.gov plans with APTC-adjusted premiums.

**What to highlight:**
- **Live data from Healthcare.gov** — real plan names, real issuers, real premiums
- APTC subsidy calculated for this specific household
- CSR eligibility flagged (Silver CSR-87 at ~163% FPL)
- Premium range shows after-subsidy costs within stated budget

### Prompt 4 — Eligibility Check (CMS Enrichment)

> Am I eligible for CHIP for my kids?

**What happens:** CMS API provides live APTC/FPL/Medicaid data, layered on top of Vector's AI analysis with FPL tables and state-specific rules.

**What to highlight:**
- Live FPL percentage from CMS
- State Medicaid thresholds from CMS
- Vector analysis cross-references against program-specific rules
- Two data sources (live API + AI analysis) producing a verified answer

## Key Talking Points

- **$80B problem** — that's how much goes unclaimed in US government benefits annually
- **Live data, not hallucination** — Healthcare.gov Marketplace API returns real plans, real premiums
- **Adversarial verification** — a dedicated agent fact-checks the other agents' work
- **5 specialized Gemini agents** orchestrated in parallel by Kealu Vector
- **Zero dependencies** — MCP server is stdlib-only Python, no pip packages needed
- **59 BDD tests** — full coverage of intake flow, MCP protocol, tool routing, workflow output, and marketplace API integration
