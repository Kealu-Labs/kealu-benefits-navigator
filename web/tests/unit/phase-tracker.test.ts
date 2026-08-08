/**
 * Unit tests for web/src/components/phase-tracker.tsx
 *
 * The PhaseTracker is a React client component using browser APIs (EventSource, fetch).
 * Full render-and-interaction coverage requires a DOM environment and
 * @testing-library/react, which are not part of this project's test stack.
 *
 * These tests verify:
 * - Module-level contracts (exports are callable React components)
 * - i18n message key parity (new error_stream_* keys exist in all locales)
 * - Logic-level invariants that don't require DOM rendering
 *
 * Full render-and-interaction coverage lives in the E2E suite (Playwright).
 */
import { describe, it, expect } from 'vitest';

// ── Module-level contract ──────────────────────────────────────────────────

describe('PhaseTracker module', () => {
  it('exports a default React component (callable function)', async () => {
    const mod = await import('@/components/phase-tracker');
    expect(typeof mod.default).toBe('function');
  });

  it('exports only the default export — no unexpected named exports', async () => {
    const mod = await import('@/components/phase-tracker');
    const keys = Object.keys(mod);
    expect(keys).toEqual(['default']);
  });
});

// ── i18n parity: error_stream_* keys present in all locales ──────────────────

describe('PhaseTracker i18n keys', () => {
  it('en.ts contains error_stream_lost key', async () => {
    const { default: en } = await import('@/i18n/messages/en');
    expect(typeof (en as Record<string, string>).error_stream_lost).toBe('string');
    expect((en as Record<string, string>).error_stream_lost.length).toBeGreaterThan(0);
  });

  it('en.ts contains error_stream_connect_failed key', async () => {
    const { default: en } = await import('@/i18n/messages/en');
    expect(typeof (en as Record<string, string>).error_stream_connect_failed).toBe('string');
    expect((en as Record<string, string>).error_stream_connect_failed.length).toBeGreaterThan(0);
  });

  it('es.ts contains error_stream_lost and error_stream_connect_failed keys', async () => {
    const { default: es } = await import('@/i18n/messages/es');
    const esMsgs = es as Record<string, string>;
    expect(typeof esMsgs.error_stream_lost).toBe('string');
    expect(typeof esMsgs.error_stream_connect_failed).toBe('string');
  });

  it('zh-CN.ts contains error_stream_lost and error_stream_connect_failed keys', async () => {
    const { default: zhCN } = await import('@/i18n/messages/zh-CN');
    const zhMsgs = zhCN as Record<string, string>;
    expect(typeof zhMsgs.error_stream_lost).toBe('string');
    expect(typeof zhMsgs.error_stream_connect_failed).toBe('string');
  });

  it('error_stream_lost and error_stream_connect_failed are distinct messages', async () => {
    const { default: en } = await import('@/i18n/messages/en');
    const enMsgs = en as Record<string, string>;
    expect(enMsgs.error_stream_lost).not.toBe(enMsgs.error_stream_connect_failed);
  });
});

// ── i18n parity: all locales have the same keys as en.ts ─────────────────────

describe('Message catalog completeness', () => {
  it('es.ts has all the same keys as en.ts', async () => {
    const { default: en } = await import('@/i18n/messages/en');
    const { default: es } = await import('@/i18n/messages/es');
    const enKeys = Object.keys(en).sort();
    const esKeys = Object.keys(es as object).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it('zh-CN.ts has all the same keys as en.ts', async () => {
    const { default: en } = await import('@/i18n/messages/en');
    const { default: zhCN } = await import('@/i18n/messages/zh-CN');
    const enKeys = Object.keys(en).sort();
    const zhKeys = Object.keys(zhCN as object).sort();
    expect(zhKeys).toEqual(enKeys);
  });
});
