/**
 * Black-box API route tests for GET /api/workflow/[runId]/draft
 *
 * fs/promises is mocked at the filesystem boundary.
 * Session store runs real code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_RUN_ID = '550e8400-e29b-41d4-a716-446655440030';
const TEST_SESSION_ID = 'test-session-draft-001';
const TEST_DRAFT_PATH = '/tmp/.workforce-drafts/test-run/draft.pdf';
const DRAFTS_BASE = '/tmp/.workforce-drafts';

let _sessionCookies: Record<string, string> = { session: TEST_SESSION_ID };

vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: (name: string) =>
        _sessionCookies[name] ? { name, value: _sessionCookies[name] } : undefined,
      set: vi.fn((name: string, value: string) => {
        _sessionCookies[name] = value;
      }),
      delete: vi.fn(),
      has: (name: string) => name in _sessionCookies,
    }),
  ),
}));

const mockStat = vi.fn();
const mockReadFile = vi.fn();

vi.mock('fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock('@/lib/report-assembler', () => ({
  getDraftsBase: vi.fn().mockReturnValue(DRAFTS_BASE),
  getWorkforceBase: vi.fn().mockReturnValue('/tmp/.workforce'),
}));

// Session store seeded with a session that owns TEST_RUN_ID and has a draftPath
vi.mock('@/lib/session-store', async () => {
  const { SessionStore } =
    await vi.importActual<typeof import('@/lib/session-store')>('@/lib/session-store');
  const store = new SessionStore();
  store.create(TEST_SESSION_ID);
  store.update(TEST_SESSION_ID, {
    runId: TEST_RUN_ID,
    runStatus: 'complete',
    draftPath: TEST_DRAFT_PATH,
    draftFormType: 'official',
  });
  return {
    sessionStore: store,
    SessionStore,
    SESSION_TTL_MS: 7_200_000,
  };
});

import { GET } from '@/app/api/workflow/[runId]/draft/route';

const FAKE_PDF = Buffer.from('%PDF-1.4 fake pdf content');

function makeDraftRequest(runId: string, sessionId?: string): Request {
  const headers: Record<string, string> = {};
  if (sessionId) headers['Cookie'] = `session=${sessionId}`;
  return new Request(`http://localhost/api/workflow/${runId}/draft`, { headers });
}

describe('GET /api/workflow/[runId]/draft', () => {
  beforeEach(async () => {
    _sessionCookies = { session: TEST_SESSION_ID };
    mockStat.mockReset();
    mockReadFile.mockReset();
    mockStat.mockResolvedValue({ size: FAKE_PDF.length });
    mockReadFile.mockResolvedValue(FAKE_PDF);

    // Restore draftPath on session before each test
    const { sessionStore } = await import('@/lib/session-store');
    sessionStore.update(TEST_SESSION_ID, {
      runId: TEST_RUN_ID,
      runStatus: 'complete',
      draftPath: TEST_DRAFT_PATH,
      draftFormType: 'official',
    });
  });

  // ── Authorization ──────────────────────────────────────────────────────────

  it('returns HTTP 403 when session cookie is absent', async () => {
    const req = makeDraftRequest(TEST_RUN_ID); // no cookie
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });
    expect(res.status).toBe(403);
  });

  it('returns HTTP 403 when session.runId does not match path runId', async () => {
    const req = makeDraftRequest('different-run-id', TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: 'different-run-id' }) });
    expect(res.status).toBe(403);
  });

  // ── Missing draft ──────────────────────────────────────────────────────────

  it('returns HTTP 404 when session.draftPath is null', async () => {
    const { sessionStore } = await import('@/lib/session-store');
    sessionStore.update(TEST_SESSION_ID, { draftPath: null });

    const req = makeDraftRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns HTTP 404 when file is missing from disk (stat throws)', async () => {
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const req = makeDraftRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });
    expect(res.status).toBe(404);
  });

  // ── Path traversal guard ──────────────────────────────────────────────────

  it('returns HTTP 403 when draftPath is outside getDraftsBase()', async () => {
    const { sessionStore } = await import('@/lib/session-store');
    // Path outside .workforce-drafts/ — traversal attempt
    sessionStore.update(TEST_SESSION_ID, { draftPath: '/etc/passwd' });

    const req = makeDraftRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });
    expect(res.status).toBe(403);
  });

  // ── Successful download ────────────────────────────────────────────────────

  it('returns HTTP 200 with application/pdf content-type', async () => {
    const req = makeDraftRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });

  it('Content-Disposition includes official form filename for draftFormType official', async () => {
    const req = makeDraftRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toContain('partially-prefilled-SAWS-1-draft.pdf');
  });

  it('Content-Disposition includes worksheet filename for draftFormType worksheet', async () => {
    const { sessionStore } = await import('@/lib/session-store');
    sessionStore.update(TEST_SESSION_ID, { draftFormType: 'worksheet' });

    const req = makeDraftRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toContain('benefits-preparation-worksheet-draft.pdf');
  });

  it('X-Correlation-Id header equals the runId', async () => {
    const req = makeDraftRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });
    expect(res.headers.get('x-correlation-id')).toBe(TEST_RUN_ID);
  });

  it('response body is the PDF buffer', async () => {
    const req = makeDraftRequest(TEST_RUN_ID, TEST_SESSION_ID);
    const res = await GET(req, { params: Promise.resolve({ runId: TEST_RUN_ID }) });
    const body = await res.arrayBuffer();
    const bodyBuf = Buffer.from(body);
    expect(bodyBuf.equals(FAKE_PDF)).toBe(true);
  });
});
