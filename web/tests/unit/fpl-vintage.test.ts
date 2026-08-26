//
// Copyright 2026 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import { describe, it, expect } from 'vitest';
import {
  checkFplVintage,
  fplStalenessNotice,
  EMBEDDED_FPL_GUIDELINE_YEAR,
} from '@/lib/fpl-vintage';

const on = (iso: string) => new Date(iso);

describe('the guard FIRES when the tables are stale', () => {
  it('detects a one-year gap', () => {
    const v = checkFplVintage(on('2026-08-26T00:00:00Z'), 2025);
    expect(v.isStale).toBe(true);
    expect(v.yearsBehind).toBe(1);
    expect(fplStalenessNotice(v)).not.toBeNull();
  });

  it('detects a multi-year gap and counts it correctly', () => {
    const v = checkFplVintage(on('2028-03-01T00:00:00Z'), 2025);
    expect(v.yearsBehind).toBe(3);
    expect(fplStalenessNotice(v)).toContain('3 years out of date');
  });

  it('fires at the UTC new year regardless of the server timezone', () => {
    // The realistic failure: nobody updates the table over the new year.
    // This test originally used getFullYear() and failed -- at a Texas centre
    // (UTC-6) local time still reads the old year for the first six hours of
    // 1 January, so the guard stayed silent exactly when it was most needed.
    const v = checkFplVintage(on('2027-01-01T00:00:00Z'), 2026);
    expect(v.isStale).toBe(true);
    expect(v.yearsBehind).toBe(1);
  });

  it('does not depend on the machine timezone', () => {
    // Same instant, expressed as a US-Central wall clock inside the new year.
    const v = checkFplVintage(on('2027-01-01T08:00:00Z'), 2026);
    expect(v.isStale).toBe(true);
  });

  it('says which WAY the error runs, not merely that it exists', () => {
    const notice = fplStalenessNotice(checkFplVintage(on('2026-08-26T00:00:00Z'), 2025))!;
    // A reader told "may be out of date" assumes the effect is random. It isn't:
    // stale tables understate eligibility, so this reader specifically needs to
    // know they might qualify for MORE than they were just shown.
    expect(notice).toContain('understate');
    expect(notice).toContain('more than is shown');
    expect(notice).toContain('2025');
  });
});

describe('the guard STAYS SILENT when the tables are current', () => {
  // A guard proven only to refuse fails exactly as badly as one proven only to
  // allow. These are the accept-path cases.
  it('is silent when the guideline year matches the run year', () => {
    const v = checkFplVintage(on('2025-06-15T00:00:00Z'), 2025);
    expect(v.isStale).toBe(false);
    expect(v.yearsBehind).toBe(0);
    expect(fplStalenessNotice(v)).toBeNull();
  });

  it('is silent on 31 December, the last day the tables are still current', () => {
    const v = checkFplVintage(on('2025-12-31T23:59:59Z'), 2025);
    expect(v.isStale).toBe(false);
    expect(fplStalenessNotice(v)).toBeNull();
  });

  it('does not fire when the tables are AHEAD of the run date', () => {
    // Guidelines published early, or a clock skewed backwards. Not stale.
    const v = checkFplVintage(on('2025-02-01T00:00:00Z'), 2026);
    expect(v.isStale).toBe(false);
    expect(v.yearsBehind).toBe(0);
    expect(fplStalenessNotice(v)).toBeNull();
  });
});

describe('the embedded constant reflects reality', () => {
  it('is the year actually written into the context document', () => {
    // contexts/community/benefits-navigator.md is headed
    // "2025 HHS Poverty Guidelines". If someone updates that file they must
    // update this constant in the SAME commit -- raising it alone would turn a
    // loud wrong answer back into a silent one.
    expect(EMBEDDED_FPL_GUIDELINE_YEAR).toBe(2025);
  });

  it('is currently stale, which is the live defect this guard exists for', () => {
    // Not a hypothetical: as of today the shipped tables are behind.
    const v = checkFplVintage(new Date());
    expect(v.isStale).toBe(true);
  });
});
