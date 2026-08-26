//
// Copyright 2026 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { describe, it, expect } from 'vitest';
import {
  findNearBoundaries,
  boundaryNotice,
  BAND_HALF_WIDTH_FPL_POINTS,
  type Threshold,
} from '@/lib/fpl-boundary';

// The lines BN actually reasons about. Passed in, never embedded -- the figures
// behind them are stale and live in the model's context document.
const THRESHOLDS: readonly Threshold[] = [
  { fplPercent: 100, label: 'the coverage gap / marketplace subsidies' },
  { fplPercent: 138, label: 'Medicaid in expansion states' },
  { fplPercent: 200, label: "CHIP (children's coverage)" },
  { fplPercent: 250, label: 'extra cost-sharing help' },
  { fplPercent: 400, label: 'marketplace subsidies' },
];

describe('the band FIRES near a threshold', () => {
  it('catches a household just below the 100% line', () => {
    const r = findNearBoundaries(97, THRESHOLDS);
    expect(r.isNearAnyBoundary).toBe(true);
    expect(r.near[0].threshold.fplPercent).toBe(100);
    expect(r.near[0].above).toBe(false);
  });

  it('catches a household just above it — the Texas coverage-gap case', () => {
    // The exact harm: stale tables push a genuinely-in-the-gap household to
    // read as just over 100%, and a crisp answer sends them to a denial.
    const r = findNearBoundaries(102, THRESHOLDS);
    expect(r.near[0].threshold.fplPercent).toBe(100);
    expect(r.near[0].above).toBe(true);
    expect(boundaryNotice(r)).not.toBeNull();
  });

  it('fires exactly ON the line', () => {
    expect(findNearBoundaries(138, THRESHOLDS).isNearAnyBoundary).toBe(true);
  });

  it('fires at exactly the band edge, inclusive', () => {
    expect(findNearBoundaries(105, THRESHOLDS).isNearAnyBoundary).toBe(true);
    expect(findNearBoundaries(95, THRESHOLDS).isNearAnyBoundary).toBe(true);
  });

  it('reports every nearby threshold, closest first', () => {
    // Between two lines that sit close together, both matter.
    const r = findNearBoundaries(
      137,
      [
        { fplPercent: 138, label: 'A' },
        { fplPercent: 134, label: 'B' },
      ],
    );
    expect(r.near.map((n) => n.threshold.label)).toEqual(['A', 'B']);
  });
});

describe('the band STAYS SILENT when the answer is genuinely crisp', () => {
  // A hedge that fires everywhere is a hedge nobody reads. These are the
  // accept-path cases, and they matter as much as the firing ones.
  it('is silent for a household far below every threshold', () => {
    const r = findNearBoundaries(50, THRESHOLDS);
    expect(r.isNearAnyBoundary).toBe(false);
    expect(boundaryNotice(r)).toBeNull();
  });

  it('is silent just outside the band', () => {
    expect(findNearBoundaries(106, THRESHOLDS).isNearAnyBoundary).toBe(false);
    expect(findNearBoundaries(94, THRESHOLDS).isNearAnyBoundary).toBe(false);
  });

  it('is silent in the middle of a wide band between thresholds', () => {
    expect(findNearBoundaries(170, THRESHOLDS).isNearAnyBoundary).toBe(false);
  });

  it('does not fire for the Austin gap scenario, which is decisively below', () => {
    // ~50% FPL: the eval corpus case whose answer is NOT close to call.
    expect(findNearBoundaries(50.1, THRESHOLDS).isNearAnyBoundary).toBe(false);
  });
});

describe('the notice', () => {
  it('names the reason, so the person has something to ask about', () => {
    const notice = boundaryNotice(findNearBoundaries(102, THRESHOLDS))!;
    expect(notice).toContain('how that programme counts your income');
    expect(notice).toContain('caseworker');
  });

  it('does NOT imply a direction', () => {
    // The whole point is that we do not know. Implying either way is the error
    // this replaces -- "you may not qualify" discourages a valid application.
    const notice = boundaryNotice(findNearBoundaries(97, THRESHOLDS))!;
    expect(notice).not.toMatch(/you may not qualify|you probably|unlikely to qualify/i);
  });

  it('lists multiple nearby thresholds readably', () => {
    const notice = boundaryNotice(
      findNearBoundaries(136, [
        { fplPercent: 138, label: 'Medicaid' },
        { fplPercent: 134, label: 'something else' },
      ]),
    )!;
    expect(notice).toContain('Medicaid and something else');
  });
});

describe('the band width', () => {
  it('is configurable so it can be revised from evidence', () => {
    // It is a starting point, not a derived constant. Instrumenting the
    // in-band rate and narrowing or widening it is the intended path.
    expect(findNearBoundaries(110, THRESHOLDS, 15).isNearAnyBoundary).toBe(true);
    expect(findNearBoundaries(110, THRESHOLDS, 2).isNearAnyBoundary).toBe(false);
  });

  it('defaults to the approved ±5 points', () => {
    expect(BAND_HALF_WIDTH_FPL_POINTS).toBe(5);
  });
});
