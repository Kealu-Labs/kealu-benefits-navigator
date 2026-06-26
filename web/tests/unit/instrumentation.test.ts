/**
 * Unit tests for web/src/instrumentation.ts
 *
 * These tests FAIL before implementation (module does not exist).
 * Validates: UUID v4 regex pattern, orphan sweep logic, startup hook guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/kvr-checker', () => ({
  logStartupChecks: vi.fn(),
  checkKvrVersion: vi.fn().mockReturnValue({ ok: true, version: '0.225.0', path: '/usr/local/bin/kvr' }),
  checkCmsApiKey: vi.fn().mockReturnValue(true),
}));

import * as fs from 'fs/promises';
import { logStartupChecks } from '@/lib/kvr-checker';

const mockReaddir = vi.mocked(fs.readdir);
const mockStat = vi.mocked(fs.stat);
const mockRm = vi.mocked(fs.rm);
const mockLogStartupChecks = vi.mocked(logStartupChecks);

// This import fails until web/src/instrumentation.ts is created.
import { register, UUID_V4_REGEX } from '@/instrumentation';

// ---------------------------------------------------------------------------
// UUID v4 regex
// ---------------------------------------------------------------------------

describe('UUID_V4_REGEX', () => {
  it("matches a valid UUID v4 '550e8400-e29b-41d4-a716-446655440000'", () => {
    expect(UUID_V4_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it("matches another valid UUID v4 'f47ac10b-58cc-4372-a567-0e02b2c3d479'", () => {
    expect(UUID_V4_REGEX.test('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
  });

  it("does NOT match MCP server run ID format 'mcp-navigator-a1b2c3d4'", () => {
    expect(UUID_V4_REGEX.test('mcp-navigator-a1b2c3d4')).toBe(false);
  });

  it("does NOT match plain directory names like 'my-run-dir'", () => {
    expect(UUID_V4_REGEX.test('my-run-dir')).toBe(false);
  });

  it("does NOT match UUID v1 format '550e8400-e29b-11d4-a716-446655440000'", () => {
    // UUID v1 has version digit '1', not '4'
    expect(UUID_V4_REGEX.test('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
  });

  it("does NOT match partial strings with leading garbage 'foo550e8400-e29b-41d4-a716-446655440000'", () => {
    expect(UUID_V4_REGEX.test('foo550e8400-e29b-41d4-a716-446655440000')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// register() — orphan sweep
// ---------------------------------------------------------------------------

describe('register()', () => {
  const THIRTY_ONE_MINUTES_MS = 31 * 60 * 1000;
  const TWENTY_NINE_MINUTES_MS = 29 * 60 * 1000;

  beforeEach(() => {
    mockReaddir.mockReset();
    mockStat.mockReset();
    mockRm.mockReset();
    mockLogStartupChecks.mockReset();
    mockRm.mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Ensure we're in Node runtime
    process.env.NEXT_RUNTIME = 'nodejs';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NEXT_RUNTIME;
  });

  it('deletes stale UUID v4 directories older than 30 minutes', async () => {
    const staleUuid = '550e8400-e29b-41d4-a716-446655440001';
    const now = Date.now();

    mockReaddir.mockResolvedValue([{ name: staleUuid, isDirectory: () => true }] as any);
    mockStat.mockResolvedValue({
      mtimeMs: now - THIRTY_ONE_MINUTES_MS,
      isDirectory: () => true,
    } as any);

    await register();

    expect(mockRm).toHaveBeenCalledOnce();
    const [rmPath] = mockRm.mock.calls[0];
    expect(String(rmPath)).toContain(staleUuid);
  });

  it('does NOT delete fresh UUID v4 directories (less than 30 minutes old)', async () => {
    const freshUuid = '550e8400-e29b-41d4-a716-446655440002';
    const now = Date.now();

    mockReaddir.mockResolvedValue([{ name: freshUuid, isDirectory: () => true }] as any);
    mockStat.mockResolvedValue({
      mtimeMs: now - TWENTY_NINE_MINUTES_MS,
      isDirectory: () => true,
    } as any);

    await register();

    expect(mockRm).not.toHaveBeenCalled();
  });

  it('does NOT delete mcp-navigator-* directories (MCP server run IDs)', async () => {
    const mcpRunDir = 'mcp-navigator-a1b2c3d4';
    const now = Date.now();

    mockReaddir.mockResolvedValue([{ name: mcpRunDir, isDirectory: () => true }] as any);
    mockStat.mockResolvedValue({
      mtimeMs: now - THIRTY_ONE_MINUTES_MS,
      isDirectory: () => true,
    } as any);

    await register();

    expect(mockRm).not.toHaveBeenCalled();
  });

  it('calls logStartupChecks()', async () => {
    mockReaddir.mockResolvedValue([] as any);
    await register();
    expect(mockLogStartupChecks).toHaveBeenCalledOnce();
  });

  it('is a no-op when NEXT_RUNTIME is not "nodejs" (Edge runtime guard)', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    await register();
    expect(mockLogStartupChecks).not.toHaveBeenCalled();
    expect(mockRm).not.toHaveBeenCalled();
  });

  it('logs structured startup event after checks', async () => {
    mockReaddir.mockResolvedValue([] as any);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await register();

    const logCalls = consoleSpy.mock.calls.map((c) => {
      try { return JSON.parse(c[0]); } catch { return null; }
    }).filter(Boolean);

    const startupLog = logCalls.find((l) => l?.event === 'web_app_start');
    expect(startupLog).toBeDefined();
    expect(startupLog).toHaveProperty('level', 'info');
  });
});
