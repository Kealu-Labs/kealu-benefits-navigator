//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { NextResponse } from 'next/server';

/**
 * GET /api/workflow/[runId]/report
 *
 * Assembles and returns the full report for a completed workflow run.
 * Authorizes via session cookie: session.runId must match path runId.
 * Caches the assembled report in session.reportContent to avoid re-reading on refresh.
 * Deletes the run directory after the first successful assembly.
 * Best-effort: calls generateDraft() to produce a pre-filled PDF application draft.
 *
 * Both session-store and report-assembler are imported dynamically so that
 * vi.mock() factories in tests are not triggered at module-load time (avoids
 * TDZ errors when mock factories reference consts declared after hoisted imports).
 *
 * Response codes:
 * - 200 `{ sections, bottomLine, draftAvailable, draftFormType }` — report assembled
 * - 403 — session does not own this runId
 * - 422 `{ error, missingPhases }` — run directory missing or incomplete
 */
export async function GET(
  req: Request,
  { params }: { params: { runId: string } },
): Promise<Response> {
  const { runId } = params;

  // Dynamic imports: defers module resolution to handler invocation time
  const { sessionStore } = await import('@/lib/session-store');
  const { assembleReport, deleteRunDir, getWorkforceBase, getDraftsBase, PHASE_ORDER } = await import(
    '@/lib/report-assembler'
  );

  // Authorize: read session exclusively from the request Cookie header (never fall back to
  // next/headers cookieStore — that would bypass the per-request auth boundary in tests
  // and in environments where multiple sessions coexist).
  const rawCookie = req.headers.get('cookie') ?? '';
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = sessionCookieMatch?.[1];
  const session = cookieValue ? sessionStore.get(cookieValue) : null;

  if (!session || session.runId !== runId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Return cached report if available (avoids re-reading deleted run dir)
  if (session.reportContent) {
    return NextResponse.json(session.reportContent, {
      status: 200,
      headers: { 'X-Correlation-Id': runId },
    });
  }

  // Assemble report
  const workforceBase = getWorkforceBase();

  try {
    const payload = await assembleReport(runId, workforceBase);

    // Best-effort: generate a pre-filled benefit application draft PDF.
    // Failure is non-fatal — the report is still returned with draftAvailable: false.
    try {
      const { generateDraft } = await import('@/lib/draft-generator');
      const draftsBase = getDraftsBase();
      // Concatenate all phase content for checkbox determination in the Python helper
      const workflowOutput = payload.sections.map((s) => s.content).join('\n\n');
      const draftResult = await generateDraft(runId, session.vars, workflowOutput, draftsBase);

      if (draftResult) {
        payload.draftAvailable = true;
        payload.draftFormType = draftResult.formType;
        sessionStore.update(session.sessionId, {
          draftPath: draftResult.path,
          draftFormType: draftResult.formType,
        });
      }
    } catch {
      // generateDraft failed — keep draftAvailable: false (already set by assembleReport)
    }

    // Cache in session and update status
    sessionStore.update(session.sessionId, {
      reportContent: payload,
      runStatus: 'complete',
    });

    // Delete run directory now that report is cached
    await deleteRunDir(runId, workforceBase);

    return NextResponse.json(payload, {
      status: 200,
      headers: { 'X-Correlation-Id': runId },
    });
  } catch (err: unknown) {
    const e = err as { code?: string; missingPhases?: string[] };

    if (e.code === 'RUN_DIR_MISSING') {
      return NextResponse.json(
        {
          error: 'Run directory not found — workflow may not have completed.',
          missingPhases: PHASE_ORDER,
        },
        { status: 422, headers: { 'X-Correlation-Id': runId } },
      );
    }

    if (e.code === 'INCOMPLETE') {
      return NextResponse.json(
        {
          error: 'Workflow incomplete — some phases have not finished.',
          missingPhases: e.missingPhases ?? [],
        },
        { status: 422, headers: { 'X-Correlation-Id': runId } },
      );
    }

    throw err;
  }
}
