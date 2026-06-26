/**
 * Unit tests for web/src/lib/kvr-checker.ts
 *
 * These tests FAIL before implementation (module does not exist).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// These imports fail until web/src/lib/kvr-checker.ts is created.
import {
  parseSemver,
  compareSemver,
  resolveKvr,
  checkKvrVersion,
  checkCmsApiKey,
  logStartupChecks,
  MIN_KVR_VERSION,
} from '@/lib/kvr-checker';

vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from 'child_process';
const mockSpawnSync = vi.mocked(spawnSync);

describe('MIN_KVR_VERSION', () => {
  it('is 0.114.13', () => {
    expect(MIN_KVR_VERSION).toBe('0.114.13');
  });
});

describe('parseSemver()', () => {
  it("parses '0.114.13' → [0, 114, 13]", () => {
    expect(parseSemver('0.114.13')).toEqual([0, 114, 13]);
  });

  it("parses '0.225.0' → [0, 225, 0]", () => {
    expect(parseSemver('0.225.0')).toEqual([0, 225, 0]);
  });

  it("parses '1.0.0' → [1, 0, 0]", () => {
    expect(parseSemver('1.0.0')).toEqual([1, 0, 0]);
  });

  it("throws on 'garbage'", () => {
    expect(() => parseSemver('garbage')).toThrow();
  });

  it("throws on empty string", () => {
    expect(() => parseSemver('')).toThrow();
  });
});

describe('compareSemver()', () => {
  it('returns positive when a > b (patch)', () => {
    expect(compareSemver([0, 114, 13], [0, 114, 12])).toBeGreaterThan(0);
  });

  it('returns 0 when a === b', () => {
    expect(compareSemver([0, 114, 13], [0, 114, 13])).toBe(0);
  });

  it('returns negative when a < b (minor)', () => {
    expect(compareSemver([0, 113, 99], [0, 114, 0])).toBeLessThan(0);
  });

  it('returns negative when a < b (major)', () => {
    expect(compareSemver([0, 225, 0], [1, 0, 0])).toBeLessThan(0);
  });

  it('handles large version numbers correctly', () => {
    expect(compareSemver([0, 225, 0], [0, 114, 13])).toBeGreaterThan(0);
  });
});

describe('resolveKvr()', () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  it('returns the kvr path when which/where succeeds', () => {
    mockSpawnSync.mockReturnValue({
      stdout: Buffer.from('/usr/local/bin/kvr\n'),
      status: 0,
      stderr: Buffer.from(''),
      pid: 1,
      output: [],
      signal: null,
      error: undefined,
    } as any);
    const result = resolveKvr();
    expect(result).toBe('/usr/local/bin/kvr');
  });

  it('returns null when kvr is not found', () => {
    mockSpawnSync.mockReturnValue({
      stdout: Buffer.from(''),
      status: 1,
      stderr: Buffer.from(''),
      pid: 1,
      output: [],
      signal: null,
      error: undefined,
    } as any);
    const result = resolveKvr();
    expect(result).toBeNull();
  });

  it('returns null when spawnSync throws', () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = resolveKvr();
    expect(result).toBeNull();
  });
});

describe('checkKvrVersion()', () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  it('returns ok:false with error:"not found" when kvr is absent', () => {
    // First call (which kvr) returns empty → absent
    mockSpawnSync.mockReturnValue({
      stdout: Buffer.from(''),
      status: 1,
      stderr: Buffer.from(''),
      pid: 1,
      output: [],
      signal: null,
      error: undefined,
    } as any);
    const result = checkKvrVersion();
    expect(result.ok).toBe(false);
    expect(result.version).toBe('');
    expect(result.error).toMatch(/not found/i);
  });

  it('returns ok:true when version is above minimum', () => {
    // First call (which kvr) succeeds; second call (kvr --version) returns version string
    mockSpawnSync
      .mockReturnValueOnce({
        stdout: Buffer.from('/usr/local/bin/kvr\n'),
        status: 0,
        stderr: Buffer.from(''),
        pid: 1,
        output: [],
        signal: null,
        error: undefined,
      } as any)
      .mockReturnValueOnce({
        stdout: Buffer.from('kvr 0.225.0\n'),
        status: 0,
        stderr: Buffer.from(''),
        pid: 1,
        output: [],
        signal: null,
        error: undefined,
      } as any);
    const result = checkKvrVersion();
    expect(result.ok).toBe(true);
    expect(result.version).toBe('0.225.0');
    expect(result.path).toBe('/usr/local/bin/kvr');
  });

  it('returns ok:false when version is below minimum (0.113.0)', () => {
    mockSpawnSync
      .mockReturnValueOnce({
        stdout: Buffer.from('/usr/local/bin/kvr\n'),
        status: 0,
        stderr: Buffer.from(''),
        pid: 1,
        output: [],
        signal: null,
        error: undefined,
      } as any)
      .mockReturnValueOnce({
        stdout: Buffer.from('kvr 0.113.0\n'),
        status: 0,
        stderr: Buffer.from(''),
        pid: 1,
        output: [],
        signal: null,
        error: undefined,
      } as any);
    const result = checkKvrVersion();
    expect(result.ok).toBe(false);
    expect(result.version).toBe('0.113.0');
  });
});

describe('checkCmsApiKey()', () => {
  afterEach(() => {
    delete process.env.CMS_API_KEY;
  });

  it('returns false when CMS_API_KEY is absent', () => {
    delete process.env.CMS_API_KEY;
    expect(checkCmsApiKey()).toBe(false);
  });

  it('returns false when CMS_API_KEY is an empty string', () => {
    process.env.CMS_API_KEY = '';
    expect(checkCmsApiKey()).toBe(false);
  });

  it('returns false when CMS_API_KEY is whitespace only', () => {
    process.env.CMS_API_KEY = '   ';
    expect(checkCmsApiKey()).toBe(false);
  });

  it('returns true when CMS_API_KEY is set to a non-empty value', () => {
    process.env.CMS_API_KEY = 'test-key-abc123';
    expect(checkCmsApiKey()).toBe(true);
  });
});

describe('logStartupChecks()', () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CMS_API_KEY;
  });

  it('calls console.warn when kvr is absent', () => {
    mockSpawnSync.mockReturnValue({
      stdout: Buffer.from(''),
      status: 1,
      stderr: Buffer.from(''),
      pid: 1,
      output: [],
      signal: null,
      error: undefined,
    } as any);
    process.env.CMS_API_KEY = 'key'; // avoid CMS warning
    logStartupChecks();
    expect(console.warn).toHaveBeenCalledTimes(1);
    const warnArg = (console.warn as any).mock.calls[0][0] as string;
    const parsed = JSON.parse(warnArg);
    expect(parsed.level).toBe('warn');
    expect(parsed.event).toBe('startup_check_failed');
  });

  it('calls console.warn when CMS_API_KEY is absent', () => {
    // kvr found and up to date
    mockSpawnSync
      .mockReturnValueOnce({ stdout: Buffer.from('/usr/local/bin/kvr\n'), status: 0, stderr: Buffer.from(''), pid: 1, output: [], signal: null, error: undefined } as any)
      .mockReturnValueOnce({ stdout: Buffer.from('kvr 0.225.0\n'), status: 0, stderr: Buffer.from(''), pid: 1, output: [], signal: null, error: undefined } as any);
    delete process.env.CMS_API_KEY;
    logStartupChecks();
    expect(console.warn).toHaveBeenCalledTimes(1);
    const warnArg = (console.warn as any).mock.calls[0][0] as string;
    const parsed = JSON.parse(warnArg);
    expect(parsed.level).toBe('warn');
  });

  it('does not call console.warn when all checks pass', () => {
    mockSpawnSync
      .mockReturnValueOnce({ stdout: Buffer.from('/usr/local/bin/kvr\n'), status: 0, stderr: Buffer.from(''), pid: 1, output: [], signal: null, error: undefined } as any)
      .mockReturnValueOnce({ stdout: Buffer.from('kvr 0.225.0\n'), status: 0, stderr: Buffer.from(''), pid: 1, output: [], signal: null, error: undefined } as any);
    process.env.CMS_API_KEY = 'test-key';
    logStartupChecks();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
