//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

import { useEffect, useRef, useState } from 'react';
import ErrorBanner from './error-banner';
import type { ReportPayload } from '@/lib/report-assembler';

const PHASES = [
  { key: 'benefits-research', label: 'Benefits Research' },
  { key: 'insurance-research', label: 'Insurance Research' },
  { key: 'evidence-verification', label: 'Evidence Verification' },
  { key: 'eligibility-validation', label: 'Eligibility Validation' },
  { key: 'action-plan', label: 'Action Plan' },
] as const;

type PhaseKey = (typeof PHASES)[number]['key'];
type PhaseStatus = 'idle' | 'running' | 'rerunning' | 'complete' | 'error';

const STATUS_LABEL: Record<PhaseStatus, string> = {
  idle: 'Waiting',
  running: 'Running…',
  rerunning: 'Re-checking…',
  complete: 'Complete',
  error: 'Error',
};

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
  onError?: () => void;
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
export default function PhaseTracker({ runId, onComplete, onError }: PhaseTrackerProps) {
  const initialStatus = () =>
    Object.fromEntries(PHASES.map((p) => [p.key, 'idle'])) as Record<PhaseKey, PhaseStatus>;

  const [phaseStatus, setPhaseStatus] = useState<Record<PhaseKey, PhaseStatus>>(initialStatus);
  const [error, setError] = useState<{ message: string } | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const fetchingReport = useRef(false);

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

      // Return to intake so AppShell can initiate a fresh PhaseTracker with new runId
      onError?.();
    } catch {
      setError({ message: 'Unable to start a new run. Please refresh the page.' });
    }
  }

  const parallelPhases = PHASES.slice(0, 2);
  const sequentialPhases = PHASES.slice(2);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Analyzing your household…</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          A 5-phase AI workflow is running. This typically takes 5–15 minutes.
        </p>
      </div>

      {/* Parallel phases (1+2) */}
      <div className="grid grid-cols-2 gap-3">
        {parallelPhases.map((phase) => (
          <PhaseTile key={phase.key} label={phase.label} status={phaseStatus[phase.key]} />
        ))}
      </div>

      {/* Sequential phases (3–5) */}
      <div className="space-y-2">
        {sequentialPhases.map((phase) => (
          <PhaseTile key={phase.key} label={phase.label} status={phaseStatus[phase.key]} wide />
        ))}
      </div>

      {error && (
        <ErrorBanner
          message={error.message}
          correlationId={runId}
          onRetry={() => void handleRetry()}
        />
      )}
    </div>
  );
}

function PhaseTile({
  label,
  status,
  wide,
}: {
  label: string;
  status: PhaseStatus;
  wide?: boolean;
}) {
  const isActive = status === 'running' || status === 'rerunning';

  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-colors ${phaseColorClass(status)} ${wide ? 'w-full' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm leading-tight">{label}</span>
        {status === 'complete' && (
          <span aria-label="Complete" className="text-green-600 text-base shrink-0">
            ✓
          </span>
        )}
        {status === 'error' && (
          <span aria-label="Error" className="text-red-500 text-base shrink-0">
            ✕
          </span>
        )}
      </div>
      <div className="text-xs mt-0.5 opacity-70">{STATUS_LABEL[status]}</div>

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
