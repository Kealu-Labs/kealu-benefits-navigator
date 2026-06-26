//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { spawn } from 'child_process';
import path from 'path';
import type { ChildProcess } from 'child_process';
import type { HouseholdVars } from '@/types/session';
import type { PhaseEvent } from '@/types/session';
import { resolveKvr } from '@/lib/kvr-checker';

/** Idle timeout: 10 minutes with no stdout output → terminate run. */
export const IDLE_TIMEOUT_MS = 600_000;

/** Delay before SIGTERM when last SSE controller disconnects. */
export const SIGTERM_DELAY_MS = 60_000;

/** Canonical phase names in workflow order. */
export const PHASE_NAMES: string[] = [
  'benefits-research',
  'insurance-research',
  'evidence-verification',
  'eligibility-validation',
  'action-plan',
];

/** ReadableStream controller type alias. */
type StreamController = ReadableStreamDefaultController<Uint8Array>;

interface ActiveRun {
  proc: ChildProcess;
  runId: string;
  sessionId: string;
  startedAt: number;
  lastEventAt: number;
  controllers: Set<StreamController>;
  idleTimer: ReturnType<typeof setInterval>;
  orphanTimer?: ReturnType<typeof setTimeout>;
}

/** Map of runId → ActiveRun for all in-progress workflow runs. */
export const activeRuns = new Map<string, ActiveRun>();

/** Map of sessionId → runId for idempotency check. */
const sessionRunMap = new Map<string, string>();

/**
 * Format a PhaseEvent as an SSE frame.
 * Format: `id: <id>\nevent: phase\ndata: <json>\n\n`
 */
export function formatSseEvent(event: PhaseEvent, id: string): string {
  return `id: ${id}\nevent: phase\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Process a single stdout line from the kvr subprocess.
 * Broadcasts valid [PHASE_STREAM] JSON events to all SSE controllers.
 */
function _processLine(
  runId: string,
  line: string,
  broadcast: (payload: string) => void,
): void {
  if (!line || !line.startsWith('[PHASE_STREAM] ')) return;
  const jsonStr = line.slice('[PHASE_STREAM] '.length);
  try {
    const event: PhaseEvent = JSON.parse(jsonStr);
    const id = `${runId}-${Date.now()}`;
    broadcast(formatSseEvent(event, id));
  } catch {
    // Malformed JSON — silently drop to avoid disconnecting clients
  }
}

/**
 * Check whether the run has been idle longer than IDLE_TIMEOUT_MS.
 * If so, broadcast an error event and terminate.
 */
function _checkIdle(
  runId: string,
  lastEventAt: number,
  terminate: (runId: string) => void,
  broadcast: (payload: string) => void,
): void {
  const elapsed = Date.now() - lastEventAt;
  if (elapsed >= IDLE_TIMEOUT_MS) {
    const errorEvent: PhaseEvent = {
      event_type: 'error',
      message: `Workflow idle for ${Math.floor(elapsed / 60_000)} minutes — terminating`,
    };
    broadcast(formatSseEvent(errorEvent, `${runId}-idle`));
    terminate(runId);
  }
}

/** Broadcast an SSE payload string to all registered controllers for a run. */
function broadcastToRun(runId: string, payload: string): void {
  const run = activeRuns.get(runId);
  if (!run) return;
  const encoder = new TextEncoder();
  for (const ctrl of run.controllers) {
    try {
      ctrl.enqueue(encoder.encode(payload));
    } catch {
      // Controller closed — ignore
    }
  }
  // Update last event timestamp
  run.lastEventAt = Date.now();
}

/**
 * Start a KVR workflow run for a session. Idempotent per sessionId.
 * Throws if kvr is not found on PATH.
 */
export function startRun(
  runId: string,
  sessionId: string,
  vars: Partial<HouseholdVars> & { annual_income?: string },
): void {
  // Idempotency: if session already has a run, do nothing
  if (sessionRunMap.has(sessionId)) return;

  const kvrPath = resolveKvr();
  if (!kvrPath) throw new Error('kvr binary not found on PATH');

  // Build --var key=value args from all populated vars
  const varArgs: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      varArgs.push('--var', `${key}=${String(value)}`);
    }
  }

  const args = [
    'run',
    'benefits-navigator',
    '--mode', 'automated',
    '--no-progress',
    '--run-id', runId,
    '--phase-stream', 'stdout',
    ...varArgs,
  ];

  // cwd = parent of web/ = repo root, so kvr writes .workforce/ to repo root
  const cwd = path.join(process.cwd(), '..');

  const proc = spawn(kvrPath, args, { cwd, shell: false });

  const idleTimer = setInterval(() => {
    const run = activeRuns.get(runId);
    if (run) {
      _checkIdle(runId, run.lastEventAt, terminateRun, (payload) =>
        broadcastToRun(runId, payload),
      );
    }
  }, 30_000);

  const run: ActiveRun = {
    proc,
    runId,
    sessionId,
    startedAt: Date.now(),
    lastEventAt: Date.now(),
    controllers: new Set(),
    idleTimer,
  };

  activeRuns.set(runId, run);
  sessionRunMap.set(sessionId, runId);

  // Stream stdout lines
  let buffer = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      _processLine(runId, line, (payload) => broadcastToRun(runId, payload));
    }
  });

  proc.stderr?.resume(); // drain stderr to prevent backpressure

  proc.on('close', () => {
    // Process exited — clean up after a short delay to allow final events to flush
    setTimeout(() => terminateRun(runId), 2_000);
  });
}

/**
 * Terminate a running KVR process, clear timers, and remove from the registry.
 * No-op for unknown runIds.
 */
export function terminateRun(runId: string): void {
  const run = activeRuns.get(runId);
  if (!run) return;

  clearInterval(run.idleTimer);
  if (run.orphanTimer !== undefined) {
    clearTimeout(run.orphanTimer);
  }

  try {
    run.proc.kill('SIGTERM');
  } catch {
    // Ignore if already dead
  }

  sessionRunMap.delete(run.sessionId);
  activeRuns.delete(runId);
}

/**
 * Register an SSE controller to receive events for a run.
 * Cancels any pending orphan timer.
 */
export function addController(runId: string, ctrl: StreamController): void {
  const run = activeRuns.get(runId);
  if (!run) return;

  if (run.orphanTimer !== undefined) {
    clearTimeout(run.orphanTimer);
    run.orphanTimer = undefined;
  }

  run.controllers.add(ctrl);
}

/**
 * Deregister an SSE controller from a run.
 * If the set becomes empty, schedules SIGTERM after SIGTERM_DELAY_MS.
 */
export function removeController(runId: string, ctrl: StreamController): void {
  const run = activeRuns.get(runId);
  if (!run) return;

  run.controllers.delete(ctrl);

  if (run.controllers.size === 0) {
    run.orphanTimer = setTimeout(() => terminateRun(runId), SIGTERM_DELAY_MS);
  }
}

/**
 * Return the runId for a session if one is active, undefined otherwise.
 * Searches both the sessionRunMap (fast path) and activeRuns (for tests that insert directly).
 */
export function getRunIdForSession(sessionId: string): string | undefined {
  // Fast path — sessionRunMap is populated by startRun()
  const cached = sessionRunMap.get(sessionId);
  if (cached) return cached;
  // Fallback — search activeRuns by sessionId (supports test fixtures that insert directly)
  for (const [runId, run] of activeRuns) {
    if (run.sessionId === sessionId) return runId;
  }
  return undefined;
}

/** Exported internal helpers for unit testing. */
export const __internal = {
  _processLine,
  _checkIdle,
};
