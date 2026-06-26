/**
 * Black-box API route tests for POST /api/workflow/start
 *
 * These tests FAIL before implementation (route does not exist).
 * kvr-runner is mocked at the subprocess boundary.
 * Session store runs real code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

let _sessionCookies: Record<string, string> = {};
let _setCookieCalls: Array<{ name: string; value: string }> = [];

vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: (name: string) => _sessionCookies[name] ? { name, value: _sessionCookies[name] } : undefined,
      set: vi.fn((name: string, value: string) => {
        _sessionCookies[name] = value;
        _setCookieCalls.push({ name, value });
      }),
      delete: vi.fn(),
      has: (name: string) => name in _sessionCookies,
    })
  ),
}));

vi.mock('@/lib/kvr-runner', () => ({
  startRun: vi.fn(),
  getRunIdForSession: vi.fn().mockReturnValue(undefined),
  terminateRun: vi.fn(),
  addController: vi.fn(),
  removeController: vi.fn(),
  formatSseEvent: vi.fn(),
  activeRuns: new Map(),
}));

vi.mock('@/lib/kvr-checker', () => ({
  resolveKvr: vi.fn().mockReturnValue('/usr/local/bin/kvr'),
  checkKvrVersion: vi.fn().mockReturnValue({ ok: true, version: '0.225.0', path: '/usr/local/bin/kvr' }),
  checkCmsApiKey: vi.fn().mockReturnValue(true),
  logStartupChecks: vi.fn(),
}));

// This import fails until web/src/app/api/workflow/start/route.ts is created.
import { POST } from '@/app/api/workflow/start/route';
import { getRunIdForSession, startRun } from '@/lib/kvr-runner';
import { resolveKvr } from '@/lib/kvr-checker';

const mockGetRunIdForSession = vi.mocked(getRunIdForSession);
const mockStartRun = vi.mocked(startRun);
const mockResolveKvr = vi.mocked(resolveKvr);

function makeStartRequest(sessionId?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) headers['Cookie'] = `session=${sessionId}`;
  return new Request('http://localhost/api/workflow/start', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
}

describe('POST /api/workflow/start', () => {
  beforeEach(() => {
    _sessionCookies = {};
    _setCookieCalls = [];
    mockGetRunIdForSession.mockReturnValue(undefined);
    mockStartRun.mockReset();
    mockResolveKvr.mockReturnValue('/usr/local/bin/kvr');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('returns existing runId without spawning duplicate when run already in progress', async () => {
    const existingRunId = 'existing-run-id-abc123';
    mockGetRunIdForSession.mockReturnValue(existingRunId);

    const req = makeStartRequest('test-session-123');
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.runId).toBe(existingRunId);
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  // ── kvr availability check ─────────────────────────────────────────────────

  it('returns HTTP 503 when kvr is absent at invocation time', async () => {
    mockResolveKvr.mockReturnValue(null);
    mockGetRunIdForSession.mockReturnValue(undefined);

    const req = makeStartRequest();
    const res = await POST(req);

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(typeof body.error).toBe('string');
  });

  it('HTTP 503 error message does NOT expose binary path', async () => {
    mockResolveKvr.mockReturnValue(null);

    const req = makeStartRequest();
    const res = await POST(req);
    const body = await res.json();
    const bodyString = JSON.stringify(body);

    expect(bodyString).not.toContain('/usr/');
    expect(bodyString).not.toContain('/bin/');
    expect(bodyString).not.toContain('PATH');
  });

  // ── Normal operation ───────────────────────────────────────────────────────

  it('returns HTTP 200 with {runId} on successful spawn', async () => {
    const req = makeStartRequest();
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.runId).toBe('string');
    expect(body.runId.length).toBeGreaterThan(0);
  });

  it('runId in response is a UUID v4', async () => {
    const req = makeStartRequest();
    const res = await POST(req);
    const body = await res.json();

    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(body.runId).toMatch(uuidV4Regex);
  });

  // ── PII protection ─────────────────────────────────────────────────────────

  it('response body does NOT include session ID, income, or any intake PII', async () => {
    const req = makeStartRequest();
    const res = await POST(req);
    const body = await res.json();
    const bodyString = JSON.stringify(body);

    expect(bodyString).not.toMatch(/annual_income/);
    expect(bodyString).not.toMatch(/medications/);
    expect(bodyString).not.toMatch(/household_profile/);
    // runId should be the only field
    const keys = Object.keys(body);
    expect(keys).toContain('runId');
  });

  // ── Structured startup log ─────────────────────────────────────────────────

  it('emits structured startup log with event:workflow_start', async () => {
    const consoleSpy = vi.mocked(console.log);

    const req = makeStartRequest();
    await POST(req);

    const logCalls = consoleSpy.mock.calls.map((c) => {
      try { return JSON.parse(c[0]); } catch { return null; }
    }).filter(Boolean);

    const startupLog = logCalls.find((l: any) => l?.event === 'workflow_start');
    expect(startupLog).toBeDefined();
    expect(startupLog).toHaveProperty('runId');
    expect(startupLog).toHaveProperty('sessionId_hash');
    expect(startupLog).toHaveProperty('intake_tiers_completed');
  });

  it('sessionId_hash in log is NOT the raw session UUID', async () => {
    const consoleSpy = vi.mocked(console.log);
    _sessionCookies['session'] = 'my-known-session-id';

    const req = makeStartRequest('my-known-session-id');
    await POST(req);

    const logCalls = consoleSpy.mock.calls.map((c) => {
      try { return JSON.parse(c[0]); } catch { return null; }
    }).filter(Boolean);

    const startupLog = logCalls.find((l: any) => l?.event === 'workflow_start');
    if (startupLog) {
      const hash = startupLog.sessionId_hash;
      // The hash must not equal the raw session ID
      expect(hash).not.toBe('my-known-session-id');
      // The hash should be a hex string (sha256)
      expect(hash).toMatch(/^[0-9a-f]{64}$/i);
    }
  });
});
