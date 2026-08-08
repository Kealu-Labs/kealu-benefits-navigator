# Architecture

## System Overview

```
┌──────────────────────────────────┐   ┌─────────────────────────────────────┐
│  Web App (web/)                  │   │  Google Antigravity                 │
│  Next.js 15 — browser UI        │   │  Agent-first IDE — MCP client       │
│                                  │   │                                     │
│  Chat intake → SSE progress      │   │  Conversational interface           │
│  → rendered report               │   │  (unchanged by web app)             │
└──────────┬───────────────────────┘   └──────────────┬──────────────────────┘
           │ HTTP (API routes)                        │ MCP (JSON-RPC 2.0 / stdio)
           │ POST /api/workflow/start                 │
           │ GET  /api/workflow/{id}/stream (SSE)     │
           ▼                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  MCP Server (benefits_navigator)                               stdlib-only   │
│                                                                              │
│  ┌──────────────┐  ┌───────────────────┐  ┌──────────────────────────────┐  │
│  │  Tool Router  │  │  Tiered Intake    │  │  Household Parser            │  │
│  │  & Dispatch   │  │  (3-tier profile  │  │  (_parse_household_for_api,  │  │
│  │               │  │   completeness)   │  │   _parse_income)             │  │
│  └──────┬───────┘  └───────────────────┘  └──────────────────────────────┘  │
│         │                                                                    │
│  ┌──────┴────────────────────────────────────────────────────────────────┐   │
│  │                        Tool Execution Layer                           │   │
│  │                                                                       │   │
│  │  navigate_benefits ──▶ kvr run (5-phase workflow)                     │   │
│  │                         + MCP progress notifications                  │   │
│  │                                                                       │   │
│  │  check_eligibility ──▶ CMS eligibility API ──▶ kvr assist             │   │
│  │                        (enrichment)            (analysis)             │   │
│  │                                                                       │   │
│  │  compare_plans ──────▶ CMS plan search API                            │   │
│  │                        (fallback: kvr assist)                         │   │
│  │                                                                       │   │
│  │  generate_draft ────▶ PDF generator (stdlib-only)                     │   │
│  │                        (pre-filled application draft)                 │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└────────────┬───────────────────────────────────────┬─────────────────────────┘
             │                                       │
             ▼                                       ▼
┌────────────────────────┐             ┌──────────────────────────┐
│  Kealu Vector (kvr)    │             │  Healthcare.gov          │
│                        │             │  Marketplace API         │
│  5 agents (model-      │             │                          │
│  agnostic, Gemini in   │             │  Plan search             │
│  target env)           │             │  APTC/CSR estimates      │
│  Parallel DAG          │             │  Medicaid screening      │
│  Quality gates         │             │  County resolution       │
└────────────────────────┘             └──────────────────────────┘
```

The web app and Antigravity are independent entry points that both delegate to the same MCP server and `kvr` workflow. The web app spawns `kvr` directly from its Next.js route handlers (in addition to the MCP path) and relays `[PHASE_STREAM]` events to the browser over SSE.

## Data Flow

**Web app path:**
1. **User → Browser** — types household details in chat interface
2. **Browser → Next.js API routes** — `POST /api/intake` (tiered intake conversation)
3. **Next.js → kvr** — `POST /api/workflow/start` spawns `kvr run benefits-navigator` (array-based spawn, no shell)
4. **kvr → Next.js** — `[PHASE_STREAM]` events relayed to browser via SSE (`GET /api/workflow/{id}/stream`)
5. **kvr → `.workforce/{runId}/`** — writes 5 phase `.md` files to repo-root directory
6. **Next.js → Browser** — `GET /api/workflow/{id}/report` assembles, caches, and deletes run directory

**MCP / Antigravity path:**
1. **User → Antigravity** — natural language ("I need help with benefits")
2. **Antigravity → MCP Server** — JSON-RPC `tools/call` with structured arguments
3. **MCP Server → Intake Check** — determines if enough data exists for analysis
4. **MCP Server → kvr / CMS API** — dispatches to appropriate backend
5. **kvr → 5 agents** — parallel research, adversarial verification, eligibility, action plan (model-agnostic; Gemini in target config)
6. **CMS API → MCP Server** — real plan data, subsidy calculations
7. **MCP Server → Antigravity** — structured markdown response
8. **Antigravity → User** — conversational presentation of results

## Key Boundaries

| Boundary | Left side | Right side | Protocol |
|----------|-----------|------------|----------|
| User ↔ Web App | Browser | Next.js 15 (Node.js) | HTTPS + SSE |
| User ↔ AI (MCP path) | Antigravity UI | Gemini + MCP Server | MCP over stdio |
| Web App ↔ KVR | Next.js route handler | kvr binary | child_process.spawn (array args) |
| MCP Server ↔ Orchestrator | Python process | kvr binary | subprocess + decision.jsonl |
| MCP Server ↔ CMS | Python process | Healthcare.gov | HTTPS REST API |
| Orchestrator ↔ Agents | kvr runner | LLM API (model-agnostic) | Gemini API in target config (via kvr) |

## Directory Structure Rationale

```
kealu-benefits-navigator/          # Domain project — owns all healthcare logic
├── web/                           # Next.js 15 web interface (TypeScript)
├── src/benefits_navigator/        # Runtime code (MCP server + API client)
├── workflows/                    # Vector workflow YAML (declarative)
├── personas/community/           # Agent behavior definitions (markdown)
├── contexts/community/           # Domain knowledge (FPL tables, program data)
└── tests/                        # Python BDD tests (pytest-bdd)

kealu-agents-workforce/           # Vector monorepo — generic orchestrator
└── (no healthcare knowledge)     # kvr consumed as a binary, not a library
```

The `web/` subdirectory is isolated from the Python package (`src/`). The web app reads the same `workflows/`, `personas/`, and `contexts/` directories at runtime via `kvr` — it does not import them directly. Both entry points write to `.workforce/` in the repository root (not under `web/`).

---

# Architecture Decision Records

## ADR-001: Zero-dependency MCP server

**Status:** Accepted

**Context:** The MCP server bridges Antigravity and Vector. MCP requires JSON-RPC 2.0 over stdio — a simple protocol. Adding dependencies (FastAPI, httpx, pydantic) would require dependency management, version conflicts with the host environment, and a heavier install footprint.

**Decision:** Use only Python standard library (`json`, `sys`, `urllib.request`, `subprocess`). No pip packages required at runtime.

**Consequences:**
- `urllib.request` instead of `httpx` for CMS API calls — slightly more verbose but zero install friction
- No request retry/backoff library — acceptable for a tool that falls back to kvr assist on failure
- Any machine with Python 3.11+ can run the server without `pip install`
- Test dependencies (`pytest`, `pytest-bdd`) are dev-only and isolated in `[project.optional-dependencies]`

## ADR-002: CMS Marketplace API with graceful degradation

**Status:** Accepted

**Context:** The benefit navigator needs insurance plan data. Options: (a) let Gemini generate plan info from training data (risk: hallucinated plan names, stale premiums), (b) scrape Healthcare.gov (fragile, against ToS), (c) use the official CMS Marketplace API (real data, free, rate-limited).

**Decision:** Use the CMS Marketplace API for `compare_insurance_plans` and eligibility enrichment. Fall back to `kvr assist` (Gemini analysis) when the API key is not configured or the API is unreachable.

**Consequences:**
- Live data eliminates hallucinated plan names and premiums — the single biggest credibility risk
- Graceful fallback means the system works without an API key (just with AI-generated estimates)
- API key stored in `.env` (gitignored), loaded via environment variable
- Rate-limited test key available for demos without approval wait

## ADR-003: Domain isolation — benefits-navigator owns all healthcare logic

**Status:** Accepted

**Context:** Vector is a generic orchestrator used across industries. Healthcare-specific logic (FPL calculations, program eligibility rules, CMS API integration) should not leak into the Vector codebase.

**Decision:** All domain knowledge lives in `kealu-benefits-navigator`. Vector is consumed as a binary (`kvr`), not a library. The MCP server decides what to delegate to Vector (multi-agent workflow) vs. handle directly (API calls, intake logic).

**Consequences:**
- Vector remains reusable for any domain — no healthcare coupling
- The MCP server is the integration point, not Vector
- Workflow YAML, personas, and contexts are project-local, discovered by kvr via cwd resolution
- Other teams can use Vector for their own domains without importing healthcare code

## ADR-004: Adversarial verification as a dedicated workflow phase

**Status:** Accepted

**Context:** LLMs hallucinate. In benefits navigation, a wrong FPL calculation or incorrect Medicaid expansion status can lead someone to miss coverage they qualify for or waste time applying for programs they don't. Simply asking one agent to "be careful" is insufficient.

**Decision:** Dedicate Phase 3 to an adversarial Evidence Verifier agent that independently recalculates every data point from the research phases. If critical errors are found, a feedback loop sends corrections back to Phases 1 & 2 for re-execution.

**Consequences:**
- Every FPL percentage is calculated twice by different agents and cross-checked
- Medicaid expansion status is verified against the reference context, not assumed
- Income thresholds are recalculated from FPL tables, not trusted from research output
- Feedback loops add latency when errors are found — acceptable tradeoff for correctness
- Quality gate on Phase 3 includes `not_contains: "## CRITICAL ERRORS FOUND"` — workflow fails if the verifier finds uncorrectable errors

## ADR-005: BDD tests with mocked subprocess and API responses

**Status:** Accepted

**Context:** The MCP server calls external systems (`kvr` subprocess, CMS API). Integration tests against live systems are slow, flaky, and require API keys. But pure unit tests miss the integration logic.

**Decision:** Use pytest-bdd with Gherkin feature files. Mock `subprocess.run` and `urllib` at the boundary. Test fixtures use realistic Texas-specific data (Harris County, 77001, $42k income, household of 3) that exercises real eligibility logic.

**Consequences:**
- 78 mocked tests run in <0.2 seconds — fast enough for pre-commit
- Feature files serve as executable documentation of system behavior
- Mock data mirrors real CMS API response structure — catches deserialization bugs
- No live API dependency for CI — tests pass without `CMS_API_KEY`
- 3 integration tests (`pytest -m integration`) hit the live CMS API to verify contract compatibility — skipped by default, run when `CMS_API_KEY` is set

## ADR-006: MCP progress notifications via kvr phase streaming

**Status:** Accepted

**Context:** The navigate_benefits workflow takes 2-5 minutes. During this time, Antigravity shows no progress — the user doesn't know if the system is working or stuck.

**Decision:** When the MCP client includes a `progressToken` in the `tools/call` request, the MCP server adds `--phase-stream stdout` to the kvr command, reads `[PHASE_STREAM]` events via `subprocess.Popen`, and translates them to MCP `notifications/progress` messages.

**Consequences:**
- Users see "Running: Benefits Research", "Completed: Evidence Verification", etc. in real time
- No progress overhead when client doesn't request it (falls back to `subprocess.run`)
- `total` field updates naturally from kvr's event stream — no hardcoded phase count
- Requires kvr 0.114.13+ for `--phase-stream` support

## ADR-007: Tiered intake flow instead of mandatory form fields

**Status:** Accepted

**Context:** Benefits eligibility depends on many variables (ZIP, income, household, medications, providers, coverage status). Requiring all fields upfront creates friction. But running analysis without critical data produces generic, unhelpful results.

**Decision:** Three-tier intake: Tier 1 (ZIP, income, household — required), Tier 2 (coverage, medications, providers, budget — recommended), Tier 3 (health needs, usage pattern — optional). The MCP server returns follow-up questions for missing tiers instead of running analysis. Users can `skip_intake: true` to proceed with available data.

**Consequences:**
- First tool call returns conversational questions, not a 15-field form
- Gemini sees structured guidance ("ask about medications because formulary tiers vary $10-$200") and can ask naturally
- Analysis quality degrades gracefully — Tier 1 only gives general results, full profile gives personalized plan matching
- `skip_intake` escape hatch prevents the system from blocking users who want quick answers

## ADR-008: Next.js 15 web app as an additional browser-based interface

**Status:** Accepted

**Context:** The MCP/Antigravity interface requires users to have Google Antigravity installed and configured. Most end users — the households who need benefits navigation most — are not AI-IDE users. The existing workflow, personas, and MCP server are solid; the gap is a publicly accessible entry point that runs in any browser without setup.

**Decision:** Add a Next.js 15 + TypeScript web app under `web/` that provides: (a) a chat-style intake conversation collecting the same three-tier household profile used by the MCP server; (b) real-time workflow progress via Server-Sent Events relaying `[PHASE_STREAM]` events from `kvr`; (c) a rendered report assembled from the five phase `.md` files KVR writes to `.workforce/{runId}/`. The web app spawns `kvr` directly from Next.js route handlers using `child_process.spawn` with array arguments (no shell interpolation). Anonymous sessions use an `httpOnly SameSite=Strict` cookie with a 2-hour TTL; no user account is required. The existing MCP server, workflow YAMLs, personas, contexts, and Python tests are unchanged.

**Consequences:**
- Any browser can now access the benefit navigator without installing Antigravity or configuring MCP
- Session state (intake answers, run ID, assembled report) is held in a server-side in-memory `Map`; nothing is written to disk; run directories are deleted immediately after report assembly
- The app requires self-hosted deployment or a platform supporting long-lived SSE connections (up to 30 minutes per workflow run) — documented prominently in `README.md` and `web/README.md`
- Startup sweep in `web/src/instrumentation.ts` cleans up orphaned UUID v4 run directories (web app runs) older than 30 minutes; `mcp-navigator-*` directories (Python MCP server runs) are explicitly excluded from this sweep
- Report content is cached in the session `Map` before the run directory is deleted, satisfying both the PII-cleanup requirement and session-reload continuity
- Two entry points share the same `kvr` binary and workflow definitions — no duplication of domain logic
