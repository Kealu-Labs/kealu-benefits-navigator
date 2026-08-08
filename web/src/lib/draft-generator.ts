//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Draft generator — spawns the Python `generate_draft_helper` subprocess to
 * produce a pre-filled benefit application PDF.
 *
 * The Python executable is resolved via `resolvePythonExec()` before spawning.
 * No user PII crosses the log boundary; only runId, form_type, exit_code, and
 * elapsed_ms are logged.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { resolveKvr } from '@/lib/kvr-checker';
import type { HouseholdVars } from '@/types/session';

/** Result of a successful draft generation. */
export interface DraftResult {
  /** Absolute filesystem path to the generated PDF. */
  path: string;
  /** "official" for a real state AcroForm PDF; "worksheet" for the fallback. */
  formType: 'official' | 'worksheet';
}

/**
 * Locate the Python executable to use for spawning the draft helper.
 *
 * Resolution order:
 * 1. `process.env.KVR_PYTHON` — explicit operator override.
 * 2. `dirname(resolveKvr())/python` — Python alongside KVR in the venv's bin/.
 * 3. `dirname(resolveKvr())/python3` — fallback for venvs that only symlink python3.
 * 4. null — log a structured warning; draft generation is skipped.
 */
export function resolvePythonExec(): string | null {
  // 1. Explicit override
  const envPython = process.env.KVR_PYTHON;
  if (envPython && existsSync(envPython)) {
    return envPython;
  }

  const kvrPath = resolveKvr();
  if (!kvrPath) {
    console.log(
      JSON.stringify({
        level: 'warn',
        event: 'python_exec_not_found',
        reason: 'kvr binary not found; cannot derive Python path',
      }),
    );
    return null;
  }

  const binDir = path.dirname(kvrPath);

  // 2. python alongside kvr in venv bin/
  const python = path.join(binDir, 'python');
  if (existsSync(python)) return python;

  // 3. python3 fallback
  const python3 = path.join(binDir, 'python3');
  if (existsSync(python3)) return python3;

  console.log(
    JSON.stringify({
      level: 'warn',
      event: 'python_exec_not_found',
      reason: 'no python/python3 found in kvr bin directory',
      binDir,
    }),
  );
  return null;
}

/**
 * Spawn the Python draft helper to generate a pre-filled benefit application PDF.
 *
 * Returns a DraftResult on success, or null on any failure (Python not found,
 * subprocess error, JSON parse failure, timeout). Errors are logged with
 * structured JSON; no PII is logged.
 *
 * @param runId         UUID of the workflow run (for structured logs only).
 * @param vars          Household variables (state, county, zip, etc.).
 * @param workflowOutput  Concatenated workflow markdown output for checkbox determination.
 * @param draftsBase    Base directory for draft PDFs (`.workforce-drafts/`).
 */
export async function generateDraft(
  runId: string,
  vars: Partial<HouseholdVars> & { annual_income?: string },
  workflowOutput: string,
  draftsBase: string,
): Promise<DraftResult | null> {
  const pythonExec = resolvePythonExec();
  if (!pythonExec) {
    console.log(
      JSON.stringify({
        level: 'warn',
        event: 'draft_generation_skipped',
        runId,
        reason: 'python exec not found',
      }),
    );
    return null;
  }

  const outputDir = path.join(draftsBase, runId);
  const stdinPayload = JSON.stringify({
    args: vars,
    workflow_output: workflowOutput,
    output_dir: outputDir,
  });

  const startMs = Date.now();

  return new Promise<DraftResult | null>((resolve) => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, 30_000);

    let stdout = '';
    let stderr = '';

    const child = spawn(
      pythonExec,
      ['-m', 'benefits_navigator.generate_draft_helper'],
      {
        signal: controller.signal,
        shell: false,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      },
    );

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    // EPIPE guard: if the helper exits before consuming stdin (e.g. an import
    // failure exits immediately), the write emits a stream 'error' that would
    // otherwise be an uncaught exception. The 'close' handler still reports
    // the non-zero exit, so a swallowed write error degrades to draft=null.
    child.stdin?.on('error', () => {
      // Intentionally ignored — see comment above.
    });
    child.stdin?.write(stdinPayload);
    child.stdin?.end();

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      console.log(
        JSON.stringify({
          level: 'warn',
          event: 'draft_generation_failed',
          runId,
          reason: 'spawn error',
          error: err.message,
        }),
      );
      resolve(null);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      const elapsedMs = Date.now() - startMs;

      if (code !== 0) {
        // Truncate stderr to 512 chars — no user data in logs
        const snippet = stderr.slice(0, 512).replace(/\n/g, ' ');
        console.log(
          JSON.stringify({
            level: 'warn',
            event: 'draft_generation_failed',
            runId,
            exit_code: code,
            elapsed_ms: elapsedMs,
            stderr_snippet: snippet,
          }),
        );
        resolve(null);
        return;
      }

      try {
        const result = JSON.parse(stdout.trim()) as {
          path?: string;
          form_type?: string;
          error?: string;
        };

        if (result.error || !result.path || !result.form_type) {
          console.log(
            JSON.stringify({
              level: 'warn',
              event: 'draft_generation_failed',
              runId,
              reason: result.error ?? 'missing path or form_type in output',
              elapsed_ms: elapsedMs,
            }),
          );
          resolve(null);
          return;
        }

        const formType = result.form_type as 'official' | 'worksheet';
        console.log(
          JSON.stringify({
            level: 'info',
            event: 'draft_generation_complete',
            runId,
            form_type: formType,
            elapsed_ms: elapsedMs,
            success: true,
          }),
        );
        resolve({ path: result.path, formType });
      } catch {
        console.log(
          JSON.stringify({
            level: 'warn',
            event: 'draft_generation_failed',
            runId,
            reason: 'JSON parse failure',
            elapsed_ms: elapsedMs,
          }),
        );
        resolve(null);
      }
    });
  });
}
