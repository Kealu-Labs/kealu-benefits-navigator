//
// Copyright 2026 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  logDiagnostic,
  logSession,
  toDiagnosticError,
  applyDiagnosticAllowlist,
  _DIAGNOSTIC_FIELDS,
} from '@/lib/telemetry';

function captureLog(fn: () => void): Record<string, unknown>[] {
  const lines: Record<string, unknown>[] = [];
  const spy = vi
    .spyOn(console, 'log')
    .mockImplementation((s: string) => void lines.push(JSON.parse(s)));
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

afterEach(() => vi.restoreAllMocks());

describe('diagnostic allowlist', () => {
  it('drops applicant fields rather than emitting them', () => {
    const [line] = captureLog(() =>
      logDiagnostic('workflow_failed', {
        runId: 'run-1',
        exitCode: 1,
        annual_income: 41200,
        medications: ['metformin'],
        household_profile: 'single parent, 2 children',
        zip_code: '78701',
      }),
    );

    expect(line.runId).toBe('run-1');
    expect(line.exitCode).toBe(1);

    // The values must be absent entirely, not masked.
    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain('41200');
    expect(serialized).not.toContain('metformin');
    expect(serialized).not.toContain('single parent');
    expect(serialized).not.toContain('78701');
  });

  it('reports dropped field NAMES so a miswired call site is visible', () => {
    const [line] = captureLog(() =>
      logDiagnostic('x', { runId: 'r', annual_income: 41200 }),
    );
    expect(line._droppedFields).toEqual(['annual_income']);
  });

  it('fails closed on an unknown field, including a plausible-looking one', () => {
    const { emitted, dropped } = applyDiagnosticAllowlist({
      // Not on the list: reads harmless, could carry a free-form applicant string.
      message: 'no such applicant: Maria Ruiz',
      detail: '123 Main St',
      runId: 'ok',
    });
    expect(emitted).toEqual({ runId: 'ok' });
    expect(dropped.sort()).toEqual(['detail', 'message']);
  });

  it('tags the channel so a deploy can route the two apart', () => {
    const [d] = captureLog(() => logDiagnostic('e'));
    const [s] = captureLog(() => logSession('e'));
    expect(d.channel).toBe('diagnostic');
    expect(s.channel).toBe('session');
  });

  it('lets the session channel carry applicant content unfiltered', () => {
    const [line] = captureLog(() =>
      logSession('intake_answer', { annual_income: 41200 }),
    );
    expect(line.annual_income).toBe(41200);
  });
});

describe('toDiagnosticError', () => {
  it('keeps the class and frames but NEVER the message', () => {
    const err = new RangeError('invalid income: 41200 for Maria Ruiz');
    const out = toDiagnosticError(err);

    expect(out.errorClass).toBe('RangeError');
    expect(out.stackFrames.length).toBeGreaterThan(0);
    expect(out.stackFrames.every((f) => f.startsWith('at '))).toBe(true);

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('41200');
    expect(serialized).not.toContain('Maria Ruiz');
    expect(serialized).not.toContain('invalid income');
  });

  it('handles a non-Error throw without leaking its content', () => {
    const out = toDiagnosticError({ ssn: '123-45-6789' });
    expect(out.errorClass).toBe('object');
    expect(JSON.stringify(out)).not.toContain('123-45-6789');
  });

  it('survives an error with no stack', () => {
    const err = new Error('boom');
    err.stack = undefined;
    expect(toDiagnosticError(err).stackFrames).toEqual([]);
  });
});

describe('the allowlist itself', () => {
  it('contains no field that could carry free-form applicant text', () => {
    // A tripwire: these names are the usual carriers of unbounded strings.
    const forbidden = ['message', 'detail', 'output', 'body', 'stack', 'vars', 'answer'];
    for (const name of forbidden) {
      expect(_DIAGNOSTIC_FIELDS).not.toContain(name);
    }
  });
});
