//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { cookies } from 'next/headers';
import { addController, removeController } from '@/lib/kvr-runner';

// Disable Next.js route handler timeout for the SSE streaming endpoint.
// KVR workflows can run for up to 30 minutes; the default platform timeout
// (e.g. 30s on Vercel Edge) would terminate the SSE connection mid-run.
export const maxDuration = 0;

const COOKIE_NAME = 'session';
const KEEPALIVE_INTERVAL_MS = 15_000;

/**
 * GET /api/workflow/[runId]/stream
 *
 * Server-Sent Events endpoint for streaming phase events.
 * Authorizes via session cookie: session.runId must match path runId.
 *
 * session-store is imported dynamically so that vi.mock() factories
 * in tests are not triggered at module-load time (avoids TDZ errors
 * when mock factories reference consts declared after hoisted imports).
 */
export async function GET(

  req: Request,

  { params }: { params: Promise<{ runId: string }> },

): Promise<Response> {
  const { runId } = await params;

  const cookieStore = await cookies();

  // Dynamic import: defers session-store resolution to handler invocation time
  const { sessionStore } = await import('@/lib/session-store');

  // Authorize: session must exist and own this runId
  const rawCookie = req.headers.get('cookie') ?? '';
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = sessionCookieMatch?.[1] ?? cookieStore.get(COOKIE_NAME)?.value;
  const session = cookieValue ? sessionStore.get(cookieValue) : null;

  console.log({
    rawCookie,
    cookieValue,
    hasSession: Boolean(session),
    requestedRunId: runId,
    sessionRunId: session?.runId,
  });
  
  if (!session || session.runId !== runId) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      ctrl = controller;
      const encoder = new TextEncoder();

      // Send initial keepalive comment (prevents proxy buffering)
      controller.enqueue(encoder.encode(': keepalive\n\n'));

      // Register controller to receive broadcast events from kvr-runner
      addController(runId, controller);

      // Periodic keepalive ping
      pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          // Controller closed
        }
      }, KEEPALIVE_INTERVAL_MS);
    },
    cancel() {
      if (pingTimer !== undefined) {
        clearInterval(pingTimer);
        pingTimer = undefined;
      }
      if (ctrl !== undefined) {
        removeController(runId, ctrl);
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Correlation-Id': runId,
    },
  });
}
