/**
 * Copyright 2025 Kealu Inc. All rights reserved.
 * Licensed under the Kealu Vector License v1.0 — PATENT PENDING
 */

/**
 * i18n module — message catalogs, type utilities, and lookup function.
 *
 * Design: catalogs are plain `as const` objects so the compiler enforces
 * key parity between locales (es.ts is typed as `typeof en`).  The `t()`
 * function is a thin key-lookup — callers do any string interpolation
 * they need after the call.
 */

import en from './messages/en';
import es from './messages/es';
import zhCN from './messages/zh-CN';

/** Shape of a message catalog — derived from the English catalog, the source of truth. */
export type Messages = typeof en;

/** Supported locale codes. Kept in sync with SUPPORTED_LOCALES in language-context.tsx. */
export type Locale = 'en' | 'es' | 'zh-CN';

/** Map of every supported locale to its catalog. */
export const messages: Record<Locale, Messages> = { en, es, 'zh-CN': zhCN };

/**
 * Look up a translation by key in the given catalog.
 *
 * Falls back to the key string itself when the key is absent, so the UI
 * always renders something meaningful and never throws.
 *
 * @param msgs  The catalog for the current locale (pass `messages[locale]`).
 * @param key   A key from Messages, or any arbitrary string.
 */
export function t(msgs: Messages, key: keyof Messages | string): string {
  return (msgs as Record<string, string>)[key] ?? key;
}
