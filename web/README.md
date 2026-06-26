# Benefits Navigator — Web App

A Next.js 15 + TypeScript web interface for the Kealu Benefits Navigator. Provides a chat-style intake conversation, real-time KVR workflow progress via Server-Sent Events, and a rendered benefits report — all without requiring a user account.

The web app is an additional interface alongside the existing MCP/Antigravity integration. It spawns KVR directly from Next.js route handlers. Existing workflow YAMLs, personas, contexts, and the Python MCP server are unchanged.

---

## Prerequisites

| Dependency | Requirement | Notes |
|------------|-------------|-------|
| Node.js | ≥ 18.0 | |
| `kvr` CLI | ≥ 0.114.13 | Must be on PATH — `kvr --version` |
| `CMS_API_KEY` | Optional | Falls back to `kvr assist` mode if absent |

Install the Kealu Vector CLI: follow the installation guide in the repository root README.

---

## Setup

```bash
cd web
cp .env.example .env.local          # Add CMS_API_KEY if available
npm install
npm run dev                          # http://localhost:3000
```

Check readiness after starting:

```bash
curl http://localhost:3000/api/health
# { "kvr": "ok", "cms_api_key": "set", "version": "0.225.0" }
```

---

## Architecture

```
Browser ──POST /api/intake──► Session store (in-memory Map)
        ──POST /api/workflow/start──► kvr run benefits-navigator ...
        ──GET  /api/workflow/{id}/stream──► SSE relay (phase events)
        ──GET  /api/workflow/{id}/report──► Assembled markdown report
```

- **Session management**: anonymous `httpOnly` `SameSite=Strict` cookie; 2-hour TTL; in-memory store only — nothing is written to disk
- **KVR subprocess**: spawned via `child_process.spawn` (array args, no shell) from the repo root so `.workforce/{runId}/` lands in the correct location
- **SSE relay**: streams `[PHASE_STREAM]` events from KVR stdout to the browser; keep-alive ping every 15 s; SIGTERM after 60 s if all listeners disconnect
- **Report assembly**: reads five `.md` files from `.workforce/{runId}/`, caches in session, then immediately deletes the run directory (PII cleanup)
- **Markdown rendering**: `marked` (GFM tables, code blocks) + `sanitize-html` (no DOM dependency — works identically in Node.js and browser)

---

## Project structure

```
web/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── health/route.ts         GET  /api/health
│   │   │   ├── session/route.ts        GET  /api/session
│   │   │   ├── intake/route.ts         POST /api/intake
│   │   │   └── workflow/
│   │   │       ├── start/route.ts      POST /api/workflow/start
│   │   │       └── [runId]/
│   │   │           ├── stream/route.ts GET  /api/workflow/{runId}/stream
│   │   │           └── report/route.ts GET  /api/workflow/{runId}/report
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── app-shell.tsx               View-transition state machine
│   │   ├── chat-interface.tsx          Guided intake conversation
│   │   ├── phase-tracker.tsx           Real-time SSE progress view
│   │   ├── report-view.tsx             Rendered markdown report
│   │   └── error-banner.tsx            Inline error with retry
│   ├── lib/
│   │   ├── session-store.ts            In-memory session Map (singleton)
│   │   ├── kvr-checker.ts              Binary detection + version check
│   │   ├── kvr-runner.ts               Subprocess lifecycle + SSE fan-out
│   │   ├── intake-flow.ts              Tier-based question logic
│   │   └── report-assembler.ts         Phase .md file assembly
│   ├── types/session.ts
│   └── instrumentation.ts              Startup checks + orphan sweep
└── tests/
    ├── unit/                           Pure-function unit tests (Vitest)
    ├── api/                            Route handler tests (Vitest)
    ├── integration/                    Cross-boundary tests (real fs/kvr)
    └── e2e/                            Full browser journeys (Playwright)
```

---

## Deployment notes

> **Important**: This app streams SSE connections that remain open for up to 30 minutes while KVR runs a 5-phase workflow with feedback loops. Most managed hosting platforms (Vercel Hobby, Railway free tier) impose per-request timeouts of 30–300 seconds that will terminate these connections.
>
> **Recommended**: Self-host using `npm run build && npm start` (or the `standalone` output), or use a platform that supports long-lived streaming responses (Vercel Pro with `maxDuration = 0`, Fly.io, Render, etc.).

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CMS_API_KEY` | No | Healthcare.gov Marketplace API key. Without it, the workflow runs in `kvr assist` mode (complete report, no real-time marketplace data). Request at [developer.cms.gov](https://developer.cms.gov/marketplace-api/key-request.html). |
| `NODE_ENV` | Auto | Set to `production` to enable `Secure` cookie flag and tighten CSP. |

### `kvr` must be on PATH

The Next.js server process must be able to execute `kvr` directly. In Docker deployments, install the `kvr` binary in the container image and ensure it is on `PATH`. The workflow writes intermediate files to `.workforce/` in the repository root (one level above `web/`); the container must have write access to that directory.

### Orphan cleanup

On startup, `web/src/instrumentation.ts` sweeps `.workforce/` and sends `SIGTERM` to processes whose UUID v4 run directories are older than 30 minutes. This catches KVR subprocesses orphaned by a Node.js process restart. MCP server run directories (`mcp-navigator-*`) are explicitly excluded from this sweep.

---

## Running tests

```bash
cd web

# Unit + API route + integration tests (Vitest)
npm test

# Individual suites
npm run test:unit
npm run test:api
npm run test:integration

# E2E (Playwright — requires a running Next.js dev server + mock-kvr on PATH)
npm run test:e2e
```

The E2E suite uses a `mock-kvr` fixture script (`tests/e2e/fixtures/mock-kvr`) that emits pre-defined `[PHASE_STREAM]` events and writes fixture `.md` files, avoiding real LLM calls in CI.
