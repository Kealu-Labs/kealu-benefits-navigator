//
// Copyright 2026 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Two-sink logging.
 *
 * Every log line this app emits belongs to exactly one of two channels:
 *
 *   - `diagnostic` — safe to leave the instance. Shipped to whoever is
 *     debugging, including contributors who have no access to the server.
 *     PII-free **by construction**: fields not named in DIAGNOSTIC_FIELDS are
 *     dropped, not filtered.
 *   - `session` — never leaves the instance. Anything derived from an
 *     applicant's answers belongs here, including free-form subprocess output.
 *
 * Why an allowlist rather than a redaction filter: the previous approach
 * (`sanitizeFailureOutput`) is a carefully-written denylist that still catches
 * no applicant data, because you cannot enumerate what a surname, a medication
 * or an address looks like inside arbitrary text. A denylist fails open on
 * exactly the data that matters. This fails closed.
 *
 * The app guarantees the *content* property of each channel. Physically routing
 * them to different destinations is a deploy concern — split on `channel`.
 */

/**
 * The only field names permitted on the diagnostic channel.
 *
 * Adding a name here is a privacy decision, not a formatting one: it asserts
 * the field can never carry applicant data. Anything derived from an
 * applicant's answers — including a value that merely *might* be, such as an
 * exception message — does not belong on this list.
 */
const DIAGNOSTIC_FIELDS = [
  'level',
  'event',
  'channel',
  'runId',
  'route',
  'phase',
  'errorClass',
  'errorCode',
  'failureCode',
  'publicCode',
  'stackFrames',
  'exitCode',
  'signal',
  'durationMs',
  'count',
  'runtime',
  'nodeVersion',
  'kvrVersion',
  'source',
  'resolved',
  'ok',
] as const;

export type DiagnosticField = (typeof DIAGNOSTIC_FIELDS)[number];

const DIAGNOSTIC_FIELD_SET: ReadonlySet<string> = new Set(DIAGNOSTIC_FIELDS);

export type LogValue = string | number | boolean | null | undefined | readonly (string | number)[];

/** Fields dropped by the allowlist, reported so a miswired call site is visible. */
export interface DiagnosticResult {
  emitted: Record<string, LogValue>;
  dropped: string[];
}

/**
 * Reduce a thrown value to something the diagnostic channel can carry.
 *
 * The constructor name and the stack *frames* are structural. `error.message`
 * is NOT included: messages routinely embed the offending value ("invalid
 * income: 41200", "no such applicant: Maria Ruiz"), which is precisely the
 * data this channel must never carry.
 */
export function toDiagnosticError(err: unknown): {
  errorClass: string;
  stackFrames: string[];
} {
  if (!(err instanceof Error)) {
    return { errorClass: typeof err, stackFrames: [] };
  }

  const frames = (err.stack ?? '')
    .split('\n')
    // Keep only true frame lines ("    at fn (file:1:2)"). The first stack line
    // is "ErrorClass: message" and is deliberately discarded.
    .filter((line) => /^\s*at\s/.test(line))
    .map((line) => line.trim());

  return { errorClass: err.constructor?.name ?? 'Error', stackFrames: frames };
}

/** Apply the allowlist. Exported for tests and for call sites that need the drop list. */
export function applyDiagnosticAllowlist(
  fields: Record<string, unknown>,
): DiagnosticResult {
  const emitted: Record<string, LogValue> = {};
  const dropped: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (!DIAGNOSTIC_FIELD_SET.has(key)) {
      dropped.push(key);
      continue;
    }
    emitted[key] = value as LogValue;
  }

  return { emitted, dropped };
}

/**
 * Emit on the diagnostic channel. Unknown fields are dropped rather than
 * emitted, and the dropped names (names only, never values) are reported on
 * `_droppedFields` so a miswired call site shows up in review instead of
 * silently losing data.
 */
export function logDiagnostic(
  event: string,
  fields: Record<string, unknown> = {},
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  const { emitted, dropped } = applyDiagnosticAllowlist(fields);

  const payload: Record<string, unknown> = {
    level,
    channel: 'diagnostic',
    event,
    ...emitted,
  };

  if (dropped.length > 0) payload._droppedFields = dropped.sort();

  console.log(JSON.stringify(payload));
}

/**
 * Emit on the session channel. NOT allowlisted — this is where applicant-derived
 * content is allowed to go, which is exactly why it must never leave the box.
 */
export function logSession(
  event: string,
  fields: Record<string, unknown> = {},
  level: 'info' | 'warn' | 'error' = 'info',
): void {
  console.log(JSON.stringify({ level, channel: 'session', event, ...fields }));
}

/** Exported for tests asserting the allowlist has not silently grown. */
export const _DIAGNOSTIC_FIELDS = DIAGNOSTIC_FIELDS;
