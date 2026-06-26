//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Next.js instrumentation hook — runs once per server process start.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Node.js-only startup work (orphan sweep, kvr version check) lives in
 * instrumentation.node.ts. It is loaded via dynamic import so webpack never
 * attempts to bundle fs/promises or child_process for the Edge Runtime.
 */

/** UUID v4 regex — matches exactly a UUID v4 string, nothing else. */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Next.js instrumentation entry point.
 * Skips immediately on the Edge Runtime; runs Node.js startup logic otherwise.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { initNodeRuntime } = await import('./instrumentation.node');
  await initNodeRuntime();
}
