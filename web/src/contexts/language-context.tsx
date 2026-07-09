//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

/**
 * Language context — browser-locale detection, localStorage override, and
 * document.documentElement.lang synchronisation.
 *
 * Priority: localStorage override ('kbn-locale') > navigator.language > 'en'
 *
 * Wrapping the app in <LanguageProvider> makes `useLanguage()` available to
 * every client component.  `detectBrowserLocale()` is exported as a pure
 * function so it can be unit-tested without mounting a React tree.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import { messages as allMessages } from '@/i18n';
import type { Messages } from '@/i18n';

export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** localStorage key used to persist the user's manual language choice. */
const STORAGE_KEY = 'kbn-locale';

/** Cookie max-age in seconds (1 year). */
const LOCALE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * Write the locale to a first-party cookie so the Next.js server component
 * (page.tsx) can read it on subsequent requests and render page-level strings
 * in the right language (server components cannot access React context).
 *
 * The cookie is NOT HttpOnly so we can set it from JavaScript, but it IS
 * SameSite=Strict to prevent CSRF.  It carries no sensitive data.
 */
function writeLocaleCookie(locale: Locale): void {
  document.cookie = `${STORAGE_KEY}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Strict`;
}

/**
 * Determine the user's preferred locale.
 *
 * Reads from localStorage first (manual override wins over browser default),
 * then falls back to `navigator.language`, then to 'en'.
 * Region subtags are stripped ('en-US' → 'en').
 */
export function detectBrowserLocale(): Locale {
  // Manual override stored by setLocale wins over auto-detection.
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as Locale;
    }
  }

  // Auto-detect from the browser's preferred language.
  if (typeof navigator !== 'undefined' && navigator.language) {
    const lang = navigator.language.split('-')[0].toLowerCase();
    if ((SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
      return lang as Locale;
    }
  }

  return 'en';
}

interface LanguageContextValue {
  /** Current active locale. */
  locale: Locale;
  /** Switch to a new locale; persists the choice to localStorage. */
  setLocale: (locale: Locale) => void;
  /** Pre-resolved message catalog for the current locale. */
  msgs: Messages;
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: 'en',
  setLocale: () => undefined,
  msgs: allMessages.en,
});

/**
 * LanguageProvider — wrap the component tree to make language state available.
 *
 * Initialises with 'en' on the server (SSR) and then updates to the
 * detected/stored locale on the client after hydration.
 * `suppressHydrationWarning` on `<html>` prevents the expected lang-attr mismatch.
 */
export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  // Detect the locale once on mount — runs client-side only, after hydration.
  // Also mirrors the detected locale to a cookie so the server component can
  // read it on the next request (the very first server render is always 'en'
  // since no cookie exists yet, but subsequent loads pick up the cookie).
  useEffect(() => {
    const detected = detectBrowserLocale();
    writeLocaleCookie(detected);
    setLocaleState(detected);
  }, []);

  // Keep document.documentElement.lang in sync with the active locale.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function setLocale(newLocale: Locale) {
    localStorage.setItem(STORAGE_KEY, newLocale);
    // Mirror to cookie so server component reads the updated locale on next request.
    writeLocaleCookie(newLocale);
    setLocaleState(newLocale);
  }

  return (
    <LanguageContext.Provider value={{ locale, setLocale, msgs: allMessages[locale] }}>
      {children}
    </LanguageContext.Provider>
  );
}

/** Access the current locale, setLocale, and resolved message catalog. */
export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
