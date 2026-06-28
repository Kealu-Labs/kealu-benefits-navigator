//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionStore } from '@/lib/session-store';

const COOKIE_NAME = 'session';

/**
 * Intake variables the user is allowed to review and edit before re-running the
 * analysis. Kept in sync with TIER_1_FIELDS + TIER_2_FIELDS in intake-flow.ts.
 */
const EDITABLE_KEYS = [
  'zip_code',
  'annual_income',
  'household_profile',
  'current_coverage',
  'medications',
  'providers',
  'premium_budget',
  'health_needs',
] as const;

/** Tier-1 keys required before a run can start. */
const REQUIRED_KEYS = ['zip_code', 'annual_income', 'household_profile'] as const;

/** Resolve the session from the request cookie, or null. */
async function resolveSession(req: Request) {
  const cookieStore = await cookies();
  const rawCookie = req.headers.get('cookie') ?? '';
  const match = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = match?.[1] ?? cookieStore.get(COOKIE_NAME)?.value;
  return cookieValue ? sessionStore.get(cookieValue) : null;
}

/**
 * GET /api/intake/vars
 *
 * Returns the current session's editable intake values so the client can render
 * an edit form. Unlike /api/intake, this endpoint DOES return the stored values —
 * it is the authenticated owner of the data retrieving their own input over the
 * httpOnly, SameSite=Strict session cookie.
 *
 * Response:
 * - 200 `{ vars: { <key>: string, ... } }`
 * - 403 — no valid session
 */
export async function GET(req: Request): Promise<Response> {
  const session = await resolveSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const vars: Record<string, string> = {};
  for (const key of EDITABLE_KEYS) {
    vars[key] = (session.vars as Record<string, string | undefined>)[key] ?? '';
  }

  return NextResponse.json({ vars });
}

/**
 * POST /api/intake/vars
 *
 * Updates the session's intake values from the edit form. Only EDITABLE_KEYS are
 * accepted; all other session vars are preserved. Tier-1 fields must be non-empty.
 *
 * Request body: `{ vars: { <key>: string, ... } }`
 *
 * Response:
 * - 200 `{ ok: true }`
 * - 400 `{ error, missing: string[] }` — a required field is empty
 * - 403 — no valid session
 */
export async function POST(req: Request): Promise<Response> {
  const session = await resolveSession(req);
  if (!session) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let incoming: Record<string, unknown> = {};
  try {
    const body = (await req.json()) as { vars?: Record<string, unknown> };
    incoming = body.vars ?? {};
  } catch {
    // Malformed body — treat as no changes
  }

  const patch: Record<string, string | undefined> = {
    ...(session.vars as Record<string, string | undefined>),
  };

  for (const key of EDITABLE_KEYS) {
    if (!(key in incoming)) continue;
    let value = String(incoming[key] ?? '').trim();
    // Normalize income to a bare number so it is passed cleanly to kvr --var.
    if (key === 'annual_income') {
      value = value.replace(/[^\d]/g, '');
    }
    patch[key] = value;
  }

  // Validate required Tier-1 fields are present.
  const missing = REQUIRED_KEYS.filter((key) => !patch[key] || patch[key]!.trim().length === 0);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: 'Please fill in all required fields before re-running.', missing },
      { status: 400 },
    );
  }

  sessionStore.update(session.sessionId, { vars: patch });

  return NextResponse.json({ ok: true });
}
