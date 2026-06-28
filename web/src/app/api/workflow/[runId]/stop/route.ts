//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { NextResponse } from 'next/server';

/**
 * POST /api/workflow/[runId]/stop
 *
 * Stops an in-progress KVR workflow run for the current session.
 * Terminates the child process, clears the run from the session, and returns 200.
 * Idempotent — stopping an already-finished run is a no-op success.
 *
 * Authorizes via session cookie: session.runId must match path runId.
 *
 * Both session-store and kvr-runner are imported dynamically so that vi.mock()
 * factories in tests are not triggered at module-load time (mirrors the report
 * and stream routes).
 *
 * Response codes:
 * - 200 `{ ok: true }` — run stopped (or already finished)
 * - 403 — session does not own this runId
 */
export async function POST(
  req: Request,
  { params }: { params: { runId: string } },
): Promise<Response> {
  const { runId } = params;

  // Dynamic imports: defer module resolution to handler invocation time
  const { sessionStore } = await import('@/lib/session-store');
  const { terminateRun } = await import('@/lib/kvr-runner');

  // Authorize: read session exclusively from the request Cookie header to preserve
  // the per-request auth boundary (mirrors the report route).
  const rawCookie = req.headers.get('cookie') ?? '';
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = sessionCookieMatch?.[1];
  const session = cookieValue ? sessionStore.get(cookieValue) : null;

  if (!session || session.runId !== runId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Terminate the child process (no-op if already gone) and detach the run from
  // the session so a subsequent /api/workflow/start spawns a fresh run.
  terminateRun(runId);
  sessionStore.update(session.sessionId, { runId: undefined, runStatus: 'idle' });

  return NextResponse.json({ ok: true });
}
