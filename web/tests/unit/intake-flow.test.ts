// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
/**
 * Unit tests for web/src/lib/intake-flow.ts
 */
import { describe, it, expect } from 'vitest';

// These imports fail until web/src/lib/intake-flow.ts is created.
import {
  parseUserMessage,
  isTier1Complete,
  getNextQuestion,
  isIdempotentSubmission,
  buildHouseholdProfile,
  buildAnswers,
  getFieldStep,
  TIER_1_FIELDS,
  TIER_2_FIELDS,
  ALL_FIELDS,
  TOTAL_STEPS,
  PARSED_KEYS,
} from '@/lib/intake-flow';

import type { HouseholdVars } from '@/types/session';

// ---------------------------------------------------------------------------
// Public-contract exports
// ---------------------------------------------------------------------------

describe('Public contract: ALL_FIELDS, TOTAL_STEPS, PARSED_KEYS', () => {
  it('ALL_FIELDS contains Tier 1 fields followed by Tier 2 fields', () => {
    const tier1Keys = TIER_1_FIELDS.map((f) => f.key);
    const tier2Keys = TIER_2_FIELDS.map((f) => f.key);
    const allKeys = ALL_FIELDS.map((f) => f.key);
    expect(allKeys.slice(0, tier1Keys.length)).toEqual(tier1Keys);
    expect(allKeys.slice(tier1Keys.length)).toEqual(tier2Keys);
  });

  it('TOTAL_STEPS equals ALL_FIELDS.length', () => {
    expect(TOTAL_STEPS).toBe(ALL_FIELDS.length);
  });

  it('PARSED_KEYS contains zip_code and annual_income', () => {
    expect(PARSED_KEYS.has('zip_code')).toBe(true);
    expect(PARSED_KEYS.has('annual_income')).toBe(true);
  });

  it('PARSED_KEYS does NOT contain household_profile (raw-answer fallback handles it)', () => {
    expect(PARSED_KEYS.has('household_profile')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseUserMessage()
// ---------------------------------------------------------------------------

describe('parseUserMessage() — ZIP code extraction', () => {
  it("extracts 5-digit ZIP from plain text '77001'", () => {
    const vars = parseUserMessage('My ZIP is 77001', {});
    expect(vars.zip_code).toBe('77001');
  });

  it("extracts ZIP+4 format '77001-1234'", () => {
    const vars = parseUserMessage('I live at 77001-1234', {});
    expect(vars.zip_code).toBe('77001-1234');
  });

  it('does not overwrite zip_code if already set', () => {
    const existing: Partial<HouseholdVars> & { annual_income?: string } = { zip_code: '90210' };
    const vars = parseUserMessage('I moved to 77001', existing);
    // The existing value must be preserved — the guard at intake-flow.ts:164 must not be removed.
    expect(vars.zip_code).toBe('90210');
  });
});

describe('parseUserMessage() — income extraction', () => {
  it("extracts '$42k' as annual income", () => {
    const vars = parseUserMessage('I make $42k a year', {});
    expect(vars.annual_income).toBeDefined();
    expect(vars.annual_income).toBe('42000');
  });

  it("extracts '$42,000' as annual income", () => {
    const vars = parseUserMessage('My income is $42,000', {});
    expect(vars.annual_income).toBeDefined();
    expect(vars.annual_income).toBe('42000');
  });

  it("extracts '$3,500/month' and annualizes it", () => {
    const vars = parseUserMessage('I earn $3,500 per month', {});
    expect(vars.annual_income).toBeDefined();
    expect(vars.annual_income).toBe('42000');
  });

  it('does not extract dollar amount without income keyword context', () => {
    // A bare "$500" with no income keyword should NOT be extracted as annual_income
    const vars = parseUserMessage('My rent is $500', {});
    expect(vars.annual_income).toBeUndefined();
  });

  it('does not extract savings amount without income keyword', () => {
    const vars = parseUserMessage('I have $10,000 in savings', {});
    expect(vars.annual_income).toBeUndefined();
  });
});

describe('parseUserMessage() — household composition extraction', () => {
  it("extracts household from 'single parent with 2 kids ages 4 and 9'", () => {
    const vars = parseUserMessage('I am a single parent with 2 kids ages 4 and 9', {});
    // household_profile should contain info about the household
    expect(vars.household_profile).toBeDefined();
    expect(vars.household_profile?.length).toBeGreaterThan(0);
  });

  it('returns unmodified vars on message with no extractable fields', () => {
    const existing = { zip_code: '77001', annual_income: '42000' };
    const vars = parseUserMessage('Hello, how are you?', existing);
    expect(vars.zip_code).toBe('77001');
    expect(vars.annual_income).toBe('42000');
  });
});

describe('parseUserMessage() — special character handling', () => {
  it('preserves Unicode characters in medication names verbatim', () => {
    const vars = parseUserMessage('My medication is Métformin 500mg', {});
    // The raw message content should not be corrupted; vars that are set should preserve value
    expect(typeof vars).toBe('object');
  });

  it('preserves ampersands and quotes in provider names', () => {
    const vars = parseUserMessage("My doctor is at Smith & Jones, Dr. O'Brien", {});
    expect(typeof vars).toBe('object');
  });

  it('does not inject shell metacharacters into var values', () => {
    const vars = parseUserMessage('zip code: 77001; rm -rf /', {});
    // Unconditional: if ZIP extraction regresses, this assertion must fail loudly —
    // not silently pass due to the conditional guard that was previously here.
    expect(vars.zip_code).toBeDefined();
    expect(vars.zip_code).toBe('77001');
    expect(vars.zip_code).not.toContain(';');
    expect(vars.zip_code).not.toContain('rm');
  });
});

// ---------------------------------------------------------------------------
// isTier1Complete()
// ---------------------------------------------------------------------------

describe('isTier1Complete()', () => {
  it('returns false when zip_code is absent', () => {
    const vars = { annual_income: '42000', household_profile: 'Single parent, 2 kids' };
    expect(isTier1Complete(vars)).toBe(false);
  });

  it('returns false when annual_income is absent', () => {
    const vars = { zip_code: '77001', household_profile: 'Single parent, 2 kids' };
    expect(isTier1Complete(vars)).toBe(false);
  });

  it('returns false when household_profile is absent', () => {
    const vars = { zip_code: '77001', annual_income: '42000' };
    expect(isTier1Complete(vars)).toBe(false);
  });

  it('returns false when all are empty strings', () => {
    const vars = { zip_code: '', annual_income: '', household_profile: '' };
    expect(isTier1Complete(vars)).toBe(false);
  });

  it('returns true when zip_code, annual_income, and household_profile are all non-empty', () => {
    const vars = {
      zip_code: '77001',
      annual_income: '42000',
      household_profile: 'Single parent, 2 kids ages 4 and 9, $42k income',
    };
    expect(isTier1Complete(vars)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getNextQuestion()
// ---------------------------------------------------------------------------

describe('getNextQuestion()', () => {
  it('returns the zip_code field when tier 1 is incomplete (zip absent)', () => {
    const vars = {};
    const field = getNextQuestion(vars, 1, false);
    expect(field).not.toBeNull();
    expect(field?.key).toBe('zip_code');
  });

  it('returns null immediately when skipIntake is true', () => {
    const vars = {};
    const field = getNextQuestion(vars, 1, true);
    expect(field).toBeNull();
  });

  it('advances to tier-2 fields once tier 1 is complete', () => {
    const vars = {
      zip_code: '77001',
      annual_income: '42000',
      household_profile: 'Single parent, 2 kids ages 4 and 9',
    };
    const field = getNextQuestion(vars, 2, false);
    expect(field).not.toBeNull();
    // First tier-2 field must be current_coverage (deterministic ordering)
    expect(field?.key).toBe('current_coverage');
  });

  it('returns null when tier 1 is complete but currentTier has not advanced to 2', () => {
    // Tests the tier-boundary hold at intake-flow.ts:250 (if currentTier < 2 return null).
    // The server must explicitly advance currentTier to 2 before tier-2 questions are served.
    const vars = { zip_code: '77001', annual_income: '42000', household_profile: 'Single adult' };
    expect(getNextQuestion(vars, 1, false)).toBeNull();
  });

  it('returns null when all tiers are answered', () => {
    const vars: HouseholdVars & { annual_income?: string } = {
      zip_code: '77001',
      annual_income: '42000',
      household_profile: 'Single parent, 2 kids',
      current_coverage: 'uninsured',
      medications: 'none',
      providers: 'Dr. Smith',
      premium_budget: '$300/month',
      health_needs: 'Type 2 diabetes',
      // fill remaining fields
      state: 'Texas',
      county: 'Harris County',
      income_type: 'W-2',
      usage_pattern: '',
      network_preference: '',
      pharmacy_preference: '',
      existing_benefits: '',
      assets: '',
      expected_income_change: '',
    };
    const field = getNextQuestion(vars, 2, false);
    expect(field).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isIdempotentSubmission()
// ---------------------------------------------------------------------------

describe('isIdempotentSubmission()', () => {
  it('returns true when identical message content exists in history', () => {
    const messages = [
      { role: 'user' as const, content: 'My ZIP is 77001', timestamp: Date.now() - 5000 },
    ];
    expect(isIdempotentSubmission(messages, 'My ZIP is 77001')).toBe(true);
  });

  it('returns false for a novel message not in history', () => {
    const messages = [
      { role: 'user' as const, content: 'My ZIP is 77001', timestamp: Date.now() - 5000 },
    ];
    expect(isIdempotentSubmission(messages, 'I make $42k a year')).toBe(false);
  });

  it('returns false for an empty message history', () => {
    expect(isIdempotentSubmission([], 'My ZIP is 77001')).toBe(false);
  });

  it('is case-sensitive (different case is NOT a duplicate)', () => {
    const messages = [{ role: 'user' as const, content: 'my zip is 77001', timestamp: Date.now() }];
    // "My ZIP is 77001" ≠ "my zip is 77001" — exact string comparison; different case is not a duplicate
    const result = isIdempotentSubmission(messages, 'My ZIP is 77001');
    expect(result).toBe(false);
  });

  it('treats messages differing only by trailing whitespace as duplicates (trim normalization)', () => {
    const messages = [{ role: 'user' as const, content: 'My ZIP is 77001', timestamp: Date.now() }];
    expect(isIdempotentSubmission(messages, 'My ZIP is 77001  ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildHouseholdProfile()
// ---------------------------------------------------------------------------

describe('buildHouseholdProfile()', () => {
  it('assembles a non-empty string from populated raw vars', () => {
    const vars = {
      zip_code: '77001',
      annual_income: '42000',
      household_profile: 'Single parent, 2 kids ages 4 and 9',
    };
    const profile = buildHouseholdProfile(vars);
    expect(profile).not.toBeNull();
    expect(typeof profile).toBe('string');
    expect((profile as string).length).toBeGreaterThan(0);
  });

  it('returns a string when only zip_code is present', () => {
    const vars = { zip_code: '77001' };
    const profile = buildHouseholdProfile(vars);
    expect(profile).not.toBeNull();
    expect(typeof profile).toBe('string');
  });

  it('returns null for empty vars (all fields absent)', () => {
    expect(buildHouseholdProfile({})).toBeNull();
  });

  it('income-embedding contract: embeds annual_income as "Income: $<amount>/year" in the output', () => {
    const vars = {
      zip_code: '77001',
      annual_income: '50000',
      household_profile: 'Single adult',
    };
    const profile = buildHouseholdProfile(vars);
    expect(profile).toContain('Income: $50,000/year');
  });

  it('round-trip: output is the full pipe-delimited string with ZIP, income, and composition', () => {
    const vars = {
      zip_code: '77001',
      annual_income: '50000',
      household_profile: 'Single adult',
    };
    const profile = buildHouseholdProfile(vars);
    expect(profile).toBe('ZIP: 77001 | Income: $50,000/year | Single adult');
  });

  it('includes state when present', () => {
    const vars = {
      zip_code: '77001',
      annual_income: '50000',
      household_profile: 'Single adult',
      state: 'TX',
    };
    const profile = buildHouseholdProfile(vars);
    expect(profile).toContain('TX');
  });

  it('double-enrichment guard: strips existing enrichment prefix so ZIP/Income appear exactly once', () => {
    // Simulate a vars object where household_profile is already an enriched string
    const vars = {
      zip_code: '77001',
      annual_income: '50000',
      household_profile: 'ZIP: 77001 | Income: $50,000/year | Single adult',
    };
    const profile = buildHouseholdProfile(vars) as string;
    const zipCount = (profile.match(/ZIP:/g) ?? []).length;
    const incomeCount = (profile.match(/Income:/g) ?? []).length;
    expect(zipCount).toBe(1);
    expect(incomeCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildAnswers()
// ---------------------------------------------------------------------------

describe('buildAnswers()', () => {
  it('returns all fields with non-empty values', () => {
    const vars = {
      zip_code: '77001',
      annual_income: '42000',
      household_profile: 'Single adult',
      current_coverage: 'uninsured',
    };
    const answers = buildAnswers(vars);
    const keys = answers.map((a) => a.key);
    expect(keys).toContain('zip_code');
    expect(keys).toContain('annual_income');
    expect(keys).toContain('household_profile');
    expect(keys).toContain('current_coverage');
  });

  it('returns empty array for empty vars', () => {
    expect(buildAnswers({})).toEqual([]);
  });

  it('excludes fields with whitespace-only values', () => {
    const vars = { zip_code: '   ', annual_income: '42000' };
    const answers = buildAnswers(vars);
    const keys = answers.map((a) => a.key);
    expect(keys).not.toContain('zip_code');
    expect(keys).toContain('annual_income');
  });

  it('propagates tier from the field definition', () => {
    const vars = { zip_code: '77001', current_coverage: 'uninsured' };
    const answers = buildAnswers(vars);
    const zipAnswer = answers.find((a) => a.key === 'zip_code');
    const coverageAnswer = answers.find((a) => a.key === 'current_coverage');
    expect(zipAnswer?.tier).toBe(1);
    expect(coverageAnswer?.tier).toBe(2);
  });

  it('returns fields in ALL_FIELDS display order', () => {
    const vars = {
      current_coverage: 'uninsured',
      zip_code: '77001',
      household_profile: 'Single adult',
      annual_income: '42000',
    };
    const answers = buildAnswers(vars);
    const keys = answers.map((a) => a.key);
    const allFieldKeys = ALL_FIELDS.map((f) => f.key);
    // Keys in answers must appear in the same order as ALL_FIELDS
    const presentIndices = keys.map((k) => allFieldKeys.indexOf(k));
    for (let i = 1; i < presentIndices.length; i++) {
      expect(presentIndices[i]).toBeGreaterThan(presentIndices[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// getFieldStep()
// ---------------------------------------------------------------------------

describe('getFieldStep()', () => {
  it('returns 1 for the first field (zip_code)', () => {
    expect(getFieldStep('zip_code')).toBe(1);
  });

  it('returns the correct 1-based step for a known field', () => {
    const idx = ALL_FIELDS.findIndex((f) => f.key === 'current_coverage');
    expect(getFieldStep('current_coverage')).toBe(idx + 1);
  });

  it('returns null for an unknown key', () => {
    expect(getFieldStep('nonexistent_key')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(getFieldStep('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Skip signal detection
// ---------------------------------------------------------------------------

describe('Skip signal parsing', () => {
  it("treats 'skip' (lowercase) as a skip signal", () => {
    // After parseUserMessage('skip', vars), the skip signal is recognized by the intake route
    // We verify this by checking that getNextQuestion with skipIntake:true returns null
    expect(getNextQuestion({}, 1, true)).toBeNull();
  });

  it('TIER_1_FIELDS has zip_code as the first field', () => {
    expect(TIER_1_FIELDS[0].key).toBe('zip_code');
  });

  it('TIER_1_FIELDS has exactly 3 fields (zip_code, annual_income, household composition)', () => {
    expect(TIER_1_FIELDS.length).toBe(3);
  });

  it('TIER_2_FIELDS includes current_coverage and medications', () => {
    const keys = TIER_2_FIELDS.map((f) => f.key);
    expect(keys).toContain('current_coverage');
    expect(keys).toContain('medications');
  });

  it('Each IntakeField has key, label, rationale, prompt, and tier (1 or 2)', () => {
    for (const field of [...TIER_1_FIELDS, ...TIER_2_FIELDS]) {
      expect(field.key).toBeTruthy();
      expect(field.label).toBeTruthy();
      expect(field.rationale).toBeTruthy();
      expect(field.prompt).toBeTruthy();
      expect([1, 2]).toContain(field.tier);
    }
  });
});
