//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { readFile, stat, rm } from 'fs/promises';
import path from 'path';

/** Canonical phase execution order. */
export const PHASE_ORDER: string[] = [
  'benefits-research',
  'insurance-research',
  'evidence-verification',
  'eligibility-validation',
  'action-plan',
];

/** Human-readable display names for each phase. */
export const PHASE_DISPLAY_NAMES: Record<string, string> = {
  'benefits-research': 'Benefits Research',
  'insurance-research': 'Insurance Research',
  'evidence-verification': 'Evidence Verification',
  'eligibility-validation': 'Eligibility Validation',
  'action-plan': 'Action Plan',
};

/** A single rendered phase section in the assembled report. */
export interface ReportSection {
  /** Phase identifier matching an entry in PHASE_ORDER (e.g., "action-plan"). */
  phaseName: string;
  /** Human-readable title for the collapsible section header. */
  displayName: string;
  /** Raw Markdown content read from the phase's `.md` output file. */
  content: string;
  /** True for the action-plan phase — expanded by default in the UI. */
  expanded: boolean;
}

/** The assembled multi-phase report returned by the report API route. */
export interface ReportPayload {
  /** Sections in PHASE_ORDER sequence. Always 5 entries (missing phases get a placeholder). */
  sections: ReportSection[];
  /**
   * Text extracted from the `## Bottom Line` section of the action-plan output.
   * Empty string if the action-plan did not include a Bottom Line section.
   */
  bottomLine: string;
}

/**
 * Error thrown by `assembleReport` when the run directory or phase files are missing.
 *
 * `code` discriminates the failure mode so the report route can return an appropriate
 * HTTP status (403 vs 422) and message to the client.
 */
export interface AssembleError extends Error {
  /** "RUN_DIR_MISSING" — the .workforce/{runId}/ directory does not exist. */
  /** "INCOMPLETE" — the directory exists but all phase files are absent. */
  code: 'RUN_DIR_MISSING' | 'INCOMPLETE';
  /** List of phase names whose .md files were not found. */
  missingPhases?: string[];
}

/**
 * Resolve the .workforce base directory relative to the repo root.
 * The web app runs from web/, so repo root is process.cwd()/..
 */
export function getWorkforceBase(): string {
  return path.join(process.cwd(), '..', '.workforce');
}

/**
 * Extract the text under the `## Bottom Line` section of the action-plan output.
 * Returns an empty string if the section is absent.
 */
function extractBottomLine(content: string): string {
  const match = content.match(/^##\s+Bottom Line\s*\n([\s\S]*?)(?=^##\s|\s*$)/m);
  if (!match) return '';
  return match[1].trim();
}

/**
 * Assemble the report payload from phase output files in the run directory.
 *
 * Throws an AssembleError with:
 * - `code: 'RUN_DIR_MISSING'` — run directory does not exist
 * - `code: 'INCOMPLETE'` — fewer than 5 phase files found
 */
export async function assembleReport(
  runId: string,
  workforceBase?: string,
): Promise<ReportPayload> {
  const base = workforceBase ?? getWorkforceBase();
  const runDir = path.join(base, runId);

  // Verify run directory exists
  try {
    await stat(runDir);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      const error = new Error(`Run directory not found: ${runDir}`) as AssembleError;
      error.code = 'RUN_DIR_MISSING';
      throw error;
    }
    throw err;
  }

  const sections: ReportSection[] = [];
  const missingPhases: string[] = [];
  let bottomLine = '';

  for (const phaseName of PHASE_ORDER) {
    const filePath = path.join(runDir, `${phaseName}.md`);
    let content: string;

    try {
      content = await readFile(filePath, 'utf8');
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') {
        missingPhases.push(phaseName);
        content = `_Phase completed without written output._`;
      } else {
        throw err;
      }
    }

    if (phaseName === 'action-plan' && !missingPhases.includes(phaseName)) {
      bottomLine = extractBottomLine(content);
    }

    sections.push({
      phaseName,
      displayName: PHASE_DISPLAY_NAMES[phaseName] ?? phaseName,
      content,
      expanded: phaseName === 'action-plan',
    });
  }

  // Throw INCOMPLETE only when every phase file is missing — if even one file
  // exists the report is partially usable (missing phases got placeholder text above).
  // Individual missing phase files do not fail the whole assembly; only a completely
  // empty run directory (e.g., KVR crashed before writing any output) triggers this.
  if (missingPhases.length === PHASE_ORDER.length) {
    const error = new Error('All phase files missing — workflow incomplete') as AssembleError;
    error.code = 'INCOMPLETE';
    error.missingPhases = missingPhases;
    throw error;
  }

  return { sections, bottomLine };
}

/**
 * Delete the run directory for a completed run.
 */
export async function deleteRunDir(runId: string, workforceBase?: string): Promise<void> {
  const base = workforceBase ?? getWorkforceBase();
  const runDir = path.join(base, runId);
  await rm(runDir, { recursive: true, force: true });
}
