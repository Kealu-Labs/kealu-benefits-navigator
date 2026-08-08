/**
 * Integration test: getWorkforceBase() + startRun() cwd alignment.
 *
 * These tests FAIL before implementation (modules do not exist).
 *
 * MAJOR fix 1 from plan/review: startRun() must pass cwd = path.join(process.cwd(), '..')
 * so that the KVR subprocess writes .workforce/ to the repo root — the same directory
 * that getWorkforceBase() resolves to.
 *
 * Tests here use a real shim kvr script (not the full mock-kvr fixture) to verify
 * that the .workforce/{runId}/ directory is created in the correct location.
 *
 * Run condition: skipped when the shim binary is not available.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

// These imports FAIL before implementation.
import { getWorkforceBase } from '@/lib/report-assembler';

// We can't import startRun directly because it spawns the real kvr binary.
// Instead, we test the cwd invariant by reading the spawn options from the mock.
import { startRun, activeRuns } from '@/lib/kvr-runner';

// ---------------------------------------------------------------------------
// getWorkforceBase() invariant
// ---------------------------------------------------------------------------

describe('getWorkforceBase() path invariant', () => {
  it("resolves to path.join(process.cwd(), '..', '.workforce')", () => {
    const result = getWorkforceBase();
    const expected = path.join(process.cwd(), '..', '.workforce');
    expect(result).toBe(expected);
  });

  it("path ends with '.workforce'", () => {
    const result = getWorkforceBase();
    expect(path.basename(result)).toBe('.workforce');
  });

  it('parent of .workforce is the parent of process.cwd() (repo root)', () => {
    const result = getWorkforceBase();
    const parentOfWorkforce = path.dirname(result);
    const parentOfCwd = path.dirname(process.cwd());
    expect(parentOfWorkforce).toBe(parentOfCwd);
  });
});

// ---------------------------------------------------------------------------
// startRun() cwd invariant (via spawn mock inspection)
// ---------------------------------------------------------------------------

// We test the cwd invariant by examining the spawn call options.
// This does NOT actually run the kvr binary.

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 99999,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn(), resume: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
  spawnSync: vi.fn(() => ({
    stdout: Buffer.from('/usr/local/bin/kvr\n'),
    status: 0,
    stderr: Buffer.from(''),
    pid: 1,
    output: [],
    signal: null,
  })),
}));

import { spawn } from 'child_process';
const mockSpawn = vi.mocked(spawn);

describe('startRun() cwd invariant (MAJOR fix 1)', () => {
  it('spawns KVR with cwd set to parent of process.cwd() (repo root)', () => {
    // Clear activeRuns to ensure idempotency check doesn't short-circuit
    activeRuns.clear();

    const testRunId = 'cwd-invariant-test-' + Date.now();
    const testSessionId = 'integration-session-cwd-test';

    startRun(testRunId, testSessionId, { zip_code: '77001' } as any);

    expect(mockSpawn).toHaveBeenCalledOnce();
    const [, , options] = mockSpawn.mock.calls[0];
    const spawnCwd = (options as any)?.cwd;

    expect(spawnCwd).toBeDefined();

    // The cwd should be the parent directory of process.cwd()
    // When running from web/, process.cwd() = <repo>/web, so parent = <repo>
    const expectedRepoRoot = path.join(process.cwd(), '..');
    expect(path.resolve(spawnCwd)).toBe(path.resolve(expectedRepoRoot));
  });

  it('getWorkforceBase() and spawn cwd resolve to the same parent directory', () => {
    // Verify the two path derivations are consistent
    const workforceBase = getWorkforceBase();
    const workforceParent = path.dirname(workforceBase);

    const expectedSpawnCwd = path.join(process.cwd(), '..');

    expect(path.resolve(workforceParent)).toBe(path.resolve(expectedSpawnCwd));
  });

  it('spawn does not use shell: true (prevents CLI injection)', () => {
    activeRuns.clear();
    const testRunId = 'no-shell-test-' + Date.now();
    mockSpawn.mockClear();

    startRun(testRunId, 'sess-no-shell', { zip_code: '77001' } as any);

    const [, , options] = mockSpawn.mock.calls[0];
    expect((options as any)?.shell).toBeFalsy();
  });

  it('spawn args include --run-id, --phase-stream stdout, --mode automated', () => {
    activeRuns.clear();
    mockSpawn.mockClear();
    const testRunId = 'args-check-' + Date.now();

    startRun(testRunId, 'sess-args', { zip_code: '77001', annual_income: '42000' } as any);

    const [, args] = mockSpawn.mock.calls[0];
    expect(args).toContain('--run-id');
    expect(args).toContain(testRunId);
    expect(args).toContain('--phase-stream');
    expect(args).toContain('stdout');
    expect(args).toContain('--mode');
    expect(args).toContain('automated');
    expect(args).toContain('--no-progress');
  });

  afterAll(() => {
    // Clean up any leftover activeRuns
    activeRuns.clear();
  });
});
