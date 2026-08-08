/**
 * Unit tests for web/src/lib/session-store.ts
 *
 * These tests FAIL before implementation (module does not exist).
 * They are the completion signal for impl/code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// This import fails until web/src/lib/session-store.ts is created.
import { SessionStore, SESSION_TTL_MS } from '@/lib/session-store';

const TEST_SESSION_ID = '550e8400-e29b-41d4-a716-446655440001';

describe('SessionStore', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore();
  });

  // ── SESSION_TTL_MS constant ────────────────────────────────────────────────

  it('SESSION_TTL_MS is exactly 7_200_000 ms (2 hours)', () => {
    expect(SESSION_TTL_MS).toBe(7_200_000);
  });

  // ── create() ──────────────────────────────────────────────────────────────

  it('create() sets createdAt to approximately now', () => {
    const before = Date.now();
    const session = store.create(TEST_SESSION_ID);
    const after = Date.now();
    expect(session.createdAt).toBeGreaterThanOrEqual(before);
    expect(session.createdAt).toBeLessThanOrEqual(after);
  });

  it('create() sets expiresAt = createdAt + SESSION_TTL_MS', () => {
    const session = store.create(TEST_SESSION_ID);
    expect(session.expiresAt).toBe(session.createdAt + SESSION_TTL_MS);
  });

  it('create() initializes currentTier to 1', () => {
    const session = store.create(TEST_SESSION_ID);
    expect(session.currentTier).toBe(1);
  });

  it('create() initializes skipIntake to false', () => {
    const session = store.create(TEST_SESSION_ID);
    expect(session.skipIntake).toBe(false);
  });

  it('create() initializes vars as empty object', () => {
    const session = store.create(TEST_SESSION_ID);
    expect(session.vars).toEqual({});
  });

  it('create() initializes messages as empty array', () => {
    const session = store.create(TEST_SESSION_ID);
    expect(session.messages).toEqual([]);
  });

  // ── get() ─────────────────────────────────────────────────────────────────

  it('get() returns null for unknown sessionId', () => {
    const result = store.get('unknown-session-id');
    expect(result).toBeNull();
  });

  it('get() returns the session for a known sessionId', () => {
    store.create(TEST_SESSION_ID);
    const result = store.get(TEST_SESSION_ID);
    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe(TEST_SESSION_ID);
  });

  it('get() returns null for an expired session', () => {
    vi.useFakeTimers();
    const session = store.create(TEST_SESSION_ID);
    // Force expiry
    vi.setSystemTime(session.expiresAt + 1);
    const result = store.get(TEST_SESSION_ID);
    expect(result).toBeNull();
    vi.useRealTimers();
  });

  it('get() auto-evicts expired entries from the map', () => {
    vi.useFakeTimers();
    const session = store.create(TEST_SESSION_ID);
    vi.setSystemTime(session.expiresAt + 1);
    store.get(TEST_SESSION_ID); // triggers eviction
    vi.useRealTimers();

    // After eviction, even with real time the entry is gone
    // We can verify by checking evictExpired removes nothing new
    const snapshot: string[] = [];
    store.evictExpired(); // should be no-op now
    expect(store.get(TEST_SESSION_ID)).toBeNull();
  });

  // ── update() ──────────────────────────────────────────────────────────────

  it('update() returns null for missing session', () => {
    const result = store.update('nonexistent', { skipIntake: true });
    expect(result).toBeNull();
  });

  it('update() merges patch into existing session', () => {
    store.create(TEST_SESSION_ID);
    const updated = store.update(TEST_SESSION_ID, { skipIntake: true, currentTier: 2 });
    expect(updated).not.toBeNull();
    expect(updated?.skipIntake).toBe(true);
    expect(updated?.currentTier).toBe(2);
  });

  it('update() preserves existing fields not in patch', () => {
    store.create(TEST_SESSION_ID);
    store.update(TEST_SESSION_ID, { currentTier: 2 });
    const session = store.get(TEST_SESSION_ID);
    expect(session?.skipIntake).toBe(false); // original value preserved
    expect(session?.currentTier).toBe(2);   // patched value updated
  });

  // ── delete() ──────────────────────────────────────────────────────────────

  it('delete() removes the session', () => {
    store.create(TEST_SESSION_ID);
    store.delete(TEST_SESSION_ID);
    expect(store.get(TEST_SESSION_ID)).toBeNull();
  });

  it('delete() is a no-op for unknown session', () => {
    expect(() => store.delete('unknown')).not.toThrow();
  });

  // ── evictExpired() ────────────────────────────────────────────────────────

  it('evictExpired() removes all sessions past TTL', () => {
    vi.useFakeTimers();
    store.create('session-1');
    store.create('session-2');
    const session3 = store.create('session-3');
    // Expire sessions 1 and 2
    vi.setSystemTime(session3.expiresAt + 1);
    store.evictExpired();
    expect(store.get('session-1')).toBeNull();
    expect(store.get('session-2')).toBeNull();
    vi.useRealTimers();
  });

  it('evictExpired() retains sessions that are still valid', () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    store.create('fresh-session');
    // Advance by 1 hour — session is still valid (TTL is 2 hours)
    vi.setSystemTime(now + 3_600_000);
    store.evictExpired();
    expect(store.get('fresh-session')).not.toBeNull();
    vi.useRealTimers();
  });

  // ── Edge runtime guard ────────────────────────────────────────────────────

  it('module-level setInterval eviction guard does not throw in Node environment', () => {
    // The module initializes a setInterval at load time; if it throws, the import above fails.
    // This test simply verifies the module loaded without errors.
    expect(SESSION_TTL_MS).toBeDefined();
  });
});
