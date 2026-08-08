//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Matches a UUID v4 directory name (the format the web app uses for run dirs),
 * anchored so partial/garbage strings and other formats (e.g. mcp-navigator-*)
 * never match. Exported here as the single source of truth; instrumentation.node
 * imports it for the orphan sweep.
 *
 * This is a side-effect-free top-level constant, so importing it from the
 * Node-only module does not pull register()'s deferred (dynamic) import of
 * instrumentation.node into the static graph — no circular dependency at eval.
 */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initNodeRuntime } = await import('./instrumentation.node');
    await initNodeRuntime();
  }
}
