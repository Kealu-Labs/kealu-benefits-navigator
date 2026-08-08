/**
 * Integration test: Session TTL eviction under real elapsed time.
 *
 * These tests FAIL before implementation (modules do not exist).
 *
 * Uses a real SessionStore with a very short TTL (100ms) to verify that:
 * - Sessions are auto-evicted when expired
 * - Sessions that are still valid are NOT evicted
 * - The evictExpired() method correctly removes only expired sessions
 *
 * This test does NOT use fake timers — it waits real milliseconds.
 */
import { describe, it, expect } from 'vitest';

// This import FAILS before implementation.
import { SessionStore, SESSION_TTL_MS } from '@/lib/session-store';

// ---------------------------------------------------------------------------
// Helper: sleep for real milliseconds
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// SESSION_TTL_MS constant
// ---------------------------------------------------------------------------

describe('SESSION_TTL_MS constant', () => {
  it('is exactly 7_200_000 milliseconds (2 hours)', () => {
    expect(SESSION_TTL_MS).toBe(7_200_000);
  });
});

// ---------------------------------------------------------------------------
// Real-time TTL eviction
// ---------------------------------------------------------------------------

describe('Session TTL eviction under real elapsed time', () => {
  it('session with 100ms TTL is evicted after 150ms', async () => {
    // Create a store with a real session, then manually set a short expiresAt
    const store = new SessionStore();
    const sessionId = 'integration-ttl-test-' + Date.now();

    // Create the session normally
    store.create(sessionId);

    // Manually patch the session to have a very short TTL (100ms from now)
    const shortExpiry = Date.now() + 100;
    store.update(sessionId, { expiresAt: shortExpiry });

    // Verify it's accessible now
    const before = store.get(sessionId);
    expect(before).not.toBeNull();

    // Wait 150ms — session should expire
    await sleep(150);

    // Now trigger eviction
    store.evictExpired();

    // Session should be gone
    const after = store.get(sessionId);
    expect(after).toBeNull();
  }, 5_000); // 5s timeout for this test

  it('session with 2-hour TTL is NOT evicted after 150ms', async () => {
    const store = new SessionStore();
    const sessionId = 'integration-ttl-valid-' + Date.now();

    store.create(sessionId);

    await sleep(150);
    store.evictExpired();

    // Should still be accessible
    const session = store.get(sessionId);
    expect(session).not.toBeNull();
    expect(session?.sessionId).toBe(sessionId);
  }, 5_000);

  it('evictExpired() removes expired but not valid sessions in same store', async () => {
    const store = new SessionStore();
    const expiredId = 'expired-session-' + Date.now();
    const validId = 'valid-session-' + Date.now();

    // Create both sessions
    store.create(expiredId);
    store.create(validId);

    // Set expired session to expire in 50ms
    store.update(expiredId, { expiresAt: Date.now() + 50 });

    // Wait 100ms
    await sleep(100);

    // Evict
    store.evictExpired();

    // Expired session should be gone
    expect(store.get(expiredId)).toBeNull();

    // Valid session should still exist
    expect(store.get(validId)).not.toBeNull();
  }, 5_000);

  it('get() auto-evicts expired entry on access without explicit evictExpired() call', async () => {
    const store = new SessionStore();
    const sessionId = 'auto-evict-test-' + Date.now();

    store.create(sessionId);

    // Set to expire in 50ms
    store.update(sessionId, { expiresAt: Date.now() + 50 });

    // Wait 100ms
    await sleep(100);

    // get() should return null AND auto-evict
    const result = store.get(sessionId);
    expect(result).toBeNull();

    // After auto-eviction, evictExpired() should be a clean no-op
    expect(() => store.evictExpired()).not.toThrow();
  }, 5_000);
});

// ---------------------------------------------------------------------------
// Concurrent session management
// ---------------------------------------------------------------------------

describe('Concurrent session management', () => {
  it('multiple sessions are managed independently', () => {
    const store = new SessionStore();
    const ids = ['sess-a-' + Date.now(), 'sess-b-' + Date.now(), 'sess-c-' + Date.now()];

    // Create all
    for (const id of ids) {
      store.create(id);
    }

    // Update one
    store.update(ids[0], { skipIntake: true });

    // Verify independence
    expect(store.get(ids[0])?.skipIntake).toBe(true);
    expect(store.get(ids[1])?.skipIntake).toBe(false); // untouched
    expect(store.get(ids[2])?.skipIntake).toBe(false); // untouched
  });

  it('deleting one session does not affect others', () => {
    const store = new SessionStore();
    const id1 = 'delete-test-1-' + Date.now();
    const id2 = 'delete-test-2-' + Date.now();

    store.create(id1);
    store.create(id2);
    store.delete(id1);

    expect(store.get(id1)).toBeNull();
    expect(store.get(id2)).not.toBeNull();
  });

  it('update() on non-existent session returns null (does not throw)', () => {
    const store = new SessionStore();
    const result = store.update('does-not-exist', { skipIntake: true });
    expect(result).toBeNull();
  });
});
