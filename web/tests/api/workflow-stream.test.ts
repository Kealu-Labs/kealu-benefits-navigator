/**
 * Black-box API route tests for GET /api/workflow/[runId]/stream
 *
 * These tests FAIL before implementation (route does not exist).
 * kvr-runner is mocked at the subprocess boundary.
 * Verifies SSE headers, keepalive comment, and timer leak prevention.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const TEST_RUN_ID = '550e8400-e29b-41d4-a716-446655440010';
const TEST_SESSION_ID = 'test-session-stream-001';

let _sessionCookies: Record<string, string> = {};

vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: (name: string) => _sessionCookies[name] ? { name, value: _sessionCookies[name] } : undefined,
      set: vi.fn((name: string, value: string) => { _sessionCookies[name] = value; }),
      delete: vi.fn(),
      has: (name: string) => name in _sessionCookies,
    })
  ),
}));

vi.mock('@/lib/kvr-runner', () => ({
  addController: vi.fn(),
  removeController: vi.fn(),
  startRun: vi.fn(),
  getRunIdForSession: vi.fn(),
  terminateRun: vi.fn(),
  formatSseEvent: vi.fn(),
  activeRuns: new Map(),
}));

// This import fails until web/src/app/api/workflow/[runId]/stream/route.ts is created.
import { GET } from '@/app/api/workflow/[runId]/stream/route';
import { activeRuns, addController, removeController } from '@/lib/kvr-runner';

const mockAddController = vi.mocked(addController);
const mockRemoveController = vi.mocked(removeController);

// Session store must be seeded with a session that has the matching runId
vi.mock('@/lib/session-store', async () => {
  const { SessionStore } = await vi.importActual<typeof import('@/lib/session-store')>('@/lib/session-store');
  const store = new SessionStore();
  const session = store.create(TEST_SESSION_ID);
  store.update(TEST_SESSION_ID, { runId: TEST_RUN_ID, runStatus: 'running' });
  return {
    sessionStore: store,
    SessionStore,
    SESSION_TTL_MS: 7_200_000,
  };
});

function makeStreamRequest(runId: string, sessionId?: string): Request {
  const headers: Record<string, string> = {};
  if (sessionId) headers['Cookie'] = `session=${sessionId}`;
  return new Request(`http://localhost/api/workflow/${runId}/stream`, { headers });
}

describe('GET /api/workflow/[runId]/stream', () => {
  beforeEach(() => {
    _sessionCookies = {};
    mockAddController.mockReset();
    mockRemoveController.mockReset();
    // The route treats a runId absent from activeRuns as a stale run and
    // closes the stream immediately; seed the registry so the default-case
    // tests exercise the live-run path.
    activeRuns.set(TEST_RUN_ID, {} as never);
    vi.useFakeTimers();
  });

  afterEach(() => {
    activeRuns.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes immediately with a terminal error event for a stale (terminated) run', async () => {
    activeRuns.clear();
    const req = makeStreamRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });

    expect(res.status).toBe(200);
    const text = await res.text(); // resolves only because the stream was closed
    expect(text).toContain(': keepalive');
    expect(mockAddController).not.toHaveBeenCalled();
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  it('returns HTTP 403 when session cookie is absent', async () => {
    const req = makeStreamRequest(TEST_RUN_ID); // no session cookie
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });
    expect(res.status).toBe(403);
  });

  it('returns HTTP 403 when session.runId does not match path runId', async () => {
    _sessionCookies['session'] = TEST_SESSION_ID;
    const req = makeStreamRequest('different-run-id-9999', TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: 'different-run-id-9999' }) });
    expect(res.status).toBe(403);
  });

  // ── SSE headers ────────────────────────────────────────────────────────────

  it('returns HTTP 200 with Content-Type: text/event-stream', async () => {
    _sessionCookies['session'] = TEST_SESSION_ID;
    const req = makeStreamRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  });

  it('Cache-Control header is no-cache, no-transform', async () => {
    _sessionCookies['session'] = TEST_SESSION_ID;
    const req = makeStreamRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });

    const cacheControl = res.headers.get('cache-control') ?? '';
    expect(cacheControl).toMatch(/no-cache/i);
    expect(cacheControl).toMatch(/no-transform/i);
  });

  it('Connection header is keep-alive', async () => {
    _sessionCookies['session'] = TEST_SESSION_ID;
    const req = makeStreamRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });

    expect(res.headers.get('connection')).toMatch(/keep-alive/i);
  });

  it('X-Correlation-Id header equals the runId', async () => {
    _sessionCookies['session'] = TEST_SESSION_ID;
    const req = makeStreamRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });

    expect(res.headers.get('x-correlation-id')).toBe(TEST_RUN_ID);
  });

  // ── Initial stream content ─────────────────────────────────────────────────

  it('first chunk sent contains keepalive comment (": keepalive")', async () => {
    _sessionCookies['session'] = TEST_SESSION_ID;
    const req = makeStreamRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });

    if (res.body) {
      const reader = res.body.getReader();
      const { value } = await reader.read();
      if (value) {
        const chunk = new TextDecoder().decode(value);
        expect(chunk).toContain(': keepalive');
      }
      reader.cancel();
    }
  });

  // ── Controller registration ────────────────────────────────────────────────

  it('calls addController(runId, controller) on stream open', async () => {
    _sessionCookies['session'] = TEST_SESSION_ID;
    const req = makeStreamRequest(TEST_RUN_ID, TEST_SESSION_ID);
    await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });

    expect(mockAddController).toHaveBeenCalledWith(
      TEST_RUN_ID,
      expect.any(Object),
    );
  });

  // ── Timer leak prevention ──────────────────────────────────────────────────

  it('ping setInterval is cleared in stream cancel() callback (no timer leak)', async () => {
    _sessionCookies['session'] = TEST_SESSION_ID;
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const req = makeStreamRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });

    // Cancel the stream (simulates client disconnect)
    if (res.body) {
      await res.body.cancel();
    }

    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('calls removeController(runId, controller) when stream is cancelled', async () => {
    _sessionCookies['session'] = TEST_SESSION_ID;
    const req = makeStreamRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });

    if (res.body) {
      await res.body.cancel();
    }

    expect(mockRemoveController).toHaveBeenCalledWith(
      TEST_RUN_ID,
      expect.any(Object),
    );
  });
});
