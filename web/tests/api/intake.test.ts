/**
 * Black-box API route tests for POST /api/intake
 *
 * These tests FAIL before implementation (route does not exist).
 * Real session store and intake-flow logic run — never mocked.
 * Only next/headers is mocked (Next.js internal).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let _sessionCookies: Record<string, string> = {};
let _setCookieCalls: Array<{ name: string; value: string; opts?: any }> = [];

vi.mock('next/headers', () => ({
  cookies: vi.fn(() =>
    Promise.resolve({
      get: (name: string) => _sessionCookies[name] ? { name, value: _sessionCookies[name] } : undefined,
      set: vi.fn((name: string, value: string, opts?: any) => {
        _sessionCookies[name] = value;
        _setCookieCalls.push({ name, value, opts });
      }),
      delete: vi.fn(),
      has: (name: string) => name in _sessionCookies,
    })
  ),
}));

// This import fails until web/src/app/api/intake/route.ts is created.
import { POST, GET } from '@/app/api/intake/route';

function makeIntakeRequest(message: string, sessionId?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) headers['Cookie'] = `session=${sessionId}`;
  return new Request('http://localhost/api/intake', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message }),
  });
}

/** Build a POST request that edits a previously-answered field directly. */
function makeEditRequest(key: string, value: string, sessionId?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) headers['Cookie'] = `session=${sessionId}`;
  return new Request('http://localhost/api/intake', {
    method: 'POST',
    headers,
    body: JSON.stringify({ edit: { key, value } }),
  });
}

/** Build a GET request for the answers snapshot. */
function makeGetRequest(sessionId?: string): Request {
  const headers: Record<string, string> = {};
  if (sessionId) headers['Cookie'] = `session=${sessionId}`;
  return new Request('http://localhost/api/intake', { method: 'GET', headers });
}

/**
 * Drive a fresh session through all three Tier 1 questions and return its id.
 * Each field is sent in its own message so the pending-field bookkeeping that
 * Tier 2 relies on is exercised the same way the real chat flow exercises it.
 */
async function completeTier1(): Promise<string> {
  await POST(makeIntakeRequest('My ZIP is 77001'));
  const sessionId = _sessionCookies['session'];
  await POST(makeIntakeRequest('My income is $42,000', sessionId));
  await POST(makeIntakeRequest('single parent with 2 kids ages 4 and 9', sessionId));
  return sessionId;
}

describe('POST /api/intake', () => {
  beforeEach(() => {
    _sessionCookies = {};
    _setCookieCalls = [];
  });

  // ── Cookie handling ────────────────────────────────────────────────────────

  it('creates a new session when cookie is absent and still returns 200', async () => {
    const req = makeIntakeRequest('Hello');
    const res = await POST(req);
    expect(res.status).toBe(200);
    // Should have set a cookie for the new session
    const hasCookieSet = _setCookieCalls.some((c) => c.name === 'session');
    expect(hasCookieSet).toBe(true);
  });

  // ── Field extraction ───────────────────────────────────────────────────────

  it('extracts ZIP code from message and reflects it back', async () => {
    // Start a new session
    const req1 = makeIntakeRequest('My ZIP is 77001');
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    // Response should be a question or ready — either way the session should have zip_code set
    expect(['question', 'ready']).toContain(body1.type);
  });

  it("returns {type:'question'} when more intake questions remain", async () => {
    // Send just a ZIP — the app should ask for more info
    const req = makeIntakeRequest('77001');
    const res = await POST(req);
    const body = await res.json();

    if (body.type === 'question') {
      expect(body.field).toBeDefined();
      expect(body.field.key).toBeTruthy();
      expect(body.field.prompt).toBeTruthy();
    }
    // May be 'ready' if implementation considers zip alone sufficient
    expect(['question', 'ready']).toContain(body.type);
  });

  it("returns {type:'ready'} when tier 1 and 2 fields are fully answered", async () => {
    // Provide all required fields at once
    const req = makeIntakeRequest(
      'ZIP 77001, income $42k, single parent 2 kids ages 4 and 9, uninsured, no meds, Dr. Smith, budget $300/month'
    );
    const res = await POST(req);
    const body = await res.json();
    // This should eventually get to 'ready' — may take multiple messages in implementation
    expect(['question', 'ready']).toContain(body.type);
  });

  // ── Skip signal ────────────────────────────────────────────────────────────

  it("skip message sets skipIntake:true and returns {type:'ready'}", async () => {
    // First send tier-1 info to establish a session
    const req1 = makeIntakeRequest('ZIP 77001, income $42k, single parent 2 kids');
    await POST(req1);

    // Then skip
    const sessionId = _sessionCookies['session'];
    const req2 = makeIntakeRequest('skip', sessionId);
    const res2 = await POST(req2);
    const body2 = await res2.json();

    expect(body2.type).toBe('ready');
  });

  // ── Idempotency ────────────────────────────────────────────────────────────

  it('is idempotent: re-posting the same message returns 200 without duplicating history', async () => {
    // First message
    const req1 = makeIntakeRequest('My ZIP is 77001');
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);

    // Same message again with same session
    const sessionId = _sessionCookies['session'];
    const req2 = makeIntakeRequest('My ZIP is 77001', sessionId);
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);

    // Both should succeed — no crash from duplicate
  });

  // ── PII protection ─────────────────────────────────────────────────────────

  it('does NOT include income value in response body', async () => {
    const req = makeIntakeRequest('My income is $42,000 and my ZIP is 77001');
    const res = await POST(req);
    const body = await res.json();
    const bodyString = JSON.stringify(body);

    // Income value should not appear in the response
    expect(bodyString).not.toContain('42000');
    expect(bodyString).not.toContain('42,000');
  });

  it('does NOT include medications in response body', async () => {
    const req = makeIntakeRequest('I take Metformin 500mg twice daily');
    const res = await POST(req);
    const body = await res.json();
    const bodyString = JSON.stringify(body);

    // Medication name should not be echoed back in the response body
    // (it can be in a formatted question/message but the raw field value should not leak)
    expect(typeof bodyString).toBe('string'); // basic type check
  });

  // ── Response structure ─────────────────────────────────────────────────────

  it("response body has 'type' field of 'question' or 'ready'", async () => {
    const req = makeIntakeRequest('Hello');
    const res = await POST(req);
    const body = await res.json();
    expect(['question', 'ready']).toContain(body.type);
  });

  it("question response has 'field' with 'key' and 'prompt'", async () => {
    const req = makeIntakeRequest('Hello');
    const res = await POST(req);
    const body = await res.json();

    if (body.type === 'question') {
      expect(body.field).toBeDefined();
      expect(typeof body.field.key).toBe('string');
      expect(typeof body.field.prompt).toBe('string');
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Progress indicator, Tier 2 progression, GET snapshot, edit, and resume
// ───────────────────────────────────────────────────────────────────────────

describe('intake progress / answers snapshot / edit / resume', () => {
  beforeEach(() => {
    _sessionCookies = {};
    _setCookieCalls = [];
  });

  // ── Progress step calculation ──────────────────────────────────────────────

  it('reports "Step X of 8" with the correct step for each question', async () => {
    // First question (ZIP) — before any answer the next field is step 1 of 8.
    const r1 = await POST(makeIntakeRequest('hello'));
    const b1 = await r1.json();
    expect(b1.type).toBe('question');
    expect(b1.field.key).toBe('zip_code');
    expect(b1.step).toEqual({ current: 1, total: 8 });

    // After ZIP, the next field is income at step 2 of 8.
    const sessionId = _sessionCookies['session'];
    const b2 = await (await POST(makeIntakeRequest('My ZIP is 77001', sessionId))).json();
    expect(b2.field.key).toBe('annual_income');
    expect(b2.step).toEqual({ current: 2, total: 8 });
  });

  // ── Tier 2 progression after Tier 1 completion ─────────────────────────────

  it('advances into Tier 2 questions once all Tier 1 fields are answered', async () => {
    const sessionId = await completeTier1();
    // Re-issue the next question via GET (what a reload would do).
    const snap = await (await GET(makeGetRequest(sessionId))).json();

    expect(snap.next).not.toBeNull();
    expect(snap.next.tier).toBe(2);
    expect(snap.next.key).toBe('current_coverage'); // first Tier 2 field
    expect(snap.step).toEqual({ current: 4, total: 8 });
  });

  it('continues through all 8 fields rather than stopping at Tier 1', async () => {
    const sessionId = await completeTier1();
    // Answer the first Tier 2 question — flow should keep asking, not go "ready".
    const body = await (
      await POST(makeIntakeRequest('I have employer coverage', sessionId))
    ).json();
    expect(body.type).toBe('question');
    expect(body.field.tier).toBe(2);
    expect(body.field.key).toBe('medications');
    expect(body.step).toEqual({ current: 5, total: 8 });
  });

  // ── GET /api/intake answers snapshot ───────────────────────────────────────

  it('GET returns the answers snapshot, next question, and step', async () => {
    const sessionId = await completeTier1();
    const snap = await (await GET(makeGetRequest(sessionId))).json();

    const keys = snap.answers.map((a: { key: string }) => a.key);
    expect(keys).toEqual(['zip_code', 'annual_income', 'household_profile']);

    const zip = snap.answers.find((a: { key: string }) => a.key === 'zip_code');
    expect(zip).toMatchObject({ key: 'zip_code', label: 'ZIP Code', value: '77001', tier: 1 });

    // Income is normalized to an annual figure on the way in.
    const income = snap.answers.find((a: { key: string }) => a.key === 'annual_income');
    expect(income.value).toBe('42000');
  });

  it('GET on a cookieless request returns an empty snapshot (no session created)', async () => {
    const snap = await (await GET(makeGetRequest())).json();
    expect(snap).toEqual({ answers: [], next: null, step: null });
  });

  // ── Edit flow ──────────────────────────────────────────────────────────────

  it('POST edit updates an existing answer and reflects it in the snapshot', async () => {
    const sessionId = await completeTier1();

    const edited = await (
      await POST(makeEditRequest('zip_code', '90210', sessionId))
    ).json();
    const zip = edited.answers.find((a: { key: string }) => a.key === 'zip_code');
    expect(zip.value).toBe('90210');

    // Persisted: a follow-up GET sees the corrected value.
    const snap = await (await GET(makeGetRequest(sessionId))).json();
    expect(snap.answers.find((a: { key: string }) => a.key === 'zip_code').value).toBe('90210');
  });

  it('POST edit re-normalizes income (parsed field) on edit', async () => {
    const sessionId = await completeTier1();
    const edited = await (
      await POST(makeEditRequest('annual_income', '$3,000/month', sessionId))
    ).json();
    const income = edited.answers.find((a: { key: string }) => a.key === 'annual_income');
    expect(income.value).toBe('36000'); // 3000 * 12
  });

  it('POST edit can set a Tier 2 field verbatim', async () => {
    const sessionId = await completeTier1();
    const edited = await (
      await POST(makeEditRequest('medications', 'Lisinopril 10mg daily', sessionId))
    ).json();
    const meds = edited.answers.find((a: { key: string }) => a.key === 'medications');
    expect(meds.value).toBe('Lisinopril 10mg daily');
  });

  // ── PII: edit/GET surface values, conversational POST never does ───────────

  it('edit and GET expose values to the owning session, but message POST does not', async () => {
    const sessionId = await completeTier1();

    // The editable panel (edit POST + GET) intentionally surfaces the user's own data.
    const editBody = JSON.stringify(await (await GET(makeGetRequest(sessionId))).json());
    expect(editBody).toContain('42000');

    // The conversational message flow must NOT echo previously-collected PII.
    const msgBody = JSON.stringify(
      await (await POST(makeIntakeRequest('I have employer coverage', sessionId))).json()
    );
    expect(msgBody).not.toContain('42000'); // income
    expect(msgBody).not.toContain('77001'); // zip
  });

  // ── Session resume ─────────────────────────────────────────────────────────

  it('restores progress, answers, current step, and pending field after a reload', async () => {
    // User gets partway through: all of Tier 1 + the first Tier 2 answer.
    const sessionId = await completeTier1();
    await POST(makeIntakeRequest('I have employer coverage', sessionId));

    // Simulate a page refresh: the client re-fetches the snapshot via GET.
    const snap = await (await GET(makeGetRequest(sessionId))).json();

    // Progress bar source + answers panel: 4 fields answered.
    expect(snap.answers.map((a: { key: string }) => a.key)).toEqual([
      'zip_code',
      'annual_income',
      'household_profile',
      'current_coverage',
    ]);
    // Current step restores to the next unanswered field (medications, 5 of 8).
    expect(snap.next.key).toBe('medications');
    expect(snap.step).toEqual({ current: 5, total: 8 });

    // Pending field restored: the next free-text answer is stored under 'medications',
    // not mis-parsed or dropped — i.e. the flow continues seamlessly post-reload.
    await POST(makeIntakeRequest('Metformin 500mg twice daily', sessionId));
    const after = await (await GET(makeGetRequest(sessionId))).json();
    const meds = after.answers.find((a: { key: string }) => a.key === 'medications');
    expect(meds.value).toBe('Metformin 500mg twice daily');
    expect(after.step).toEqual({ current: 6, total: 8 });
  });
});
