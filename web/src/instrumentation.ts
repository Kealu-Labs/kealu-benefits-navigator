//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Matches a canonical UUID v4 string (the format of KVR run directory names).
 *
 * Edge-safe (a bare regex literal with no Node.js dependencies) so it can live in
 * this instrumentation entrypoint. `instrumentation.node.ts` keeps a synced local
 * copy to avoid a circular import; the two must stay identical.
 */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initNodeRuntime } = await import('./instrumentation.node');
    await initNodeRuntime();
  }
}
