//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

import { useMemo, useState } from 'react';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import ErrorBanner from './error-banner';
import { useTranslation } from '@/hooks/use-translation';
import type { ReportPayload } from '@/lib/report-assembler';

/**
 * Configure marked to open external links in a new tab.
 * Called once at module level — safe because:
 * - Client runtime: one global per browser tab.
 * - Server SSR: module is loaded once per Next.js worker process; the global marked instance
 *   is shared across concurrent SSR renders, but since this only adds a renderer (idempotent),
 *   there are no race conditions.
 *
 * Uses sanitize-html (htmlparser2-based) rather than DOMPurify, which requires window/document.
 * sanitize-html works identically in Node.js and the browser — no SSR crash.
 */
marked.use({
  renderer: {
    link({ href, text }: { href: string | null; text: string }) {
      const safe = href ?? '#';
      const isExternal = safe.startsWith('http');
      const attrs = isExternal ? ` target="_blank" rel="noopener noreferrer"` : '';
      return `<a href="${safe}"${attrs}>${text}</a>`;
    },
  },
  gfm: true,
});

/**
 * Extended allowlist beyond sanitize-html defaults.
 *
 * Headings (h1–h6): phase outputs use markdown headings for section structure.
 * Table elements: insurance plan comparisons heavily use markdown tables;
 *   ALL table sub-elements must be allowed or the rendered HTML is stripped bare.
 * div/span: needed for the `class="table-wrapper"` overflow-x container injected
 *   by renderMarkdown before sanitization.
 * details/summary: phase sections could include collapsible sub-sections.
 */
const ALLOWED_TAGS: string[] = [
  ...sanitizeHtml.defaults.allowedTags,
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'div', 'span', 'details', 'summary',
];

/** Convert markdown to sanitized HTML with table wrappers for overflow-x scrolling. */
function renderMarkdown(content: string): string {
  const raw = marked.parse(content) as string;

  // Wrap <table> elements for horizontal scrollability on narrow viewports
  const wrapped = raw
    .replace(/<table/g, '<div class="table-wrapper"><table')
    .replace(/<\/table>/g, '</table></div>');

  return sanitizeHtml(wrapped, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ['href', 'target', 'rel', 'name'],
      table: ['class'],
      th: ['scope', 'align', 'colspan'],
      td: ['align', 'colspan'],
      div: ['class'],
    },
  });
}

interface ReportViewProps {
  payload: ReportPayload;
  runId: string;
  onRetry: (newRunId: string) => void;
}

/**
 * ReportView — renders the assembled five-phase benefits report.
 *
 * - Bottom Line summary pinned above all sections.
 * - Phase sections rendered as <details> collapsibles; action-plan expanded by default.
 * - Markdown tables wrapped in overflow-x-auto containers for wide insurance comparisons.
 * - External .gov and program links rendered as target="_blank" anchors.
 * - "Run Again" triggers a new workflow run without repeating intake.
 */
export default function ReportView({ payload, runId, onRetry }: ReportViewProps) {
  const { t } = useTranslation();
  const [retryError, setRetryError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const renderedSections = useMemo(
    () =>
      payload.sections.map((section) => ({
        ...section,
        html: renderMarkdown(section.content),
      })),
    [payload.sections],
  );

  const bottomLineHtml = useMemo(
    () => (payload.bottomLine ? renderMarkdown(payload.bottomLine) : null),
    [payload.bottomLine],
  );

  async function handleRunAgain() {
    setRetryError(null);
    setIsRetrying(true);
    try {
      const res = await fetch('/api/workflow/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { runId?: string; error?: string };

      if (data.runId) {
        onRetry(data.runId);
        return;
      }
      setRetryError(data.error ?? 'Unable to start a new run.');
    } catch {
      setRetryError('Unable to start a new run. Please refresh the page.');
    } finally {
      setIsRetrying(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Bottom Line — pinned summary card ─────────────────────────────── */}
      {bottomLineHtml && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 mb-2">
            {t('report_bottom_line')}
          </p>
          <div
            className="markdown-content text-blue-900 text-sm"
            dangerouslySetInnerHTML={{ __html: bottomLineHtml }}
          />
        </div>
      )}

      {/* ── Phase sections ────────────────────────────────────────────────── */}
      {renderedSections.map((section) => (
        <details
          key={section.phaseName}
          open={section.expanded}
          className="group rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <summary className="flex cursor-pointer select-none items-center justify-between px-5 py-4 font-medium text-slate-800 hover:bg-slate-50 rounded-xl list-none">
            <span>{section.displayName}</span>
            <span className="text-xs text-slate-400 font-normal group-open:hidden">
              {t('report_expand')}
            </span>
            <span className="text-xs text-slate-400 font-normal hidden group-open:inline">
              {t('report_collapse')}
            </span>
          </summary>
          <div className="px-5 pb-5 pt-1 border-t border-slate-100">
            <div
              className="markdown-content"
              dangerouslySetInnerHTML={{ __html: section.html }}
            />
          </div>
        </details>
      ))}

      {/* ── Footer actions ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-2">
        <p className="text-xs text-slate-400 font-mono truncate max-w-[50%]">
          Run: {runId}
        </p>
        <button
          type="button"
          onClick={() => void handleRunAgain()}
          disabled={isRetrying}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-slate-300 transition-colors"
        >
          {isRetrying ? t('report_starting') : t('report_run_again')}
        </button>
      </div>

      {retryError && (
        <ErrorBanner
          message={retryError}
          correlationId={runId}
          onRetry={() => void handleRunAgain()}
        />
      )}
    </div>
  );
}
