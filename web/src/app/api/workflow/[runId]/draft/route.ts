//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { readFile, stat } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

/**
 * GET /api/workflow/[runId]/draft
 *
 * Download the pre-filled benefit application draft PDF for a completed run.
 * Authorizes via session cookie: session.runId must match path runId and
 * session.draftPath must be set.
 *
 * Security: the absolute draftPath is verified to be within getDraftsBase() to
 * prevent path traversal attacks.
 *
 * Response codes:
 * - 200 application/pdf — PDF streamed with correct Content-Disposition
 * - 403 — session does not own this runId
 * - 404 — no draft was generated, or file no longer on disk
 */
export async function GET(
  req: Request,
  { params }: { params: { runId: string } },
): Promise<Response> {
  const { runId } = params;

  // Dynamic imports: defers module resolution to handler invocation time
  const { sessionStore } = await import('@/lib/session-store');
  const { getDraftsBase } = await import('@/lib/report-assembler');

  // Authorize: read session exclusively from the request Cookie header
  const rawCookie = req.headers.get('cookie') ?? '';
  const sessionCookieMatch = rawCookie.match(/(?:^|;\s*)session=([^;]+)/);
  const cookieValue = sessionCookieMatch?.[1];
  const session = cookieValue ? sessionStore.get(cookieValue) : null;

  if (!session || session.runId !== runId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Verify the draft was generated for this session
  if (!session.draftPath) {
    return NextResponse.json(
      { error: 'No draft available for this run.' },
      { status: 404 },
    );
  }

  // Path traversal guard: draftPath must be inside .workforce-drafts/
  const draftsBase = getDraftsBase();
  const resolvedDraft = path.resolve(session.draftPath);
  const resolvedBase = path.resolve(draftsBase);
  if (!resolvedDraft.startsWith(resolvedBase + path.sep)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Verify file still exists on disk
  try {
    await stat(resolvedDraft);
  } catch {
    return NextResponse.json(
      { error: 'Draft file not found on disk.' },
      { status: 404 },
    );
  }

  // Read and stream the PDF
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await readFile(resolvedDraft);
  } catch {
    return NextResponse.json(
      { error: 'Failed to read draft file.' },
      { status: 404 },
    );
  }

  // Determine filename from form type
  const formType = session.draftFormType ?? 'official';
  const filename =
    formType === 'official'
      ? 'partially-prefilled-SAWS-1-draft.pdf'
      : 'benefits-preparation-worksheet-draft.pdf';

  return new Response(new Uint8Array(pdfBuffer), {
  status: 200,
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': String(pdfBuffer.length),
    'Cache-Control': 'private, no-store',
  },
});
}
