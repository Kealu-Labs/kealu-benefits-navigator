//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

/**
 * useTranslation — convenience hook for translating strings in client components.
 *
 * Returns a bound `t(key)` function that looks up the key in the current
 * locale's message catalog.  Falls back to the key itself when missing so
 * the UI always renders something meaningful.
 *
 * Usage:
 *   const { t } = useTranslation();
 *   <button>{t('chat_send')}</button>
 */

import { useLanguage } from '@/contexts/language-context';
import { t as tFn } from '@/i18n';
import type { Messages } from '@/i18n';

export function useTranslation() {
  const { msgs } = useLanguage();
  return {
    /** Translate a message key to the current locale's string. */
    t: (key: keyof Messages | string): string => tFn(msgs, key),
  };
}
