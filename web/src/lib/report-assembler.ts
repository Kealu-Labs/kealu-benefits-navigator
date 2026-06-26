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

export interface ReportSection {
  phaseName: string;
  displayName: string;
  content: string;
  expanded: boolean;
}

export interface ReportPayload {
  sections: ReportSection[];
  bottomLine: string;
}

export interface AssembleError extends Error {
  code: 'RUN_DIR_MISSING' | 'INCOMPLETE';
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

  // Require all 5 phases to be present
  if (missingPhases.length === PHASE_ORDER.length) {
    const error = new Error('All phase files missing — workflow incomplete') as AssembleError;
    error.code = 'INCOMPLETE';
    error.missingPhases = missingPhases;
    throw error;
  }

  // If any phases are missing beyond the placeholder substitution, treat as incomplete
  if (missingPhases.length > 0 && missingPhases.length === PHASE_ORDER.length) {
    const error = new Error('Workflow incomplete') as AssembleError;
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
