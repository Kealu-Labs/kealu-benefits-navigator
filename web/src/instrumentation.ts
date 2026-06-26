//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Next.js instrumentation hook — runs once per server process start.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Responsibilities:
 * 1. Log structured startup event.
 * 2. Run startup checks (kvr version, CMS API key).
 * 3. Sweep stale UUID v4 run directories from .workforce/.
 *    MCP server dirs (mcp-navigator-*) are NEVER deleted by this sweep.
 */

import { readdir, stat, rm } from 'fs/promises';
import path from 'path';
import { logStartupChecks } from '@/lib/kvr-checker';
import { getWorkforceBase } from '@/lib/report-assembler';

/** UUID v4 regex — matches exactly a UUID v4 string, nothing else. */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Directories older than this threshold are considered orphaned. */
const ORPHAN_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Sweep stale UUID v4 directories from the .workforce base directory.
 * MCP server directories (non-UUID-v4 names) are never touched.
 */
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

/**
 * Next.js instrumentation entry point.
 * Only runs in the Node.js runtime (not Edge runtime).
 */
export async function register(): Promise<void> {
  // Guard: only run in Node.js server runtime
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Run startup dependency checks
  logStartupChecks();

  // Sweep stale orphaned run directories
  await sweepOrphanRunDirs();

  // Structured startup log
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'web_app_start',
      runtime: process.env.NEXT_RUNTIME,
      nodeVersion: process.version,
    }),
  );
}
