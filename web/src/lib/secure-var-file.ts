//
// Copyright 2026 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { randomBytes } from 'crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  rmSync,
  statSync,
  writeSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * Applicant values are passed to the `kvr` subprocess by FILE REFERENCE, never
 * on its command line.
 *
 * Why: `kvr run --var KEY=VALUE` puts the value in the child's argv, and argv is
 * world-readable — any process on the host can read `/proc/<pid>/cmdline` with
 * no privilege at all. The values in question are an applicant's income,
 * medications, household composition, providers and ZIP. `kvr` supports
 * `--var KEY=@path` to read the value from a file instead, so the value never
 * appears in the process table.
 *
 * DO NOT "tidy" this to `os.tmpdir()` on Linux. `/dev/shm` is deliberate: it is
 * a tmpfs, so the data lives in RAM and never reaches durable storage. A normal
 * temp directory would write applicant health and income data to the block
 * volume, which is precisely what this is avoiding. The fallback below exists
 * only for non-Linux development machines, where the data is synthetic.
 *
 * Files are mode 0600 inside a mode 0700 per-run directory, and are unlinked as
 * soon as the child has demonstrably read them. See `VarFileHandle.cleanup`.
 */

/** tmpfs on Linux — RAM-backed, never written to durable storage. */
const SHM_DIR = '/dev/shm';

export interface VarFileHandle {
  /** `--var`-ready argument pairs, carrying file paths rather than values. */
  args: string[];
  /** Directory holding the value files, so callers can assert on it in tests. */
  dir: string;
  /** Idempotent. Removes the directory and every value file in it. */
  cleanup: () => void;
}

/**
 * Prefer tmpfs; fall back to the OS temp dir only where tmpfs does not exist
 * (macOS development machines). The deploy target is Linux, where this resolves
 * to /dev/shm.
 */
export function resolveSecureVarDir(): string {
  try {
    if (existsSync(SHM_DIR) && statSync(SHM_DIR).isDirectory()) return SHM_DIR;
  } catch {
    // fall through
  }
  return tmpdir();
}

/**
 * Write each variable to its own 0600 file and return `--var KEY=@path` args.
 *
 * Values with any content are written; empty/absent values are skipped, matching
 * the previous inline behaviour.
 */
export function writeVarFiles(
  vars: Record<string, unknown>,
  baseDir: string = resolveSecureVarDir(),
): VarFileHandle {
  const dir = path.join(baseDir, `kbn-vars-${randomBytes(16).toString('hex')}`);
  mkdirSync(dir, { mode: 0o700, recursive: false });

  const args: string[] = [];

  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined || value === null || String(value).length === 0) {
      continue;
    }

    const filePath = path.join(dir, key);
    // 'wx' fails if the path already exists, so a pre-planted symlink cannot
    // redirect the write. The explicit mode is applied at creation rather than
    // after, so the file is never briefly readable by others.
    const fd = openSync(filePath, 'wx', 0o600);
    try {
      writeSync(fd, String(value));
    } finally {
      closeSync(fd);
    }

    args.push('--var', `${key}=@${filePath}`);
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    // force: never throw from a cleanup path — a failed unlink must not take
    // down a run, and cleanup is invoked from several lifecycle events.
    rmSync(dir, { recursive: true, force: true });
  };

  return { args, dir, cleanup };
}
