/**
 * Unit tests for web/src/lib/report-assembler.ts
 *
 * These tests FAIL before implementation (module does not exist).
 * fs/promises is mocked at the boundary; real path logic is tested.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// Mock fs/promises at the system boundary — never mock internal logic.
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn(),
}));

import * as fs from 'fs/promises';
const mockReadFile = vi.mocked(fs.readFile);
const mockStat = vi.mocked(fs.stat);
const mockRm = vi.mocked(fs.rm);

// These imports fail until web/src/lib/report-assembler.ts is created.
import {
  assembleReport,
  deleteRunDir,
  getWorkforceBase,
  PHASE_ORDER,
  PHASE_DISPLAY_NAMES,
} from '@/lib/report-assembler';

const TEST_RUN_ID = '550e8400-e29b-41d4-a716-446655440099';
const TEST_WORKFORCE_BASE = '/tmp/test-workforce';

const SAMPLE_ACTION_PLAN = `## Prioritized Action Plan

### Immediate Actions (This Week)
1. Apply at https://www.yourtexasbenefits.com/

## Bottom Line
Your household qualifies for an estimated $18,000/year in benefits. Apply for CHIP for your children this week.

## Estimated Value Summary
| Program | Monthly Value | Annual Value |
|---------|--------------|--------------|
| CHIP    | $300         | $3,600       |
`;

const SAMPLE_PHASE_CONTENT = `## Phase Output
Some content here.`;

// ---------------------------------------------------------------------------
// PHASE_ORDER constant
// ---------------------------------------------------------------------------

describe('PHASE_ORDER', () => {
  it('has exactly 5 phases in canonical order', () => {
    expect(PHASE_ORDER).toHaveLength(5);
    expect(PHASE_ORDER[0]).toBe('benefits-research');
    expect(PHASE_ORDER[1]).toBe('insurance-research');
    expect(PHASE_ORDER[2]).toBe('evidence-verification');
    expect(PHASE_ORDER[3]).toBe('eligibility-validation');
    expect(PHASE_ORDER[4]).toBe('action-plan');
  });

  it('PHASE_DISPLAY_NAMES maps every phase in PHASE_ORDER', () => {
    for (const phase of PHASE_ORDER) {
      expect(PHASE_DISPLAY_NAMES[phase]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// assembleReport()
// ---------------------------------------------------------------------------

describe('assembleReport()', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockStat.mockReset();
    mockRm.mockReset();
  });

  it('returns valid ReportPayload when all 5 phase files exist', async () => {
    // stat() succeeds (dir exists)
    mockStat.mockResolvedValue({ isDirectory: () => true } as any);
    // readFile returns sample content for each phase
    mockReadFile.mockImplementation(async (filePath: any) => {
      const fp = String(filePath);
      if (fp.includes('action-plan')) return SAMPLE_ACTION_PLAN;
      return SAMPLE_PHASE_CONTENT;
    });

    const payload = await assembleReport(TEST_RUN_ID, TEST_WORKFORCE_BASE);

    expect(payload.sections).toHaveLength(5);
    expect(payload.bottomLine).toBeTruthy();
    expect(payload.bottomLine).toContain('Your household qualifies');
  });

  it('returns sections in canonical PHASE_ORDER sequence', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true } as any);
    mockReadFile.mockImplementation(async (filePath: any) => {
      const fp = String(filePath);
      if (fp.includes('action-plan')) return SAMPLE_ACTION_PLAN;
      return SAMPLE_PHASE_CONTENT;
    });

    const payload = await assembleReport(TEST_RUN_ID, TEST_WORKFORCE_BASE);

    for (let i = 0; i < PHASE_ORDER.length; i++) {
      expect(payload.sections[i].phaseName).toBe(PHASE_ORDER[i]);
    }
  });

  it('action-plan section has expanded:true, others have expanded:false', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true } as any);
    mockReadFile.mockImplementation(async (filePath: any) => {
      const fp = String(filePath);
      if (fp.includes('action-plan')) return SAMPLE_ACTION_PLAN;
      return SAMPLE_PHASE_CONTENT;
    });

    const payload = await assembleReport(TEST_RUN_ID, TEST_WORKFORCE_BASE);
    const actionPlan = payload.sections.find((s) => s.phaseName === 'action-plan');
    const otherSection = payload.sections.find((s) => s.phaseName === 'benefits-research');

    expect(actionPlan?.expanded).toBe(true);
    expect(otherSection?.expanded).toBe(false);
  });

  it('substitutes placeholder for a missing phase file instead of throwing', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true } as any);
    mockReadFile.mockImplementation(async (filePath: any) => {
      const fp = String(filePath);
      if (fp.includes('benefits-research')) {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      }
      if (fp.includes('action-plan')) return SAMPLE_ACTION_PLAN;
      return SAMPLE_PHASE_CONTENT;
    });

    const payload = await assembleReport(TEST_RUN_ID, TEST_WORKFORCE_BASE);
    const benefitsSection = payload.sections.find((s) => s.phaseName === 'benefits-research');
    expect(benefitsSection?.content).toContain('Phase completed without written output');
  });

  it('throws with code INCOMPLETE when fewer than 5 phase files exist', async () => {
    mockStat.mockResolvedValue({ isDirectory: () => true } as any);
    // All readFile calls throw ENOENT
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await expect(assembleReport(TEST_RUN_ID, TEST_WORKFORCE_BASE)).rejects.toMatchObject({
      code: 'INCOMPLETE',
      missingPhases: expect.arrayContaining(['benefits-research', 'action-plan']),
    });
  });

  it('throws with code RUN_DIR_MISSING when run directory does not exist', async () => {
    mockStat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await expect(assembleReport(TEST_RUN_ID, TEST_WORKFORCE_BASE)).rejects.toMatchObject({
      code: 'RUN_DIR_MISSING',
    });
  });

  it('extracts Bottom Line from action-plan content', async () => {
    const contentWithBottomLine = `## Action Plan

## Bottom Line
Your household qualifies for $18,000/year. Apply for CHIP this week.

## Prioritized Steps
1. Go to yourtexasbenefits.com
`;
    mockStat.mockResolvedValue({ isDirectory: () => true } as any);
    mockReadFile.mockImplementation(async (filePath: any) => {
      const fp = String(filePath);
      if (fp.includes('action-plan')) return contentWithBottomLine;
      return SAMPLE_PHASE_CONTENT;
    });

    const payload = await assembleReport(TEST_RUN_ID, TEST_WORKFORCE_BASE);
    expect(payload.bottomLine).toContain('Your household qualifies for $18,000/year');
    expect(payload.bottomLine).not.toContain('## Bottom Line'); // header stripped
  });

  it('bottomLine is empty string when ## Bottom Line section is absent', async () => {
    const contentWithoutBottomLine = `## Action Plan\nJust action steps here.`;
    mockStat.mockResolvedValue({ isDirectory: () => true } as any);
    mockReadFile.mockImplementation(async () => contentWithoutBottomLine);

    const payload = await assembleReport(TEST_RUN_ID, TEST_WORKFORCE_BASE);
    expect(payload.bottomLine).toBe('');
  });
});

// ---------------------------------------------------------------------------
// deleteRunDir()
// ---------------------------------------------------------------------------

describe('deleteRunDir()', () => {
  beforeEach(() => {
    mockRm.mockReset();
    mockRm.mockResolvedValue(undefined);
  });

  it('calls fs.rm with recursive:true and force:true', async () => {
    await deleteRunDir(TEST_RUN_ID, TEST_WORKFORCE_BASE);
    expect(mockRm).toHaveBeenCalledOnce();
    const [, options] = mockRm.mock.calls[0];
    expect(options).toMatchObject({ recursive: true, force: true });
  });

  it('calls fs.rm with the correct run directory path', async () => {
    await deleteRunDir(TEST_RUN_ID, TEST_WORKFORCE_BASE);
    const [dirPath] = mockRm.mock.calls[0];
    expect(String(dirPath)).toBe(path.join(TEST_WORKFORCE_BASE, TEST_RUN_ID));
  });
});

// ---------------------------------------------------------------------------
// getWorkforceBase()
// ---------------------------------------------------------------------------

describe('getWorkforceBase()', () => {
  it("resolves to path.join(process.cwd(), '..', '.workforce')", () => {
    const result = getWorkforceBase();
    const expected = path.join(process.cwd(), '..', '.workforce');
    expect(result).toBe(expected);
  });

  it('returns a string ending with .workforce', () => {
    const result = getWorkforceBase();
    expect(result.endsWith('.workforce')).toBe(true);
  });
});
