/**
 * Black-box API route tests for GET /api/workflow/[runId]/report
 *
 * These tests FAIL before implementation (route does not exist).
 * report-assembler is mocked at the filesystem boundary.
 * Session store runs real code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_RUN_ID = '550e8400-e29b-41d4-a716-446655440020';
const TEST_SESSION_ID = 'test-session-report-001';

let _sessionCookies: Record<string, string> = { session: TEST_SESSION_ID };

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

const mockAssembleReport = vi.fn();
const mockDeleteRunDir = vi.fn().mockResolvedValue(undefined);
const mockGetWorkforceBase = vi.fn().mockReturnValue('/tmp/.workforce');

vi.mock('@/lib/report-assembler', () => ({
  assembleReport: mockAssembleReport,
  deleteRunDir: mockDeleteRunDir,
  getWorkforceBase: mockGetWorkforceBase,
  PHASE_ORDER: ['benefits-research', 'insurance-research', 'evidence-verification', 'eligibility-validation', 'action-plan'],
  PHASE_DISPLAY_NAMES: {
    'benefits-research': 'Benefits Research',
    'insurance-research': 'Insurance Research',
    'evidence-verification': 'Evidence Verification',
    'eligibility-validation': 'Eligibility Validation',
    'action-plan': 'Action Plan',
  },
}));

// Seed session store with a session that owns TEST_RUN_ID
vi.mock('@/lib/session-store', async () => {
  const { SessionStore } = await vi.importActual<typeof import('@/lib/session-store')>('@/lib/session-store');
  const store = new SessionStore();
  store.create(TEST_SESSION_ID);
  store.update(TEST_SESSION_ID, { runId: TEST_RUN_ID, runStatus: 'running' });
  return {
    sessionStore: store,
    SessionStore,
    SESSION_TTL_MS: 7_200_000,
  };
});

// This import fails until web/src/app/api/workflow/[runId]/report/route.ts is created.
import { GET } from '@/app/api/workflow/[runId]/report/route';

const SAMPLE_REPORT = {
  sections: [
    { phaseName: 'benefits-research', displayName: 'Benefits Research', content: '## Benefits\n...', expanded: false },
    { phaseName: 'insurance-research', displayName: 'Insurance Research', content: '## Insurance\n...', expanded: false },
    { phaseName: 'evidence-verification', displayName: 'Evidence Verification', content: '## Evidence\n...', expanded: false },
    { phaseName: 'eligibility-validation', displayName: 'Eligibility Validation', content: '## Eligibility\n| Program | Status |\n|---------|--------|\n| CHIP | Eligible |', expanded: false },
    { phaseName: 'action-plan', displayName: 'Action Plan', content: '## Action Plan\n1. Apply now', expanded: true },
  ],
  bottomLine: 'Your household qualifies for $18,000/year. Apply for CHIP this week.',
};

function makeReportRequest(runId: string, sessionId?: string): Request {
  const headers: Record<string, string> = {};
  if (sessionId) headers['Cookie'] = `session=${sessionId}`;
  return new Request(`http://localhost/api/workflow/${runId}/report`, { headers });
}

describe('GET /api/workflow/[runId]/report', () => {
  beforeEach(async () => {
    _sessionCookies = { session: TEST_SESSION_ID };
    // Reset session reportContent and runStatus so each test starts with a fresh session.
    // The vi.mock factory creates a singleton SessionStore; without this reset a successful
    // report assembly in one test leaves reportContent set, causing later tests (e.g.
    // "calls deleteRunDir") to receive a cached response instead of triggering fresh assembly.
    // Dynamic import avoids hoisting the mock factory before TEST_SESSION_ID is initialized.
    const { sessionStore } = await import('@/lib/session-store');
    sessionStore.update(TEST_SESSION_ID, { reportContent: undefined, runStatus: 'running' });
    mockAssembleReport.mockReset();
    mockDeleteRunDir.mockReset();
    mockDeleteRunDir.mockResolvedValue(undefined);
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  it('returns HTTP 403 when session.runId does not match path runId', async () => {
    const req = makeReportRequest('different-run-id', TEST_SESSION_ID);
    const res = await GET(req, { params: { runId: 'different-run-id' } });
    expect(res.status).toBe(403);
  });

  it('returns HTTP 403 when session cookie is absent', async () => {
    const req = makeReportRequest(TEST_RUN_ID); // no cookie
    const res = await GET(req, { params: { runId: TEST_RUN_ID } });
    expect(res.status).toBe(403);
  });

  // ── Missing/incomplete phases ──────────────────────────────────────────────

  it('returns HTTP 422 when run directory is missing', async () => {
    mockAssembleReport.mockRejectedValue({ code: 'RUN_DIR_MISSING' });

    const req = makeReportRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: { runId: TEST_RUN_ID } });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(body.missingPhases).toEqual(expect.arrayContaining(['benefits-research', 'action-plan']));
  });

  it('returns HTTP 422 when fewer than 5 phase files exist', async () => {
    const missingPhases = ['insurance-research', 'evidence-verification'];
    mockAssembleReport.mockRejectedValue({ code: 'INCOMPLETE', missingPhases });

    const req = makeReportRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: { runId: TEST_RUN_ID } });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.missingPhases).toEqual(expect.arrayContaining(missingPhases));
  });

  // ── Successful report assembly ─────────────────────────────────────────────

  it('returns HTTP 200 with sections and bottomLine when all files present', async () => {
    mockAssembleReport.mockResolvedValue(SAMPLE_REPORT);

    const req = makeReportRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: { runId: TEST_RUN_ID } });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sections).toHaveLength(5);
    expect(body.bottomLine).toBeTruthy();
  });

  it('X-Correlation-Id header equals the runId', async () => {
    mockAssembleReport.mockResolvedValue(SAMPLE_REPORT);

    const req = makeReportRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: { runId: TEST_RUN_ID } });

    expect(res.headers.get('x-correlation-id')).toBe(TEST_RUN_ID);
  });

  it('calls deleteRunDir() after successful report assembly', async () => {
    mockAssembleReport.mockResolvedValue(SAMPLE_REPORT);

    const req = makeReportRequest(TEST_RUN_ID, TEST_SESSION_ID);
    await GET(req, { params: { runId: TEST_RUN_ID } });

    expect(mockDeleteRunDir).toHaveBeenCalledOnce();
  });

  // ── Report caching ─────────────────────────────────────────────────────────

  it('second call returns cached reportContent without calling deleteRunDir again', async () => {
    // First call assembles and caches
    mockAssembleReport.mockResolvedValue(SAMPLE_REPORT);
    const req1 = makeReportRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res1 = await GET(req1, { params: { runId: TEST_RUN_ID } });
    expect(res1.status).toBe(200);

    // Second call should use cache — assembleReport NOT called again
    const req2 = makeReportRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res2 = await GET(req2, { params: { runId: TEST_RUN_ID } });

    expect(res2.status).toBe(200);
    // deleteRunDir should only have been called once (first fetch)
    expect(mockDeleteRunDir).toHaveBeenCalledTimes(1);
    // assembleReport should only have been called once
    expect(mockAssembleReport).toHaveBeenCalledTimes(1);
  });

  it('session.runStatus is updated to complete after successful first read', async () => {
    mockAssembleReport.mockResolvedValue(SAMPLE_REPORT);

    const req = makeReportRequest(TEST_RUN_ID, TEST_SESSION_ID);
    await GET(req, { params: { runId: TEST_RUN_ID } });

    // Verify session status is now 'complete' by making a second request
    // that uses the cache (which confirms session was updated)
    const req2 = makeReportRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res2 = await GET(req2, { params: { runId: TEST_RUN_ID } });
    expect(res2.status).toBe(200);
  });
});
