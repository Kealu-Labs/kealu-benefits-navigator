// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
/**
 * Black-box API route tests for POST /api/workflow/start
 *
 * kvr-runner is mocked at the subprocess boundary.
 * Session store runs real code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

let _sessionCookies: Record<string, string> = {};

vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: (name: string) => _sessionCookies[name] ? { name, value: _sessionCookies[name] } : undefined,
      set: vi.fn((name: string, value: string) => {
        _sessionCookies[name] = value;
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
import { sessionStore } from '@/lib/session-store';

const mockGetRunIdForSession = vi.mocked(getRunIdForSession);
const mockStartRun = vi.mocked(startRun);
const mockResolveKvr = vi.mocked(resolveKvr);

/** Session IDs created during the current test — cleaned up in afterEach. */
const _createdSessionIds: string[] = [];

/**
 * Create a request to POST /api/workflow/start.
 * When sessionId is provided, also primes the next/headers cookies() mock so the
 * route's `cookieStore.get('session')` call returns the expected value (the
 * Request Cookie header is ignored by the next/headers mock which reads
 * `_sessionCookies` directly).
 */
function makeStartRequest(sessionId?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) {
    headers['Cookie'] = `session=${sessionId}`;
    _sessionCookies['session'] = sessionId;
  }
  return new Request('http://localhost/api/workflow/start', {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
}

/**
 * Seed a session with complete Tier 1 vars so the isTier1Complete guard passes.
 * Tracks the session ID for afterEach cleanup.
 */
function seedCompleteSession(sessionId: string): void {
  _sessionCookies['session'] = sessionId;
  sessionStore.create(sessionId);
  sessionStore.update(sessionId, {
    vars: { zip_code: '77001', annual_income: '42000', household_profile: 'Single adult' },
  });
  _createdSessionIds.push(sessionId);
}

describe('POST /api/workflow/start', () => {
  beforeEach(() => {
    _sessionCookies = {};
    mockGetRunIdForSession.mockReturnValue(undefined);
    mockStartRun.mockReset();
    mockResolveKvr.mockReturnValue('/usr/local/bin/kvr');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up any sessions created during the test to prevent state leakage
    for (const id of _createdSessionIds) {
      sessionStore.delete(id);
    }
    _createdSessionIds.length = 0;
  });

  // ── CSRF Origin/Host check ─────────────────────────────────────────────────

  it('returns HTTP 403 when Origin does not match Host', async () => {
    // Origin from a different domain must be rejected regardless of session state.
    const req = new Request('http://localhost/api/workflow/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.com',
        Host: 'localhost',
      },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/csrf/i);
  });

  it('returns HTTP 403 for subdomain-suffix bypass attempt (https://localhost.evil.com with Host: localhost)', async () => {
    // Ensures strict equality is used: startsWith() would allow this to pass,
    // because 'https://localhost.evil.com'.startsWith('https://localhost') is true.
    const req = new Request('http://localhost/api/workflow/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://localhost.evil.com',
        Host: 'localhost',
      },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/csrf/i);
  });

  it('allows request when Origin exactly matches Host (same-origin)', async () => {
    // A legitimate browser request from the same origin must be allowed through.
    const sessionId = `csrf-same-origin-test-${Date.now()}`;
    seedCompleteSession(sessionId);
    const req = new Request('http://localhost/api/workflow/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
        Host: 'localhost',
        Cookie: `session=${sessionId}`,
      },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    // Should reach the workflow-start logic, not be blocked at the CSRF gate.
    expect(res.status).not.toBe(403);
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

  // ── Tier 1 completeness guard ──────────────────────────────────────────────

  it('returns HTTP 422 when Tier 1 intake is incomplete', async () => {
    const sessionId = `incomplete-intake-test-${Date.now()}`;
    _sessionCookies['session'] = sessionId;
    sessionStore.create(sessionId);
    // Only partial vars — missing annual_income and household_profile
    sessionStore.update(sessionId, { vars: { zip_code: '77001' } });
    _createdSessionIds.push(sessionId);

    const req = makeStartRequest(sessionId);
    const res = await POST(req);

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  // ── Normal operation ───────────────────────────────────────────────────────

  it('returns HTTP 200 with {runId} on successful spawn', async () => {
    const sessionId = `spawn-test-${Date.now()}`;
    seedCompleteSession(sessionId);

    const req = makeStartRequest(sessionId);
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.runId).toBe('string');
    expect(body.runId.length).toBeGreaterThan(0);
  });

  it('runId in response is a UUID v4', async () => {
    const sessionId = `uuid-test-${Date.now()}`;
    seedCompleteSession(sessionId);

    const req = makeStartRequest(sessionId);
    const res = await POST(req);
    const body = await res.json();

    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(body.runId).toMatch(uuidV4Regex);
  });

  // ── PII protection ─────────────────────────────────────────────────────────

  it('response body does NOT include session ID, income, or any intake PII', async () => {
    const sessionId = `pii-test-${Date.now()}`;
    seedCompleteSession(sessionId);

    const req = makeStartRequest(sessionId);
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
    const sessionId = `log-test-${Date.now()}`;
    seedCompleteSession(sessionId);

    const req = makeStartRequest(sessionId);
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

  it('sessionId_hash in log is NOT the raw session UUID and equals the SHA-256 of the session ID', async () => {
    const consoleSpy = vi.mocked(console.log);
    const sessionId = 'my-known-session-id';
    seedCompleteSession(sessionId);
    // makeStartRequest primes _sessionCookies when sessionId is supplied
    const req = makeStartRequest(sessionId);
    await POST(req);

    const logCalls = consoleSpy.mock.calls.map((c) => {
      try { return JSON.parse(c[0]); } catch { return null; }
    }).filter(Boolean);

    const startupLog = logCalls.find((l: any) => l?.event === 'workflow_start');
    expect(startupLog).toBeDefined();
    if (startupLog) {
      const hash = startupLog.sessionId_hash;
      // The hash must not equal the raw session ID
      expect(hash).not.toBe(sessionId);
      // The hash should be a hex string (sha256)
      expect(hash).toMatch(/^[0-9a-f]{64}$/i);
      // The hash must be the exact SHA-256 of the known session ID
      const expectedHash = createHash('sha256').update(sessionId).digest('hex');
      expect(hash).toBe(expectedHash);
    }
  });

  // ── household_profile enrichment ───────────────────────────────────────────

  it('income-embedding contract: startRun is called with household_profile containing "Income: $<amount>/year"', async () => {
    const sessionId = `income-embed-test-${Date.now()}`;
    _sessionCookies['session'] = sessionId;
    sessionStore.create(sessionId);
    sessionStore.update(sessionId, {
      vars: { zip_code: '77001', annual_income: '50000', household_profile: 'Single adult' },
    });
    _createdSessionIds.push(sessionId);

    const req = makeStartRequest(sessionId);
    await POST(req);

    expect(mockStartRun).toHaveBeenCalled();
    const passedVars = mockStartRun.mock.calls[0][2] as Record<string, string>;
    expect(passedVars.household_profile).toContain('Income: $50,000/year');
  });

  it('round-trip: startRun receives fully enriched pipe-delimited household_profile with ZIP, income, and composition', async () => {
    const sessionId = `round-trip-test-${Date.now()}`;
    _sessionCookies['session'] = sessionId;
    sessionStore.create(sessionId);
    sessionStore.update(sessionId, {
      vars: { zip_code: '77001', annual_income: '50000', household_profile: 'Single adult' },
    });
    _createdSessionIds.push(sessionId);

    const req = makeStartRequest(sessionId);
    await POST(req);

    expect(mockStartRun).toHaveBeenCalled();
    const passedVars = mockStartRun.mock.calls[0][2] as Record<string, string>;
    expect(passedVars.household_profile).toBe('ZIP: 77001 | Income: $50,000/year | Single adult');
  });

  it('double-enrichment guard: already-enriched household_profile does not produce duplicate ZIP/Income prefixes', async () => {
    const sessionId = `double-enrich-test-${Date.now()}`;
    _sessionCookies['session'] = sessionId;
    sessionStore.create(sessionId);
    sessionStore.update(sessionId, {
      vars: {
        zip_code: '77001',
        annual_income: '50000',
        // Simulate a household_profile that was previously set to a buildHouseholdProfile output
        household_profile: 'ZIP: 77001 | Income: $50,000/year | Single adult',
      },
    });
    _createdSessionIds.push(sessionId);

    const req = makeStartRequest(sessionId);
    await POST(req);

    expect(mockStartRun).toHaveBeenCalled();
    const passedVars = mockStartRun.mock.calls[0][2] as Record<string, string>;
    const profile = passedVars.household_profile;
    const zipCount = (profile.match(/ZIP:/g) ?? []).length;
    const incomeCount = (profile.match(/Income:/g) ?? []).length;
    expect(zipCount).toBe(1);
    expect(incomeCount).toBe(1);
  });
});
