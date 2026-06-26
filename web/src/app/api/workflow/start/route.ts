//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { randomUUID, createHash } from 'crypto';
import { sessionStore } from '@/lib/session-store';
import { startRun, getRunIdForSession } from '@/lib/kvr-runner';
import { resolveKvr } from '@/lib/kvr-checker';

const COOKIE_NAME = 'session';

/**
 * POST /api/workflow/start
 *
 * Starts a KVR workflow run for the current session.
 * Idempotent — if a run is already in progress for this session, returns the existing runId.
 *
 * Returns:
 * - 200 `{ runId }` on success or existing run
 * - 503 `{ error }` when kvr is unavailable
 */
export async function POST(req: Request): Promise<Response> {
  const cookieStore = await cookies();

  // Resolve session
  const rawCookie = req.headers.get('cookie') ?? '';
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = sessionCookieMatch?.[1] ?? cookieStore.get(COOKIE_NAME)?.value;
  const session = cookieValue ? sessionStore.get(cookieValue) : null;
  // Fallback chain: prefer session.sessionId (populated), then raw cookie value (expired
  // session, valid cookie), then 'anonymous' (no cookie at all). The 'anonymous' fallback
  // allows the run to start but means session state will not be updated after spawn.
  const sessionId = session?.sessionId ?? cookieValue ?? 'anonymous';

  // Check for existing run (idempotency)
  const existingRunId = getRunIdForSession(sessionId);
  if (existingRunId) {
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'workflow_start',
        runId: existingRunId,
        sessionId_hash: createHash('sha256').update(sessionId).digest('hex'),
        intake_tiers_completed: session?.currentTier ?? 1,
        idempotent: true,
      }),
    );
    return NextResponse.json({ runId: existingRunId });
  }

  // Verify kvr availability
  const kvrPath = resolveKvr();
  if (!kvrPath) {
    return NextResponse.json(
      { error: 'Workflow engine unavailable. Please ensure kvr is installed.' },
      { status: 503 },
    );
  }

  const runId = randomUUID();

  // Log structured startup event (hash sessionId to avoid PII in logs)
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'workflow_start',
      runId,
      sessionId_hash: createHash('sha256').update(sessionId).digest('hex'),
      intake_tiers_completed: session?.currentTier ?? 1,
    }),
  );

  // Start the run
  startRun(runId, sessionId, session?.vars ?? {});

  // Update session with runId
  if (session) {
    sessionStore.update(sessionId, { runId, runStatus: 'running' });
  }

  return NextResponse.json({ runId });
}
