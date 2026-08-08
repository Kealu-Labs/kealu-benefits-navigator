//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

import { useTranslation } from '@/hooks/use-translation';

interface ErrorBannerProps {
  message: string;
  correlationId?: string;
  onRetry: () => void;
  /** Optional secondary action (e.g. "Edit my information"). */
  onSecondary?: () => void;
  /**
   * Label for the secondary action button.
   * When omitted, falls back to the translated "Edit my information" string.
   */
  secondaryLabel?: string;
}

/** Inline amber error banner with optional correlation ID, retry, and secondary action. */
export default function ErrorBanner({
  message,
  correlationId,
  onRetry,
  onSecondary,
  secondaryLabel,
}: ErrorBannerProps) {
  const { t } = useTranslation();
  const resolvedSecondaryLabel = secondaryLabel ?? t('error_edit_info');

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="mt-0.5 shrink-0 text-amber-500">⚠</span>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm leading-snug">{message}</p>
          {correlationId && (
            <p className="text-xs text-amber-700 mt-1 font-mono break-all">
              Error ID: {correlationId}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 transition-colors"
        >
          {t('error_try_again')}
        </button>
        {onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 transition-colors"
          >
            {resolvedSecondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
