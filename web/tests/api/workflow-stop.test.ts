/**
 * Black-box API route tests for POST /api/workflow/[runId]/stop
 *
 * kvr-runner is mocked at the subprocess boundary (terminateRun).
 * Session store runs real code, seeded with a session that owns TEST_RUN_ID.
 *
 * Follows the tests/api/workflow-start.test.ts pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Declared via vi.hoisted so they are initialized before the hoisted vi.mock
// factories (which reference them) run.
const { TEST_RUN_ID, TEST_SESSION_ID } = vi.hoisted(() => ({
  TEST_RUN_ID: '550e8400-e29b-41d4-a716-446655440099',
  TEST_SESSION_ID: 'test-session-stop-001',
}));

// The stop route reads the session exclusively from the request Cookie header,
// so next/headers is not consulted — no cookies() mock is required.

vi.mock('@/lib/kvr-runner', () => ({
  terminateRun: vi.fn(),
  startRun: vi.fn(),
  getRunIdForSession: vi.fn(),
  addController: vi.fn(),
  removeController: vi.fn(),
  formatSseEvent: vi.fn(),
  activeRuns: new Map(),
}));

// Seed session store singleton with a session that owns TEST_RUN_ID.
vi.mock('@/lib/session-store', async () => {
  const { SessionStore } = await vi.importActual<typeof import('@/lib/session-store')>(
    '@/lib/session-store',
  );
  const store = new SessionStore();
  store.create(TEST_SESSION_ID);
  store.update(TEST_SESSION_ID, { runId: TEST_RUN_ID, runStatus: 'running' });
  return { sessionStore: store, SessionStore, SESSION_TTL_MS: 7_200_000 };
});

import { POST } from '@/app/api/workflow/[runId]/stop/route';
import { terminateRun } from '@/lib/kvr-runner';
import { sessionStore } from '@/lib/session-store';

const mockTerminateRun = vi.mocked(terminateRun);

function makeStopRequest(runId: string, sessionId?: string): Request {
  const headers: Record<string, string> = {};
  if (sessionId) headers['Cookie'] = `session=${sessionId}`;
  return new Request(`http://localhost/api/workflow/${runId}/stop`, {
    method: 'POST',
    headers,
  });
}

describe('POST /api/workflow/[runId]/stop', () => {
  beforeEach(() => {
    mockTerminateRun.mockReset();
    // Restore the seeded session to a fresh running state before each test.
    sessionStore.update(TEST_SESSION_ID, { runId: TEST_RUN_ID, runStatus: 'running' });
  });

  // ── Authorized stop ──────────────────────────────────────────────────────

  it('returns HTTP 200 when runId belongs to the current session', async () => {
    const req = makeStopRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await POST(req, { params: { runId: TEST_RUN_ID } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('calls terminateRun(runId)', async () => {
    const req = makeStopRequest(TEST_RUN_ID, TEST_SESSION_ID);
    await POST(req, { params: { runId: TEST_RUN_ID } });

    expect(mockTerminateRun).toHaveBeenCalledOnce();
    expect(mockTerminateRun).toHaveBeenCalledWith(TEST_RUN_ID);
  });

  it('clears session runId and runStatus after stopping', async () => {
    const req = makeStopRequest(TEST_RUN_ID, TEST_SESSION_ID);
    await POST(req, { params: { runId: TEST_RUN_ID } });

    const session = sessionStore.get(TEST_SESSION_ID);
    expect(session?.runId).toBeUndefined();
    expect(session?.runStatus).toBe('idle');
  });

  // ── Idempotency ──────────────────────────────────────────────────────────

  it('is idempotent: returns 200 even when no process is active (terminateRun is a no-op)', async () => {
    // terminateRun does nothing for an unknown/already-terminated run; the route
    // should still authorize on the session-owned runId and return success.
    const req = makeStopRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await POST(req, { params: { runId: TEST_RUN_ID } });

    expect(res.status).toBe(200);
    expect(mockTerminateRun).toHaveBeenCalledWith(TEST_RUN_ID);
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  it('returns HTTP 403 when path runId does not match session.runId', async () => {
    const req = makeStopRequest('different-run-id', TEST_SESSION_ID);
    const res = await POST(req, { params: { runId: 'different-run-id' } });

    expect(res.status).toBe(403);
    expect(mockTerminateRun).not.toHaveBeenCalled();
  });

  it('returns HTTP 403 when the session cookie is absent', async () => {
    const req = makeStopRequest(TEST_RUN_ID); // no cookie
    const res = await POST(req, { params: { runId: TEST_RUN_ID } });

    expect(res.status).toBe(403);
    expect(mockTerminateRun).not.toHaveBeenCalled();
  });

  it('returns HTTP 403 for an unknown session cookie and does not mutate state', async () => {
    const req = makeStopRequest(TEST_RUN_ID, 'nonexistent-session');
    const res = await POST(req, { params: { runId: TEST_RUN_ID } });

    expect(res.status).toBe(403);
    expect(mockTerminateRun).not.toHaveBeenCalled();
    // Owner session remains untouched.
    const session = sessionStore.get(TEST_SESSION_ID);
    expect(session?.runId).toBe(TEST_RUN_ID);
    expect(session?.runStatus).toBe('running');
  });
});
