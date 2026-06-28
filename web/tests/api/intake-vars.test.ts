/**
 * Black-box API route tests for GET/POST /api/intake/vars
 *
 * Real session store and intake values run — seeded with two sessions to prove
 * owner isolation. next/headers is mocked (Next.js internal).
 *
 * Follows the tests/api/workflow-start.test.ts pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Declared via vi.hoisted so they are initialized before the hoisted vi.mock
// factories (which reference them) run.
const { SESSION_A, SESSION_B } = vi.hoisted(() => ({
  SESSION_A: 'test-session-vars-A',
  SESSION_B: 'test-session-vars-B',
}));

let _sessionCookies: Record<string, string> = {};

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

// Seed session store singleton with two independent sessions.
vi.mock('@/lib/session-store', async () => {
  const { SessionStore } = await vi.importActual<typeof import('@/lib/session-store')>(
    '@/lib/session-store',
  );
  const store = new SessionStore();
  store.create(SESSION_A);
  store.create(SESSION_B);
  return { sessionStore: store, SessionStore, SESSION_TTL_MS: 7_200_000 };
});

import { GET, POST } from '@/app/api/intake/vars/route';
import { sessionStore } from '@/lib/session-store';

/** Reset both seeded sessions to a known set of intake vars. */
function seedSessions() {
  sessionStore.update(SESSION_A, {
    vars: {
      zip_code: '77001',
      annual_income: '42000',
      household_profile: 'single parent, 2 kids',
      medications: 'metformin',
      // `state` is a HouseholdVar but NOT user-editable — used to prove the whitelist.
      state: 'TX',
    },
  });
  sessionStore.update(SESSION_B, {
    vars: {
      zip_code: '10001',
      annual_income: '99000',
      household_profile: 'couple, no kids',
    },
  });
}

function makeGetRequest(sessionId?: string): Request {
  const headers: Record<string, string> = {};
  if (sessionId) headers['Cookie'] = `session=${sessionId}`;
  return new Request('http://localhost/api/intake/vars', { method: 'GET', headers });
}

function makePostRequest(vars: Record<string, unknown>, sessionId?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) headers['Cookie'] = `session=${sessionId}`;
  return new Request('http://localhost/api/intake/vars', {
    method: 'POST',
    headers,
    body: JSON.stringify({ vars }),
  });
}

describe('GET /api/intake/vars', () => {
  beforeEach(() => {
    _sessionCookies = {};
    seedSessions();
  });

  it('returns the current session intake values for the owner', async () => {
    const res = await GET(makeGetRequest(SESSION_A));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.vars.zip_code).toBe('77001');
    expect(body.vars.annual_income).toBe('42000');
    expect(body.vars.household_profile).toBe('single parent, 2 kids');
    expect(body.vars.medications).toBe('metformin');
  });

  it('only returns whitelisted editable keys (never non-editable vars like `state`)', async () => {
    const res = await GET(makeGetRequest(SESSION_A));
    const body = await res.json();

    expect(body.vars).not.toHaveProperty('state');
    // Unset editable keys are present as empty strings.
    expect(body.vars.providers).toBe('');
  });

  it("returns one session's values only — never another session's data", async () => {
    const res = await GET(makeGetRequest(SESSION_A));
    const body = await res.json();

    // Session B's distinct values must not leak into Session A's response.
    expect(body.vars.zip_code).not.toBe('10001');
    expect(body.vars.annual_income).not.toBe('99000');
  });

  it('returns HTTP 403 when the session cookie is absent', async () => {
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(403);
  });

  it('returns HTTP 403 for an unknown session', async () => {
    const res = await GET(makeGetRequest('nonexistent-session'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/intake/vars', () => {
  beforeEach(() => {
    _sessionCookies = {};
    seedSessions();
  });

  it('saves edited vars to the session', async () => {
    const res = await POST(makePostRequest({ zip_code: '90210' }, SESSION_A));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(sessionStore.get(SESSION_A)?.vars.zip_code).toBe('90210');
    // Untouched fields are preserved.
    expect(sessionStore.get(SESSION_A)?.vars.household_profile).toBe('single parent, 2 kids');
  });

  it('normalizes annual_income to digits only', async () => {
    const res = await POST(makePostRequest({ annual_income: '$52,000' }, SESSION_A));
    expect(res.status).toBe(200);

    expect(sessionStore.get(SESSION_A)?.vars.annual_income).toBe('52000');
  });

  it('returns HTTP 400 when a Tier-1 required field is emptied', async () => {
    const res = await POST(makePostRequest({ zip_code: '' }, SESSION_A));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.missing).toContain('zip_code');

    // The store must not have been mutated on a validation failure.
    expect(sessionStore.get(SESSION_A)?.vars.zip_code).toBe('77001');
  });

  it("does not allow editing another session's vars", async () => {
    // Editing as Session A must never touch Session B's data.
    await POST(makePostRequest({ zip_code: '90210' }, SESSION_A));

    expect(sessionStore.get(SESSION_B)?.vars.zip_code).toBe('10001');
  });

  it('returns HTTP 403 for an unknown session and does not mutate state', async () => {
    const res = await POST(makePostRequest({ zip_code: '90210' }, 'nonexistent-session'));
    expect(res.status).toBe(403);

    // Neither seeded session changed.
    expect(sessionStore.get(SESSION_A)?.vars.zip_code).toBe('77001');
    expect(sessionStore.get(SESSION_B)?.vars.zip_code).toBe('10001');
  });
});
