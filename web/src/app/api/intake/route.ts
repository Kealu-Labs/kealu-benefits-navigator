//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { sessionStore, SESSION_TTL_MS } from '@/lib/session-store';
import {
  parseUserMessage,
  isTier1Complete,
  getNextQuestion,
  isIdempotentSubmission,
} from '@/lib/intake-flow';
import { randomUUID } from 'crypto';

const COOKIE_NAME = 'session';
const COOKIE_MAX_AGE_SEC = SESSION_TTL_MS / 1000;

/**
 * POST /api/intake
 * Accepts a free-text user message, extracts structured vars, and returns
 * the next intake question or signals readiness to start the workflow.
 *
 * Response body:
 * - `{ type: 'question', field: { key, prompt, label, rationale, tier } }` — more info needed
 * - `{ type: 'ready' }` — all required fields collected
 *
 * PII vars are NEVER echoed in the response body.
 */
export async function POST(req: Request): Promise<Response> {
  const cookieStore = await cookies();

  // Resolve session
  const rawCookie = req.headers.get('cookie') ?? '';
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = sessionCookieMatch?.[1] ?? cookieStore.get(COOKIE_NAME)?.value;

  let session = cookieValue ? sessionStore.get(cookieValue) : null;
  let newSessionId: string | undefined;

  if (!session) {
    newSessionId = randomUUID();
    session = sessionStore.create(newSessionId);
    cookieStore.set(COOKIE_NAME, newSessionId, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: COOKIE_MAX_AGE_SEC,
      path: '/',
    });
  }

  const sessionId = session.sessionId;

  // Parse request body
  let message = '';
  try {
    const body = await req.json() as { message?: string };
    message = String(body.message ?? '').trim();
  } catch {
    // Empty or malformed body — treat as empty message
  }

  // Idempotency: identical message re-POST (e.g., browser back button) is a no-op
  // so that history does not accumulate duplicate entries.
  if (!isIdempotentSubmission(session.messages, message)) {
    // Append user message to history
    sessionStore.update(sessionId, {
      messages: [
        ...session.messages,
        { role: 'user', content: message, timestamp: Date.now() },
      ],
    });

    // Reload updated session after each mutation — SessionStore returns a new object
    session = sessionStore.get(sessionId)!;

    // Skip signal: exact "skip" string only. The "Skip remaining questions" button in
    // ChatInterface sends the literal string "skip". Checking startsWith would risk
    // false positives on messages that begin with the word "skip" inadvertently.
    if (message.toLowerCase() === 'skip') {
      sessionStore.update(sessionId, { skipIntake: true });
      session = sessionStore.get(sessionId)!;
    } else {
      // Extract structured vars from free-text message (ZIP, income, household profile)
      const updatedVars = parseUserMessage(message, session.vars);
      sessionStore.update(sessionId, { vars: updatedVars });
      session = sessionStore.get(sessionId)!;
    }
  }

  // Determine the next unanswered question.
  // Returns null when all required Tier 1 fields are present OR when skipIntake is set,
  // indicating the client should transition to the workflow start flow.
  const nextField = getNextQuestion(session.vars, session.currentTier, session.skipIntake);

  let body: object;
  if (nextField === null) {
    body = { type: 'ready' };
  } else {
    body = {
      type: 'question',
      field: {
        key: nextField.key,
        label: nextField.label,
        rationale: nextField.rationale,
        prompt: nextField.prompt,
        tier: nextField.tier,
      },
    };
  }

  const res = NextResponse.json(body);

  if (newSessionId) {
    res.headers.set(
      'Set-Cookie',
      `${COOKIE_NAME}=${newSessionId}; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_SEC}; Path=/`,
    );
  }

  return res;
}
