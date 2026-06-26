<<<<<<< HEAD
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
=======
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ORPHAN_THRESHOLD_MS = 30 * 60 * 1000;

async function sweepOrphanRunDirs(): Promise<void> {
  const [{ readdir, stat, rm }, pathModule, { getWorkforceBase }] =
    await Promise.all([
      import('fs/promises'),
      import('path'),
      import('@/lib/report-assembler'),
    ]);

  const path = pathModule.default;
  const workforceBase = getWorkforceBase();

  let entries;
  try {
    entries = await readdir(workforceBase, { withFileTypes: true });
  } catch {
    return;
  }

  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!UUID_V4_REGEX.test(entry.name)) continue;

    const dirPath = path.join(workforceBase, entry.name);

    try {
      const statResult = await stat(dirPath);
      const ageMs = now - statResult.mtimeMs;

      if (ageMs > ORPHAN_THRESHOLD_MS) {
        await rm(dirPath, { recursive: true, force: true });
        console.log(JSON.stringify({
          level: 'info',
          event: 'orphan_run_dir_deleted',
          runId: entry.name,
          ageMinutes: Math.floor(ageMs / 60_000),
        }));
      }
    } catch {}
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { logStartupChecks } = await import('@/lib/kvr-checker');

  logStartupChecks();
  await sweepOrphanRunDirs();

  console.log(JSON.stringify({
    level: 'info',
    event: 'web_app_start',
    runtime: process.env.NEXT_RUNTIME,
    nodeVersion: process.version,
  }));
}
>>>>>>> 42bd559 (Updated instrumentation.ts)
