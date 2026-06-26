//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * GET /api/session
 *
 * Reads or creates the anonymous session. This route is the canonical
 * source of truth for whether a session exists and what intake tier the user
 * is on. It never returns 401/403 — a missing or expired cookie always results
 * in a fresh session + Set-Cookie header.
 *
 * Security note: PII fields (vars — income, medications, household composition)
 * are deliberately excluded from the response body. Only display-safe fields
 * (tier, messages, runId, runStatus) are returned.
 */

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionStore, SESSION_TTL_MS } from '@/lib/session-store';
import { randomUUID } from 'crypto';

const COOKIE_NAME = 'session';
const COOKIE_MAX_AGE_SEC = SESSION_TTL_MS / 1000; // 7200

/**
 * GET /api/session
 * Returns existing session state or creates a new session.
 * Never returns 401/403 — always creates a session if cookie is absent/expired.
 * PII vars are NOT included in the response body.
 */
export async function GET(req: Request): Promise<Response> {
  const cookieStore = await cookies();

  // Try to read existing session from cookie
  const rawCookie = req.headers.get('cookie') ?? '';
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = sessionCookieMatch?.[1] ?? cookieStore.get(COOKIE_NAME)?.value;

  let session = cookieValue ? sessionStore.get(cookieValue) : null;
  const exists = session !== null;

  let newSessionId: string | undefined;

  if (!session) {
    newSessionId = randomUUID();
    session = sessionStore.create(newSessionId);

    // Set cookie via next/headers
    cookieStore.set(COOKIE_NAME, newSessionId, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: COOKIE_MAX_AGE_SEC,
      path: '/',
    });
  }

  const body = {
    exists,
    currentTier: session.currentTier,
    messages: session.messages,
    runId: session.runId,
    runStatus: session.runStatus,
  };

  // Dual Set-Cookie: cookieStore.set() above handles the Next.js server-component
  // cookie jar (picked up by page.tsx on SSR), while the explicit response header
  // ensures the browser actually receives the cookie even in non-SSR contexts
  // (e.g., direct fetch calls from client components or tests).
  if (newSessionId) {
    const res = NextResponse.json(body);
    res.headers.set(
      'Set-Cookie',
      `${COOKIE_NAME}=${newSessionId}; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_SEC}; Path=/`,
    );
    return res;
  }

  return NextResponse.json(body);
}
