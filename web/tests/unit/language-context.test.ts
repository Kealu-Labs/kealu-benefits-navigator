// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING

/**
 * Unit tests for web/src/contexts/language-context.tsx
 *
 * Tests the exported pure-function surface: SUPPORTED_LOCALES and
 * detectBrowserLocale().  React hooks (useLanguage, LanguageProvider) require
 * a DOM/React environment and are covered by integration/E2E tests.
 *
 * detectBrowserLocale() reads from `localStorage` and `navigator.language`,
 * both of which are undefined in Node.js by default.  We stub them with
 * vi.stubGlobal so the function's branch logic is exercised.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub types so TypeScript accepts our mocks
type FakeStorage = {
  _store: Record<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};

const fakeLocalStorage: FakeStorage = {
  _store: {},
  getItem(key: string) {
    return Object.prototype.hasOwnProperty.call(this._store, key) ? this._store[key] : null;
  },
  setItem(key: string, value: string) {
    this._store[key] = value;
  },
  removeItem(key: string) {
    delete this._store[key];
  },
  clear() {
    this._store = {};
  },
};

const fakeNavigator = { language: 'en-US' };

describe('SUPPORTED_LOCALES', () => {
  it('exports the en locale', async () => {
    const { SUPPORTED_LOCALES } = await import('@/contexts/language-context');
    expect(SUPPORTED_LOCALES).toContain('en');
  });

  it('exports the es locale', async () => {
    const { SUPPORTED_LOCALES } = await import('@/contexts/language-context');
    expect(SUPPORTED_LOCALES).toContain('es');
  });

  it('contains exactly 3 supported locales', async () => {
    const { SUPPORTED_LOCALES } = await import('@/contexts/language-context');
    expect(SUPPORTED_LOCALES).toHaveLength(3);
  });
});

describe('detectBrowserLocale()', () => {
  beforeEach(() => {
  fakeLocalStorage.clear();
  fakeNavigator.language = 'en-US';
  vi.stubGlobal('localStorage', fakeLocalStorage);
  vi.stubGlobal('navigator', fakeNavigator);
});

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects "en" from navigator.language "en-US"', async () => {
    fakeNavigator.language = 'en-US';
    const { detectBrowserLocale } = await import('@/contexts/language-context');
    expect(detectBrowserLocale()).toBe('en');
  });

  it('detects "es" from navigator.language "es-MX"', async () => {
    fakeNavigator.language = 'es-MX';
    const { detectBrowserLocale } = await import('@/contexts/language-context');
    expect(detectBrowserLocale()).toBe('es');
  });

  it('detects "es" from navigator.language bare "es"', async () => {
    fakeNavigator.language = 'es';
    const { detectBrowserLocale } = await import('@/contexts/language-context');
    expect(detectBrowserLocale()).toBe('es');
  });

  it('falls back to "en" when locale is unsupported (fr-FR)', async () => {
    fakeNavigator.language = 'fr-FR';
    const { detectBrowserLocale } = await import('@/contexts/language-context');
    expect(detectBrowserLocale()).toBe('en');
  });

  it('falls back to "en" when navigator.language is empty', async () => {
    fakeNavigator.language = '';
    const { detectBrowserLocale } = await import('@/contexts/language-context');
    expect(detectBrowserLocale()).toBe('en');
  });

  it('localStorage override takes precedence over navigator.language', async () => {
    fakeNavigator.language = 'en-US';
    fakeLocalStorage.setItem('kbn-locale', 'es');
    const { detectBrowserLocale } = await import('@/contexts/language-context');
    expect(detectBrowserLocale()).toBe('es');
  });

  it('ignores unsupported localStorage value and falls back to navigator', async () => {
    fakeNavigator.language = 'es-ES';
    fakeLocalStorage.setItem('kbn-locale', 'fr'); // not in SUPPORTED_LOCALES
    const { detectBrowserLocale } = await import('@/contexts/language-context');
    expect(detectBrowserLocale()).toBe('es');
  });

  it('detects Simplified Chinese from navigator.language', async () => {
  fakeNavigator.language = 'zh-CN';
  const { detectBrowserLocale } = await import('@/contexts/language-context');
  expect(detectBrowserLocale()).toBe('zh-CN');
});

it('ignores unsupported localStorage value and falls back to "en" when navigator is also unsupported', async () => {
  fakeNavigator.language = 'de-DE';
  fakeLocalStorage.setItem('kbn-locale', 'fr');
  const { detectBrowserLocale } = await import('@/contexts/language-context');
  expect(detectBrowserLocale()).toBe('en');
});

  it('returns "en" as default when localStorage is absent and navigator is undefined', async () => {
    // Restore globals to undefined so neither branch fires
    vi.unstubAllGlobals();
    const { detectBrowserLocale } = await import('@/contexts/language-context');
    expect(detectBrowserLocale()).toBe('en');
  });
});
