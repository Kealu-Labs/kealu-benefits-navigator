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

/**
 * Metadata for a single in-flight KVR workflow run.
 *
 * Lives in `activeRuns` from `startRun()` until `terminateRun()`.
 * The `controllers` set fans out SSE payloads to every connected browser tab.
 */
interface ActiveRun {
  /**
   * Replay buffer of every SSE payload broadcast for this run, in order.
   * KVR can emit early phase_start events before a browser EventSource finishes
   * connecting; addController() replays this so late-connecting clients still
   * see those events (otherwise phase cards stay stuck on "Waiting").
   */
  history: string[];
  /** The spawned KVR child process. */
  proc: ChildProcess;
  /** UUID v4 run identifier passed to kvr via --run-id. */
  runId: string;
  /** Session that owns this run — used for idempotency and SIGTERM on disconnect. */
  sessionId: string;
  /** Unix timestamp (ms) when the run was spawned. */
  startedAt: number;
  /**
   * Unix timestamp (ms) of the last stdout activity.
   * Reset on every successful `[PHASE_STREAM]` event to prevent idle timeout on
   * legitimately slow phases.
   */
  lastEventAt: number;
  /** Active ReadableStream controllers receiving broadcasted SSE events. */
  controllers: Set<StreamController>;
  /**
   * setInterval handle for the idle-timeout check (runs every 30 s).
   * Must be cleared in terminateRun() to prevent zombie timers.
   */
  idleTimer: ReturnType<typeof setInterval>;
  /**
   * setTimeout handle for SIGTERM when all SSE controllers disconnect.
   * Cleared by addController() if a new client reconnects before the delay fires.
   */
  orphanTimer?: ReturnType<typeof setTimeout>;
}

/** Map of runId → ActiveRun for all in-progress workflow runs. */
export const activeRuns = new Map<string, ActiveRun>();

/**
 * Secondary index: sessionId → runId.
 * Kept in sync with activeRuns to support O(1) idempotency checks in startRun()
 * and getRunIdForSession() without scanning all activeRuns.
 */
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
  if (line.includes('failed:') || line.includes('Rate limit rejected')) {
    const errorEvent: PhaseEvent = {
      event_type: 'error',
      phase: line.match(/Phase '([^']+)' failed/)?.[1],
      message: line,
    };
  
    const id = `${runId}-${Date.now()}`;
    broadcast(formatSseEvent(errorEvent, id));
    return;
  }
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

  run.history.push(payload);

  const encoder = new TextEncoder();
  for (const ctrl of run.controllers) {
    try {
      ctrl.enqueue(encoder.encode(payload));
    } catch {
      // Controller closed — ignore
    }
  }

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
    history: [],
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

  // Drain stderr in the background to prevent the OS pipe buffer from filling
  // and deadlocking stdout (Node.js pipes are bounded at ~64 KB).
  proc.stderr?.on('data', (_chunk: Buffer) => {
    // Intentionally discarded — stderr is kvr's internal diagnostic output.
    // Draining keeps the pipe from filling and deadlocking stdout.
  });

  // Delay termination by 2 s to let in-flight stdout lines reach their readline
  // handler before we remove the run from activeRuns and close controllers.
  proc.on('close', (_code, _signal) => {
    setTimeout(() => terminateRun(runId), 2000);
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

  const encoder = new TextEncoder();
  for (const payload of run.history) {
    try {
      ctrl.enqueue(encoder.encode(payload));
    } catch {
      // Controller closed — ignore
    }
  }
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
