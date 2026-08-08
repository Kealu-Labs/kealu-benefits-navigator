# Changelog

All notable changes to the Benefit & Insurance Navigator are documented here.

---

## [Unreleased]

### Added

- **Web app** (`web/`) — Next.js 15 + TypeScript browser interface for the benefit navigator. Provides a chat-style guided intake conversation, real-time KVR workflow progress via Server-Sent Events, and a fully rendered benefits report — no user account required.
  - Anonymous sessions via `httpOnly SameSite=Strict` cookie with 2-hour TTL
  - Tiered intake conversation mirrors the MCP server's three-tier profile collection (ZIP → income → household → coverage/medications/providers/budget → health needs)
  - SSE stream relays `[PHASE_STREAM]` events from `kvr` to the browser; phases 1 & 2 shown as parallel; feedback-loop reruns shown as "Re-checking" indicator
  - Report assembled from five phase `.md` files, cached in session, then run directory deleted immediately (PII cleanup)
  - Health endpoint (`GET /api/health`) reports `kvr` binary status and `CMS_API_KEY` presence
  - 212 TypeScript tests across unit, API route, integration, and Playwright E2E layers
  - See [`web/README.md`](web/README.md) for setup and deployment guidance

### Changed

- `README.md` — updated architecture tree, prerequisites, setup, and usage sections to cover the web app alongside the existing MCP/Antigravity interface
- `ARCHITECTURE.md` — updated system overview diagram and key boundaries table to show the web app as an entry point; added ADR-008 documenting the Next.js web interface decision
