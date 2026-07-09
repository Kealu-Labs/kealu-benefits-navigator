//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

import { useEffect, useRef, useState } from 'react';
import ErrorBanner from './error-banner';
import { useTranslation } from '@/hooks/use-translation';
import type { ReportPayload } from '@/lib/report-assembler';
import type { Messages } from '@/i18n';

const PHASES = [
  { key: 'benefits-research', labelKey: 'phase_benefits_research' },
  { key: 'insurance-research', labelKey: 'phase_insurance_research' },
  { key: 'evidence-verification', labelKey: 'phase_evidence_verification' },
  { key: 'eligibility-validation', labelKey: 'phase_eligibility_validation' },
  { key: 'action-plan', labelKey: 'phase_action_plan' },
] as const satisfies Array<{ key: string; labelKey: keyof Messages }>;

type PhaseKey = (typeof PHASES)[number]['key'];
type PhaseStatus = 'idle' | 'running' | 'rerunning' | 'complete' | 'error';

/** Map PhaseStatus values to their translation keys. */
const STATUS_KEYS: Record<PhaseStatus, keyof Messages> = {
  idle: 'phase_status_idle',
  running: 'phase_status_running',
  rerunning: 'phase_status_rerunning',
  complete: 'phase_status_complete',
  error: 'phase_status_error',
};

/**
 * Relative share of the overall progress bar each phase accounts for. Weights
 * sum to 100. Benefits/insurance research are the heaviest (most tool calls and
 * tokens); later validation/plan phases are quicker. Used to convert discrete
 * phase completions into an overall percentage.
 */
const PHASE_WEIGHTS: Record<PhaseKey, number> = {
  'benefits-research': 25,
  'insurance-research': 25,
  'evidence-verification': 20,
  'eligibility-validation': 15,
  'action-plan': 15,
};

/**
 * Rough expected active duration (ms) per phase. Used ONLY to animate progress
 * *within* a running phase so the bar keeps creeping forward between the
 * discrete phase_start/phase_complete events (each phase can run for minutes).
 * In-phase progress ramps toward — but never reaches — the phase's full weight,
 * so the bar only "completes" a segment on the real phase_complete event.
 */
const PHASE_EST_MS: Record<PhaseKey, number> = {
  'benefits-research': 180_000,
  'insurance-research': 180_000,
  'evidence-verification': 90_000,
  'eligibility-validation': 60_000,
  'action-plan': 90_000,
};

/** Cap in-phase ramp at 90% of the segment so completion stays event-driven. */
const IN_PHASE_RAMP_CAP = 0.9;

/** Map a PhaseStatus to the Tailwind utility classes for its tile's border/background/text color. */
function phaseColorClass(status: PhaseStatus): string {
  switch (status) {
    case 'running':
      return 'border-blue-300 bg-blue-50 text-blue-800';
    case 'rerunning':
      return 'border-amber-300 bg-amber-50 text-amber-800';
    case 'complete':
      return 'border-green-200 bg-green-50 text-green-800';
    case 'error':
      return 'border-red-200 bg-red-50 text-red-800';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-400';
  }
}

interface PhaseTrackerProps {
  runId: string;
  onComplete: (payload: ReportPayload) => void;
  /** Re-run the same data after an error. Called with the new runId. */
  onRestart: (runId: string) => void;
  /** Stop the run (or recover from an error) and switch to the edit-info view. */
  onEdit: () => void;
}

/**
 * PhaseTracker — real-time workflow progress via Server-Sent Events.
 *
 * - Phases 1+2 (benefits-research, insurance-research) rendered in a 2-column grid
 *   to show they run in parallel.
 * - Feedback-loop reruns set phase status to 'rerunning' (never hidden).
 * - EventSource reconnects automatically on network drop using Last-Event-ID.
 * - On action-plan complete, fetches /api/workflow/{runId}/report and calls onComplete.
 */
export default function PhaseTracker({ runId, onComplete, onRestart, onEdit }: PhaseTrackerProps) {
  const { t } = useTranslation();

  const initialStatus = () =>
    Object.fromEntries(PHASES.map((p) => [p.key, 'idle'])) as Record<PhaseKey, PhaseStatus>;

  const [phaseStatus, setPhaseStatus] = useState<Record<PhaseKey, PhaseStatus>>(initialStatus);
  const [error, setError] = useState<{ message: string } | null>(null);
  const [stopping, setStopping] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const fetchingReport = useRef(false);

  // Wall-clock start time per phase (set when it first goes running), used to
  // animate in-phase progress. A `tick` heartbeat re-renders while any phase runs.
  const phaseStartedAt = useRef<Partial<Record<PhaseKey, number>>>({});
  const [, setTick] = useState(0);
  // Monotonic clamp: the displayed percentage never moves backward (reruns or
  // ramp re-computation must not make the bar appear to regress).
  const maxPercentRef = useRef(0);

  useEffect(() => {
    const es = new EventSource(`/api/workflow/${runId}/stream`);
    esRef.current = es;

    es.addEventListener('phase', (raw) => {
      const e = raw as MessageEvent<string>;
      try {
        const event = JSON.parse(e.data) as {
          event_type: string;
          phase?: string;
          message?: string;
        };

        switch (event.event_type) {
          case 'phase_start': {
            const key = event.phase as PhaseKey | undefined;
            if (key) {
              // Stamp (or restamp, for a rerun) when this phase began so the
              // in-phase ramp measures elapsed time from now.
              phaseStartedAt.current[key] = Date.now();
              setPhaseStatus((prev) => ({
                ...prev,
                [key]: prev[key] === 'complete' ? 'rerunning' : 'running',
              }));
            }
            break;
          }

          case 'phase_complete': {
            const key = event.phase as PhaseKey | undefined;
            if (key) {
              setPhaseStatus((prev) => ({ ...prev, [key]: 'complete' }));

              if (key === 'action-plan' && !fetchingReport.current) {
                fetchingReport.current = true;
                es.close();
                void fetchReport();
              }
            }
            break;
          }

          case 'error': {
            setError({ message: event.message ?? 'Workflow failed.' });
            es.close();
            break;
          }
        }
      } catch {
        // Malformed SSE event data — silently ignore
      }
    });

    return () => {
      es.close();
    };
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Heartbeat: while any phase is actively running, re-render twice a second so
  // the in-phase progress ramp advances smoothly between SSE events. Stops once
  // nothing is running (all complete, idle, or errored) to avoid a wasted timer.
  const anyRunning = PHASES.some(
    (p) => phaseStatus[p.key] === 'running' || phaseStatus[p.key] === 'rerunning',
  );
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setTick((tick) => tick + 1), 500);
    return () => clearInterval(id);
  }, [anyRunning]);

  async function fetchReport() {
    try {
      const res = await fetch(`/api/workflow/${runId}/report`, { credentials: 'include' });
      if (res.ok) {
        const payload = (await res.json()) as ReportPayload;
        onComplete(payload);
      } else {
        const body = (await res.json()) as { error?: string };
        setError({ message: body.error ?? 'Failed to load report.' });
      }
    } catch {
      setError({ message: 'Failed to load report. Please try again.' });
    }
  }

  async function handleRetry() {
    setError(null);
    setPhaseStatus(initialStatus());
    fetchingReport.current = false;
    phaseStartedAt.current = {};
    maxPercentRef.current = 0;

    try {
      const res = await fetch('/api/workflow/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { runId?: string; error?: string };

      if (!data.runId) {
        setError({ message: data.error ?? 'Unable to start a new run.' });
        return;
      }

      // Re-run the same data: AppShell swaps in the new runId and remounts this
      // tracker (keyed on runId) so a fresh EventSource connects.
      onRestart(data.runId);
    } catch {
      setError({ message: 'Unable to start a new run. Please refresh the page.' });
    }
  }

  /** Stop the in-progress run, then hand off to the edit-info view. */
  async function handleStop() {
    if (stopping) return;
    if (!window.confirm('Stop the analysis? You can review and edit your information before re-running.')) {
      return;
    }
    setStopping(true);

    // Close the SSE connection immediately so no late events arrive.
    esRef.current?.close();

    try {
      await fetch(`/api/workflow/${runId}/stop`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Best-effort — the server also terminates orphaned runs on disconnect.
    }

    onEdit();
  }

  // ── Overall weighted progress ─────────────────────────────────────────────
  // Each completed phase contributes its full weight; a running phase contributes
  // a time-based fraction of its weight (ramping toward, but capped below, full).
  const rawPercent = PHASES.reduce((sum, p) => {
    const weight = PHASE_WEIGHTS[p.key];
    const status = phaseStatus[p.key];
    if (status === 'complete') return sum + weight;
    if (status === 'running' || status === 'rerunning') {
      const startedAt = phaseStartedAt.current[p.key];
      const elapsed = startedAt ? Date.now() - startedAt : 0;
      const frac = Math.min(IN_PHASE_RAMP_CAP, elapsed / PHASE_EST_MS[p.key]);
      // A rerun re-opens an already-complete segment; floor its contribution at
      // the ramp cap so the bar holds near-complete rather than dropping back.
      const floor = status === 'rerunning' ? IN_PHASE_RAMP_CAP : 0;
      return sum + weight * Math.max(floor, frac);
    }
    return sum;
  }, 0);

  // Clamp monotonic so the bar never visibly regresses.
  const percent = Math.round(Math.max(maxPercentRef.current, rawPercent));
  maxPercentRef.current = Math.max(maxPercentRef.current, percent);

  // Phases 1+2 (benefits-research, insurance-research) run in parallel in the workflow;
  // render them in a 2-column grid to make that concurrency visible to the user.
  const parallelPhases = PHASES.slice(0, 2);
  // Phases 3–5 run sequentially after both parallel phases complete.
  const sequentialPhases = PHASES.slice(2);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{t('phase_analyzing')}</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {t('phase_description')}
          </p>
        </div>
        {!error && (
          <button
            type="button"
            onClick={() => void handleStop()}
            disabled={stopping}
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-300 transition-colors"
          >
            {stopping ? t('phase_stopping') : t('phase_stop_edit')}
          </button>
        )}
      </div>

      {/* Overall weighted progress bar */}
      {!error && (
        <div>
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 mb-1">
            <span className="flex items-center gap-1.5">
              {anyRunning && (
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
                </span>
              )}
              {percent >= 100
                ? t('phase_finalizing')
                : anyRunning
                  ? t('phase_running_label')
                  : t('phase_starting')}
            </span>
            <span className="tabular-nums text-slate-600">{percent}%</span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('phase_progress_aria')}
          >
            <div
              className="h-full rounded-full bg-blue-500 transition-[width] duration-500 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Parallel phases (1+2) */}
      <div className="grid grid-cols-2 gap-3">
        {parallelPhases.map((phase) => (
          <PhaseTile
            key={phase.key}
            label={t(phase.labelKey)}
            status={phaseStatus[phase.key]}
          />
        ))}
      </div>

      {/* Sequential phases (3–5) */}
      <div className="space-y-2">
        {sequentialPhases.map((phase) => (
          <PhaseTile
            key={phase.key}
            label={t(phase.labelKey)}
            status={phaseStatus[phase.key]}
            wide
          />
        ))}
      </div>

      {error && (
        <ErrorBanner
          message={error.message}
          correlationId={runId}
          onRetry={() => void handleRetry()}
          onSecondary={onEdit}
        />
      )}
    </div>
  );
}

/**
 * PhaseTile — renders a single phase card with status indicator and animated progress stripe.
 *
 * @param label  - Human-readable phase name (already translated by the caller).
 * @param status - Current phase status; drives color scheme and progress animation.
 * @param wide   - When true, the card spans its full container width (used for sequential phases).
 */
function PhaseTile({
  label,
  status,
  wide,
}: {
  label: string;
  status: PhaseStatus;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  // Show the animated progress stripe for any actively-running state
  const isActive = status === 'running' || status === 'rerunning';

  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-colors ${phaseColorClass(status)} ${wide ? 'w-full' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm leading-tight">{label}</span>
        {status === 'complete' && (
          <span aria-label={t('phase_complete_aria')} className="text-green-600 text-base shrink-0">
            ✓
          </span>
        )}
        {status === 'error' && (
          <span aria-label={t('phase_error_aria')} className="text-red-500 text-base shrink-0">
            ✕
          </span>
        )}
      </div>
      <div className="text-xs mt-0.5 opacity-70">{t(STATUS_KEYS[status])}</div>

      {/* Progress stripe for active phases */}
      {isActive && (
        <div className="mt-2 h-1 rounded-full bg-current opacity-15 overflow-hidden">
          <div
            className="h-full w-2/5 rounded-full bg-current opacity-80"
            style={{ animation: 'slide 1.8s ease-in-out infinite' }}
          />
        </div>
      )}
    </div>
  );
}
