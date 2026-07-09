//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

/**
 * LanguageSwitcher — compact locale-select dropdown.
 *
 * Reads the current locale from LanguageContext and calls setLocale on change,
 * which persists the selection to localStorage and re-renders the tree with the
 * new message catalog.
 *
 * Language names are intentionally always rendered in the language itself
 * ("English" / "Español") so users can find their language regardless of the
 * current active locale.
 */

import { useLanguage, SUPPORTED_LOCALES, type Locale } from '@/contexts/language-context';
import { useTranslation } from '@/hooks/use-translation';

/** Always display language names in the language itself, not the active locale. */
const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
};

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLanguage();
  const { t } = useTranslation();

  return (
    <select
      value={locale}
      onChange={(e) => setLocale(e.target.value as Locale)}
      aria-label={t('lang_select_aria')}
      className="bg-slate-800 text-slate-200 rounded-md px-2 py-1 text-sm border border-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-slate-950"
    >
      {SUPPORTED_LOCALES.map((loc) => (
        <option key={loc} value={loc}>
          {LOCALE_LABELS[loc]}
        </option>
      ))}
    </select>
  );
}
