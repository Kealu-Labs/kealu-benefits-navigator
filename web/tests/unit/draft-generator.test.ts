/**
 * Unit tests for web/src/lib/draft-generator.ts
 *
 * generateDraft() spawns a Python subprocess; child_process is mocked at the
 * system boundary. resolvePythonExec() uses resolveKvr() and fs.existsSync;
 * both are mocked to test resolution logic in isolation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process before any module imports
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock fs to control existsSync
vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

// Mock kvr-checker
vi.mock('@/lib/kvr-checker', () => ({
  resolveKvr: vi.fn().mockReturnValue('/usr/local/bin/kvr'),
}));

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolveKvr } from '@/lib/kvr-checker';
import { resolvePythonExec, generateDraft } from '@/lib/draft-generator';

const mockSpawn = vi.mocked(spawn);
const mockExistsSync = vi.mocked(existsSync);
const mockResolveKvr = vi.mocked(resolveKvr);

// Helper: build a mock child process that emits stdout, stderr, and close events
function makeMockProcess(options: {
  stdoutData?: string;
  stderrData?: string;
  exitCode?: number;
  emitError?: Error;
}) {
  const { stdoutData = '', stderrData = '', exitCode = 0, emitError } = options;

  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

  const mockProc = {
    stdout: {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (!handlers[`stdout:${event}`]) handlers[`stdout:${event}`] = [];
        handlers[`stdout:${event}`].push(cb);
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (!handlers[`stderr:${event}`]) handlers[`stderr:${event}`] = [];
        handlers[`stderr:${event}`].push(cb);
      }),
    },
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(cb);
    }),
    // Trigger events synchronously after a tick
    _trigger() {
      if (emitError) {
        handlers['error']?.forEach((cb) => cb(emitError));
        return;
      }
      if (stdoutData) {
        handlers['stdout:data']?.forEach((cb) => cb(Buffer.from(stdoutData)));
      }
      if (stderrData) {
        handlers['stderr:data']?.forEach((cb) => cb(Buffer.from(stderrData)));
      }
      handlers['close']?.forEach((cb) => cb(exitCode, null));
    },
  };

  return mockProc as any;
}

// ── resolvePythonExec() ───────────────────────────────────────────────────────

describe('resolvePythonExec()', () => {
  beforeEach(() => {
    delete process.env.KVR_PYTHON;
    mockResolveKvr.mockReturnValue('/usr/local/bin/kvr');
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    delete process.env.KVR_PYTHON;
  });

  it('returns KVR_PYTHON env var value when it is set and file exists', () => {
    process.env.KVR_PYTHON = '/custom/python';
    mockExistsSync.mockImplementation((p) => p === '/custom/python');

    const result = resolvePythonExec();
    expect(result).toBe('/custom/python');
  });

  it('derives python path from resolveKvr() dirname when KVR_PYTHON is not set', () => {
    // /usr/local/bin/kvr → dir = /usr/local/bin → python = /usr/local/bin/python
    mockExistsSync.mockImplementation((p) => p === '/usr/local/bin/python');

    const result = resolvePythonExec();
    expect(result).toBe('/usr/local/bin/python');
  });

  it('falls back to python3 when python is not found but python3 is', () => {
    mockExistsSync.mockImplementation((p) => p === '/usr/local/bin/python3');

    const result = resolvePythonExec();
    expect(result).toBe('/usr/local/bin/python3');
  });

  it('returns null when neither python nor python3 is found in kvr bin directory', () => {
    mockExistsSync.mockReturnValue(false);

    const result = resolvePythonExec();
    expect(result).toBeNull();
  });

  it('returns null when resolveKvr() returns null', () => {
    mockResolveKvr.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);

    const result = resolvePythonExec();
    expect(result).toBeNull();
  });
});

// ── generateDraft() ───────────────────────────────────────────────────────────

describe('generateDraft()', () => {
  beforeEach(() => {
    delete process.env.KVR_PYTHON;
    mockSpawn.mockReset();
    mockResolveKvr.mockReturnValue('/usr/local/bin/kvr');
    // Default: python exists
    mockExistsSync.mockImplementation((p) => p === '/usr/local/bin/python');
  });

  afterEach(() => {
    delete process.env.KVR_PYTHON;
  });

  it('returns null without throwing when Python exec is not found', async () => {
    mockExistsSync.mockReturnValue(false);
    mockResolveKvr.mockReturnValue(null);

    const result = await generateDraft(
      'test-run-1',
      { state: 'CA', zip_code: '90210' } as any,
      'workflow output',
      '/tmp/.workforce-drafts',
    );
    expect(result).toBeNull();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('returns null when subprocess exits with non-zero code', async () => {
    const mockProc = makeMockProcess({ exitCode: 1, stderrData: 'Python error' });
    mockSpawn.mockReturnValue(mockProc);

    const resultPromise = generateDraft(
      'test-run-2',
      { state: 'CA', zip_code: '90210' } as any,
      'workflow output',
      '/tmp/.workforce-drafts',
    );
    // Trigger events after the promise is awaited
    setTimeout(() => mockProc._trigger(), 0);

    const result = await resultPromise;
    expect(result).toBeNull();
  });

  it('returns null when stdout JSON parse fails', async () => {
    const mockProc = makeMockProcess({ stdoutData: 'not json', exitCode: 0 });
    mockSpawn.mockReturnValue(mockProc);

    const resultPromise = generateDraft(
      'test-run-3',
      { state: 'CA', zip_code: '90210' } as any,
      'workflow output',
      '/tmp/.workforce-drafts',
    );
    setTimeout(() => mockProc._trigger(), 0);

    const result = await resultPromise;
    expect(result).toBeNull();
  });

  it('returns null when Python helper returns an error in JSON', async () => {
    const errorPayload = JSON.stringify({ error: 'pypdf not installed' });
    const mockProc = makeMockProcess({ stdoutData: errorPayload, exitCode: 0 });
    mockSpawn.mockReturnValue(mockProc);

    const resultPromise = generateDraft(
      'test-run-4',
      { state: 'CA', zip_code: '90210' } as any,
      'workflow output',
      '/tmp/.workforce-drafts',
    );
    setTimeout(() => mockProc._trigger(), 0);

    const result = await resultPromise;
    expect(result).toBeNull();
  });

  it('returns DraftResult with path and formType on success', async () => {
    const successPayload = JSON.stringify({
      path: '/tmp/.workforce-drafts/run-ok/draft.pdf',
      form_type: 'official',
    });
    const mockProc = makeMockProcess({ stdoutData: successPayload, exitCode: 0 });
    mockSpawn.mockReturnValue(mockProc);

    const resultPromise = generateDraft(
      'test-run-ok',
      { state: 'CA', zip_code: '90210' } as any,
      'workflow output with SNAP Medi-Cal CALFRESH',
      '/tmp/.workforce-drafts',
    );
    setTimeout(() => mockProc._trigger(), 0);

    const result = await resultPromise;
    expect(result).not.toBeNull();
    expect(result!.path).toBe('/tmp/.workforce-drafts/run-ok/draft.pdf');
    expect(result!.formType).toBe('official');
  });

  it('returns DraftResult with worksheet form_type', async () => {
    const successPayload = JSON.stringify({
      path: '/tmp/.workforce-drafts/run-ws/worksheet.pdf',
      form_type: 'worksheet',
    });
    const mockProc = makeMockProcess({ stdoutData: successPayload, exitCode: 0 });
    mockSpawn.mockReturnValue(mockProc);

    const resultPromise = generateDraft(
      'test-run-ws',
      { state: 'TX', zip_code: '78701' } as any,
      'workflow output',
      '/tmp/.workforce-drafts',
    );
    setTimeout(() => mockProc._trigger(), 0);

    const result = await resultPromise;
    expect(result).not.toBeNull();
    expect(result!.formType).toBe('worksheet');
  });

  it('returns null when spawn emits an error event', async () => {
    const mockProc = makeMockProcess({ emitError: new Error('ENOENT spawn error') });
    mockSpawn.mockReturnValue(mockProc);

    const resultPromise = generateDraft(
      'test-run-spawn-err',
      { state: 'CA' } as any,
      '',
      '/tmp/.workforce-drafts',
    );
    setTimeout(() => mockProc._trigger(), 0);

    const result = await resultPromise;
    expect(result).toBeNull();
  });

  it('spawns subprocess with correct module invocation arguments', async () => {
    const successPayload = JSON.stringify({
      path: '/tmp/draft.pdf',
      form_type: 'official',
    });
    const mockProc = makeMockProcess({ stdoutData: successPayload, exitCode: 0 });
    mockSpawn.mockReturnValue(mockProc);

    const resultPromise = generateDraft(
      'test-run-args',
      { state: 'CA' } as any,
      'output',
      '/tmp/.workforce-drafts',
    );
    setTimeout(() => mockProc._trigger(), 0);
    await resultPromise;

    expect(mockSpawn).toHaveBeenCalledOnce();
    const [pythonExec, args] = mockSpawn.mock.calls[0];
    expect(typeof pythonExec).toBe('string');
    expect(args).toContain('-m');
    expect(args).toContain('benefits_navigator.generate_draft_helper');
  });
});
