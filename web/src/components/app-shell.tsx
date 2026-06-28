//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

import { useState } from 'react';
import ChatInterface from './chat-interface';
import PhaseTracker from './phase-tracker';
import ReportView from './report-view';
import EditInfoForm from './edit-info-form';
import type { ChatMessage } from '@/types/session';
import type { IntakeField } from '@/lib/intake-flow';
import type { ReportPayload } from '@/lib/report-assembler';

type View = 'intake' | 'progress' | 'edit' | 'report';

interface AppShellProps {
  initialView: View;
  initialMessages: ChatMessage[];
  initialNextQuestion: IntakeField | null;
  initialRunId?: string;
  initialReport?: ReportPayload;
}

/**
 * AppShell — client component that owns view-transition state.
 *
 * Receives serializable initial state from the server component (page.tsx) and
 * orchestrates transitions: intake → progress → report, and retry → progress.
 */
export default function AppShell({
  initialView,
  initialMessages,
  initialNextQuestion,
  initialRunId,
  initialReport,
}: AppShellProps) {
  const [view, setView] = useState<View>(initialView);
  const [runId, setRunId] = useState<string | undefined>(initialRunId);
  const [report, setReport] = useState<ReportPayload | undefined>(initialReport);

  /** Called by ChatInterface when all intake fields are collected and a run is started. */
  function handleReady(newRunId: string) {
    setRunId(newRunId);
    setView('progress');
  }

  /** Called by PhaseTracker when the action-plan phase completes and the report is fetched. */
  function handleRunComplete(payload: ReportPayload) {
    setReport(payload);
    setView('report');
  }

  /**
   * Called by ReportView "Run Again" — re-uses the same session vars to start a new run
   * without repeating the intake conversation.
   */
  function handleRetry(newRunId: string) {
    setRunId(newRunId);
    setView('progress');
  }

  /**
   * Called by PhaseTracker "Try Again" — a new run has been started with the same
   * data. Swap in the new runId; the keyed PhaseTracker remounts and reconnects.
   */
  function handleRestart(newRunId: string) {
    setRunId(newRunId);
    setView('progress');
  }

  /**
   * Called by PhaseTracker when the user stops a run or chooses to edit after an
   * error. Switches to the structured edit form.
   */
  function handleEdit() {
    setView('edit');
  }

  /** Called by EditInfoForm after saving — a fresh run has started. */
  function handleEditSaved(newRunId: string) {
    setRunId(newRunId);
    setView('progress');
  }

  /** Called by EditInfoForm "Cancel" — return to the chat intake view. */
  function handleEditCancel() {
    setView('intake');
  }

  return (
    <>
      {view === 'intake' && (
        <ChatInterface
          initialMessages={initialMessages}
          initialNextQuestion={initialNextQuestion}
          onReady={handleReady}
        />
      )}

      {view === 'progress' && runId && (
        <PhaseTracker
          key={runId}
          runId={runId}
          onComplete={handleRunComplete}
          onRestart={handleRestart}
          onEdit={handleEdit}
        />
      )}

      {view === 'edit' && (
        <EditInfoForm onSaved={handleEditSaved} onCancel={handleEditCancel} />
      )}

      {view === 'report' && report && (
        <ReportView
          payload={report}
          runId={runId ?? ''}
          onRetry={handleRetry}
        />
      )}
    </>
  );
}
