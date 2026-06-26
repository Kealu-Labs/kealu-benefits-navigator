//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { spawnSync } from 'child_process';

/** Minimum required KVR CLI version. */
export const MIN_KVR_VERSION = '0.114.13';

/** Parsed semver tuple [major, minor, patch]. */
export type SemverTuple = [number, number, number];

/**
 * Parse a semver string into a [major, minor, patch] tuple.
 * Throws if the string does not match the `x.y.z` pattern.
 */
export function parseSemver(version: string): SemverTuple {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid semver: "${version}"`);
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
}

/**
 * Compare two semver tuples.
 * Returns positive if a > b, 0 if equal, negative if a < b.
 */
export function compareSemver(a: SemverTuple, b: SemverTuple): number {
  for (let i = 0; i < 3; i++) {
    const diff = a[i] - b[i];
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface KvrVersionResult {
  ok: boolean;
  version: string;
  path: string | null;
  error?: string;
}

/**
 * Locate the `kvr` binary using `which` (POSIX) or `where` (Windows).
 * Returns the trimmed path or null if not found.
 */
export function resolveKvr(): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(cmd, ['kvr'], { encoding: 'buffer' });
    if (result.status !== 0) return null;
    const out = result.stdout.toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Check whether `kvr` is on PATH and meets the minimum version requirement.
 */
export function checkKvrVersion(): KvrVersionResult {
  const kvrPath = resolveKvr();
  if (!kvrPath) {
    return { ok: false, version: '', path: null, error: 'kvr not found on PATH' };
  }

  try {
    const result = spawnSync(kvrPath, ['--version'], { encoding: 'buffer' });
    const raw = result.stdout.toString().trim();
    // Output format: "kvr 0.225.0"
    const versionMatch = raw.match(/(\d+\.\d+\.\d+)/);
    if (!versionMatch) {
      return { ok: false, version: '', path: kvrPath, error: 'Could not parse kvr version' };
    }

    const version = versionMatch[1];
    const installed = parseSemver(version);
    const minimum = parseSemver(MIN_KVR_VERSION);
    const ok = compareSemver(installed, minimum) >= 0;

    return { ok, version, path: kvrPath };
  } catch (err) {
    return { ok: false, version: '', path: kvrPath, error: String(err) };
  }
}

/**
 * Returns true when CMS_API_KEY is set to a non-empty, non-whitespace value.
 */
export function checkCmsApiKey(): boolean {
  const key = process.env.CMS_API_KEY;
  return typeof key === 'string' && key.trim().length > 0;
}

/**
 * Log structured warnings for any failed startup checks.
 * Called from `instrumentation.ts` on server startup.
 */
export function logStartupChecks(): void {
  const kvrResult = checkKvrVersion();
  if (!kvrResult.ok) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'startup_check_failed',
        check: 'kvr',
        error: kvrResult.error ?? `kvr version ${kvrResult.version} below minimum ${MIN_KVR_VERSION}`,
      }),
    );
  }

  if (!checkCmsApiKey()) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'startup_check_failed',
        check: 'cms_api_key',
        error: 'CMS_API_KEY is not set — Marketplace plan data will be unavailable',
      }),
    );
  }
}
