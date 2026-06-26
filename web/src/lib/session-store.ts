//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import type { Session } from '@/types/session';

/** 2-hour session TTL in milliseconds. */
export const SESSION_TTL_MS = 7_200_000;

/**
 * In-memory session store for the Next.js server process.
 *
 * Sessions are keyed by UUID v4 session ID (the value stored in the `session`
 * httpOnly cookie). All state is in-process — nothing is persisted to disk or a
 * database. Sessions are automatically evicted after SESSION_TTL_MS milliseconds.
 *
 * Thread safety: Node.js is single-threaded, so no locking is required.
 */
export class SessionStore {
  private readonly _sessions = new Map<string, Session>();

  /** Create a new session and return it. */
  create(sessionId: string): Session {
    const now = Date.now();
    const session: Session = {
      sessionId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      currentTier: 1,
      skipIntake: false,
      vars: {},
      messages: [],
    };
    this._sessions.set(sessionId, session);
    return session;
  }

  /** Return a session if it exists and has not expired; null otherwise. Auto-evicts on expiry. */
  get(sessionId: string): Session | null {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this._sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  /** Merge patch into an existing session. Returns the updated session or null if not found. */
  update(sessionId: string, patch: Partial<Session>): Session | null {
    const session = this.get(sessionId);
    if (!session) return null;
    const updated = { ...session, ...patch };
    this._sessions.set(sessionId, updated);
    return updated;
  }

  /** Remove a session. No-op if not found. */
  delete(sessionId: string): void {
    this._sessions.delete(sessionId);
  }

  /** Remove all sessions whose expiresAt is in the past. */
  evictExpired(): void {
    const now = Date.now();
    for (const [id, session] of this._sessions) {
      if (now > session.expiresAt) {
        this._sessions.delete(id);
      }
    }
  }
}

/** Singleton session store for the Next.js process. */
export const sessionStore = new SessionStore();

// Periodic eviction — runs every 15 minutes. Guard for edge runtime where setInterval may not exist.
if (typeof setInterval !== 'undefined') {
  setInterval(() => sessionStore.evictExpired(), 15 * 60 * 1000);
}
