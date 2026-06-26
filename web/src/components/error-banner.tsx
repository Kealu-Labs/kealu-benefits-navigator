//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

interface ErrorBannerProps {
  message: string;
  correlationId?: string;
  onRetry: () => void;
}

/** Inline amber error banner with optional correlation ID and retry button. */
export default function ErrorBanner({ message, correlationId, onRetry }: ErrorBannerProps) {
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
      <div className="mt-3 flex">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
