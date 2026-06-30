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
import { buildHouseholdProfile, isTier1Complete } from '@/lib/intake-flow';

const COOKIE_NAME = 'session';

/**
 * POST /api/workflow/start
 *
 * Starts a KVR workflow run for the current session.
 * Idempotent — if a run is already in progress for this session, returns the existing runId.
 *
 * Before launching KVR, raw session vars are enriched: `household_profile` is replaced with a
 * pipe-delimited summary ("ZIP: 77001 | Income: $50,000/year | …") while `annual_income` is kept
 * as a separate key alongside it. This intentional belt-and-suspenders approach lets workflow
 * agents read whichever key suits them without losing either value.
 *
 * Returns:
 * - 200 `{ runId }` on success or existing run
 * - 422 `{ error }` when Tier 1 intake is incomplete
 * - 503 `{ error }` when kvr is unavailable
 */
export async function POST(req: Request): Promise<Response> {
  // Minimal CSRF mitigation: reject cross-origin POST requests when the Origin
  // header is present and does not match the request Host. This guards against
  // drive-by form submissions from other origins while leaving server-to-server
  // and curl invocations (no Origin header) unaffected.
  //
  // Strict equality is required — startsWith() would allow subdomain-suffix bypass:
  // `https://localhost.evil.com`.startsWith(`https://localhost`) evaluates to true.
  // The dual http/https allowedOrigins list already handles port variations.
  const origin = req.headers.get('Origin');
  const host = req.headers.get('Host');
  if (origin && host) {
    const allowedOrigins = [`https://${host}`, `http://${host}`];
    const isSameOrigin = allowedOrigins.some((o) => origin === o);
    if (!isSameOrigin) {
      return NextResponse.json({ error: 'CSRF check failed' }, { status: 403 });
    }
  }

  const cookieStore = await cookies();

  // Resolve session: use the Next.js cookie helper as the primary source; fall back to a
  // fresh UUID when no session cookie exists (first visit or cookie expired).
  const sessionId = cookieStore.get(COOKIE_NAME)?.value ?? randomUUID();
  const session = sessionStore.get(sessionId) ?? sessionStore.create(sessionId);

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

  const rawVars = session?.vars ?? {};

  // Require Tier 1 intake to be complete before spawning the workflow.
  // Without ZIP, income, and household composition the workflow agents cannot
  // perform FPL calculations or program-eligibility lookups.
  if (!isTier1Complete(rawVars)) {
    return NextResponse.json(
      { error: 'Intake incomplete. Please answer the required questions before starting.' },
      { status: 422 },
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
      idempotent: false,
    }),
  );

  // Enrich household_profile with ZIP and income context before passing to KVR.
  // buildHouseholdProfile() produces a pipe-delimited string:
  //   "ZIP: 77001 | Income: $50,000/year | <user household text>"
  // This replaces the raw user-text value so workflow agents have full context
  // in a single variable rather than needing to reference zip_code/annual_income
  // separately.
  //
  // DO NOT LOG enrichedVars — it aggregates ZIP + income + household description
  // into a single string and must never appear in logs, error reporters, or traces.
  //
  // KVR parses --var arguments by splitting on the first `=` character only
  // (e.g. `--var key=value=extra` is parsed as key="value=extra"). Values that
  // legitimately contain `=` are therefore safe; no encoding is needed.
  //
  // No-persistence guarantee: KVR processes enrichedVars in-memory only; no disk
  // writes of var values occur. Vars are passed as --var CLI flags to the KVR
  // subprocess and never written to temp files, databases, or any other storage.
  const enrichedProfile = buildHouseholdProfile(rawVars);
  const enrichedVars = {
    ...rawVars,
    // Only override household_profile when we have a non-null enriched value.
    // When buildHouseholdProfile returns null (empty vars), preserve rawVars as-is.
    ...(enrichedProfile !== null ? { household_profile: enrichedProfile } : {}),
  };

  // Start the run
  startRun(runId, sessionId, enrichedVars);

  // Update session with runId
  sessionStore.update(sessionId, { runId, runStatus: 'running' });

  const response = NextResponse.json({ runId });

  // Use COOKIE_SECURE env var for explicit secure-flag control across all
  // deployment environments (staging, preview, production). Falling back to
  // NODE_ENV=production alone risks transmitting the session cookie over HTTP
  // in non-production deployed environments where NODE_ENV is not set to 'production'.
  const secureCookie =
    process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

  response.cookies.set(COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 2,
    secure: secureCookie,
  });

  return response;
}
