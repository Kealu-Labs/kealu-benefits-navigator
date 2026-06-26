//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { cookies } from 'next/headers';
import { sessionStore } from '@/lib/session-store';
import { checkKvrVersion } from '@/lib/kvr-checker';
import { getNextQuestion } from '@/lib/intake-flow';
import AppShell from '@/components/app-shell';
import type { ChatMessage } from '@/types/session';
import type { IntakeField } from '@/lib/intake-flow';
import type { ReportPayload } from '@/lib/report-assembler';

/**
 * Root page — server component.
 *
 * Reads the session from the in-memory store directly (no HTTP round-trip),
 * determines the initial view (intake / progress / report), and passes
 * serializable props to the AppShell client component.
 *
 * PII (income, medications, household vars) is never included in props —
 * only the pre-computed next question field and display-safe session metadata.
 */
export default async function Home() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get('session')?.value;

  let initialMessages: ChatMessage[] = [];
  let initialView: 'intake' | 'progress' | 'report' = 'intake';
  let initialRunId: string | undefined;
  let initialReport: ReportPayload | undefined;
  let initialNextQuestion: IntakeField | null = null;

  if (sessionId) {
    const session = sessionStore.get(sessionId);
    if (session) {
      initialMessages = session.messages;

      if (session.runStatus === 'complete' && session.reportContent) {
        initialView = 'report';
        initialReport = session.reportContent as ReportPayload;
        initialRunId = session.runId;
      } else if (session.runStatus === 'running' && session.runId) {
        initialView = 'progress';
        initialRunId = session.runId;
      } else {
        // Compute next intake question from current session state without a round-trip
        initialNextQuestion = getNextQuestion(session.vars, session.currentTier, session.skipIntake);
      }
    }
  }

  // Check kvr availability for the offline banner (best-effort; never throws)
  let kvrOnline = true;
  try {
    const check = checkKvrVersion();
    kvrOnline = check.ok;
  } catch {
    kvrOnline = false;
  }

  return (
    <main className="flex flex-col items-center min-h-screen py-8 px-4">
      <header className="w-full max-w-2xl mb-6">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Benefits Navigator</h1>
        <p className="text-slate-500 text-sm mt-1">
          Find health coverage and benefit programs for your household — no account required.
        </p>
      </header>

      {!kvrOnline && (
        <div
          role="alert"
          className="w-full max-w-2xl mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm"
        >
          Workflow engine offline — analysis is temporarily unavailable. Check back soon.
        </div>
      )}

      <div className="w-full max-w-2xl">
        <AppShell
          initialView={initialView}
          initialMessages={initialMessages}
          initialNextQuestion={initialNextQuestion}
          initialRunId={initialRunId}
          initialReport={initialReport}
        />
      </div>
    </main>
  );
}
