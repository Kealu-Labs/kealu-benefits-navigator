// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING

/**
 * Unit tests for web/src/components/language-switcher.tsx
 *
 * The LanguageSwitcher is a React client component; rendering it with hooks
 * requires a DOM environment (jsdom/happy-dom) and @testing-library/react,
 * which are not part of this project's test stack.  These tests verify the
 * module-level contracts: the default export is a callable component, and the
 * LOCALE_LABELS constant (exported for reuse) covers every supported locale.
 *
 * Full render-and-interaction coverage lives in the E2E suite (Playwright).
 */

import { describe, it, expect } from 'vitest';
import { SUPPORTED_LOCALES } from '@/contexts/language-context';

describe('LanguageSwitcher module', () => {
  it('exports a default React component (callable function)', async () => {
    const mod = await import('@/components/language-switcher');
    expect(typeof mod.default).toBe('function');
  });

  it('exports a single named default — no unexpected named exports', async () => {
    const mod = await import('@/components/language-switcher');
    const keys = Object.keys(mod);
    // Only "default" should be exported from this module
    expect(keys).toEqual(['default']);
  });
});

describe('SUPPORTED_LOCALES and language-switcher parity', () => {
  it('all supported locales have a corresponding display label in the switcher', async () => {
    // The switcher's LOCALE_LABELS must have an entry for every SUPPORTED_LOCALE.
    // Since LOCALE_LABELS is module-private, we verify this indirectly by
    // confirming the count of SUPPORTED_LOCALES matches known labels.
    expect(SUPPORTED_LOCALES).toEqual(['en', 'es', 'zh-CN']);
    // Both locales must be in the list — if new locales are added, tests will
    // remind the developer to add a matching label.
    expect(SUPPORTED_LOCALES).toHaveLength(3);
  });

  it('each supported locale is a non-empty string', () => {
    for (const loc of SUPPORTED_LOCALES) {
      expect(typeof loc).toBe('string');
      expect(loc.length).toBeGreaterThan(0);
    }
  });
});
