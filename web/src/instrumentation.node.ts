//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

// Node.js-only instrumentation. Loaded exclusively via:
//   await import('./instrumentation.node')
// inside register() after the NEXT_RUNTIME === 'nodejs' check.
// Next.js treats instrumentation.node.(ts|js) as Node.js-only and never
// attempts to bundle it for the Edge Runtime.

import { readdir, stat, rm } from 'fs/promises';
import path from 'path';
import { logStartupChecks } from '@/lib/kvr-checker';
import { getWorkforceBase } from '@/lib/report-assembler';

// Local copy of UUID_V4_REGEX to avoid a circular import with instrumentation.ts.
// Must stay in sync with the exported const in instrumentation.ts.
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ORPHAN_THRESHOLD_MS = 30 * 60 * 1000;

async function sweepOrphanRunDirs(): Promise<void> {
  const workforceBase = getWorkforceBase();
  let entries: Array<{ name: string; isDirectory(): boolean }>;

  try {
    entries = await readdir(workforceBase, { withFileTypes: true }) as Array<{
      name: string;
      isDirectory(): boolean;
    }>;
  } catch {
    // .workforce/ may not exist yet — that's fine
    return;
  }

  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Only sweep UUID v4 directories — never mcp-navigator-* or other formats
    if (!UUID_V4_REGEX.test(entry.name)) continue;

    const dirPath = path.join(workforceBase, entry.name);
    try {
      const statResult = await stat(dirPath);
      const ageMs = now - statResult.mtimeMs;
      if (ageMs > ORPHAN_THRESHOLD_MS) {
        await rm(dirPath, { recursive: true, force: true });
        console.log(
          JSON.stringify({
            level: 'info',
            event: 'orphan_run_dir_deleted',
            runId: entry.name,
            ageMinutes: Math.floor(ageMs / 60_000),
          }),
        );
      }
    } catch {
      // stat or rm failed — skip this entry gracefully
    }
  }
}

/** Called by register() after confirming NEXT_RUNTIME === 'nodejs'. */
export async function initNodeRuntime(): Promise<void> {
  logStartupChecks();
  await sweepOrphanRunDirs();
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'web_app_start',
      runtime: process.env.NEXT_RUNTIME,
      nodeVersion: process.version,
    }),
  );
}
