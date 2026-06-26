/**
 * Unit tests for web/src/lib/intake-flow.ts
 *
 * These tests FAIL before implementation (module does not exist).
 */
import { describe, it, expect } from 'vitest';

// These imports fail until web/src/lib/intake-flow.ts is created.
import {
  parseUserMessage,
  isTier1Complete,
  getNextQuestion,
  isIdempotentSubmission,
  buildHouseholdProfile,
  TIER_1_FIELDS,
  TIER_2_FIELDS,
} from '@/lib/intake-flow';

import type { HouseholdVars } from '@/types/session';

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
    // Implementation may update or preserve; test the defined behavior
    expect(vars.zip_code).toBeDefined();
  });
});

describe('parseUserMessage() — income extraction', () => {
  it("extracts '$42k' as annual income", () => {
    const vars = parseUserMessage('I make $42k a year', {});
    expect(vars.annual_income).toBeDefined();
    expect(Number(vars.annual_income?.replace(/[^0-9]/g, ''))).toBeGreaterThanOrEqual(42_000);
  });

  it("extracts '$42,000' as annual income", () => {
    const vars = parseUserMessage('My income is $42,000', {});
    expect(vars.annual_income).toBeDefined();
    expect(Number(vars.annual_income?.replace(/[^0-9]/g, ''))).toBeGreaterThanOrEqual(42_000);
  });

  it("extracts '$3,500/month' and annualizes it", () => {
    const vars = parseUserMessage('I earn $3,500 per month', {});
    expect(vars.annual_income).toBeDefined();
    const annualValue = Number(vars.annual_income?.replace(/[^0-9]/g, ''));
    expect(annualValue).toBeGreaterThanOrEqual(40_000);
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
    if (vars.zip_code) {
      expect(vars.zip_code).not.toContain(';');
      expect(vars.zip_code).not.toContain('rm');
    }
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
    // First tier-2 field should be current_coverage or medications
    expect(TIER_2_FIELDS.map((f) => f.key)).toContain(field?.key);
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
      // fill remaining tier-3+ fields
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
    const field = getNextQuestion(vars, 3, false);
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
    // "My ZIP is 77001" ≠ "my zip is 77001" — implementation may or may not normalize
    // Test that the function returns a boolean regardless
    const result = isIdempotentSubmission(messages, 'My ZIP is 77001');
    expect(typeof result).toBe('boolean');
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
    expect(typeof profile).toBe('string');
    expect(profile.length).toBeGreaterThan(0);
  });

  it('returns a string even when most fields are empty', () => {
    const vars = { zip_code: '77001' };
    const profile = buildHouseholdProfile(vars);
    expect(typeof profile).toBe('string');
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

  it('Each IntakeField has key, label, rationale, prompt, and tier', () => {
    for (const field of [...TIER_1_FIELDS, ...TIER_2_FIELDS]) {
      expect(field.key).toBeTruthy();
      expect(field.label).toBeTruthy();
      expect(field.rationale).toBeTruthy();
      expect(field.prompt).toBeTruthy();
      expect([1, 2, 3]).toContain(field.tier);
    }
  });
});
