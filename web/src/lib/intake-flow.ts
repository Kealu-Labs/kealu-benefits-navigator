//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Intake flow logic for the guided household information collection conversation.
 *
 * The intake is structured in two tiers:
 *   - Tier 1: Minimum required fields (ZIP, income, household composition). Research
 *             cannot start without these because FPL calculations and state/county
 *             program lookups depend on all three.
 *   - Tier 2: Improves plan matching quality (coverage, medications, providers, budget,
 *             health needs). These are optional — users can skip via the skip button.
 *
 * Field extraction is done by regex against the user's free-text message; the approach
 * mirrors the Python MCP server's `_INTAKE_FIELDS` / `_ZIP_RE` / `_INCOME_PATTERNS`
 * implementation (mcp_server.py lines 42–57, 412–631).
 */

import type { HouseholdVars, ChatMessage } from '@/types/session';

/** Partial HouseholdVars plus the extra `annual_income` runtime variable. */
type RawVars = Partial<HouseholdVars> & { annual_income?: string };

/** Definition of a single guided intake question. */
export interface IntakeField {
  /** Key into RawVars / HouseholdVars; used to check whether the field is already answered. */
  key: string;
  /** Short human-readable label for this field. */
  label: string;
  /** One-sentence explanation of why this information is needed. Shown below the prompt. */
  rationale: string;
  /** Full text of the question to display to the user. */
  prompt: string;
  /** Intake tier this field belongs to (1 = required, 2 = optional). */
  tier: 1 | 2 | 3;
}

/** Tier 1 fields — minimum required to start research. */
export const TIER_1_FIELDS: IntakeField[] = [
  {
    key: 'zip_code',
    label: 'ZIP Code',
    rationale: 'Required for marketplace plan lookup and state/county benefit programs.',
    prompt: 'What is your ZIP code?',
    tier: 1,
  },
  {
    key: 'annual_income',
    label: 'Annual Income',
    rationale: 'Used to calculate FPL percentage for eligibility thresholds.',
    prompt: 'What is your estimated annual household income? (e.g., "$42,000" or "$3,500/month")',
    tier: 1,
  },
  {
    key: 'household_profile',
    label: 'Household Composition',
    rationale: 'Household size and member ages determine FPL thresholds and program eligibility.',
    prompt:
      'Please describe your household: how many people, their ages, and any special circumstances (e.g., pregnancy, disability, veteran status)?',
    tier: 1,
  },
];

/** Tier 2 fields — improve plan matching quality. */
export const TIER_2_FIELDS: IntakeField[] = [
  {
    key: 'current_coverage',
    label: 'Current Coverage',
    rationale: 'Determines whether gap coverage or transition assistance is needed.',
    prompt: 'Are you currently insured? If so, through what (employer, COBRA, etc.)? If not, how long have you been uninsured?',
    tier: 2,
  },
  {
    key: 'medications',
    label: 'Medications',
    rationale: 'Formulary matching ensures plan covers needed prescriptions.',
    prompt: 'What prescription medications do you or household members take regularly? (Include drug name, dosage, and frequency, or "none".)',
    tier: 2,
  },
  {
    key: 'providers',
    label: 'Current Providers',
    rationale: 'Network matching keeps you with existing doctors.',
    prompt: 'Do you have doctors or specialists you need to keep? (Name, practice, specialty — or "none".)',
    tier: 2,
  },
  {
    key: 'premium_budget',
    label: 'Premium Budget',
    rationale: 'Filters plans by affordability.',
    prompt: 'What is the maximum monthly premium you can afford? (e.g., "$300/month" or "as low as possible")',
    tier: 2,
  },
  {
    key: 'health_needs',
    label: 'Health Needs',
    rationale: 'Identifies chronic conditions and anticipated care to match cost-sharing.',
    prompt: 'Do you or household members have any chronic conditions, planned procedures, or specific health needs?',
    tier: 2,
  },
];

/** All intake fields in display order (Tier 1 followed by Tier 2). */
export const ALL_FIELDS: IntakeField[] = [...TIER_1_FIELDS, ...TIER_2_FIELDS];

/** Total number of intake steps shown in the progress indicator. */
export const TOTAL_STEPS = ALL_FIELDS.length;

/**
 * Field keys whose values are extracted/normalized from free text by
 * parseUserMessage (ZIP validation, income annualization). All other fields
 * store the user's raw answer verbatim, keyed by the question being asked.
 */
export const PARSED_KEYS = new Set<string>(['zip_code', 'annual_income', 'household_profile']);

/** 1-based step number for a field key, or null if the key is not an intake field. */
export function getFieldStep(key: string): number | null {
  const idx = ALL_FIELDS.findIndex((f) => f.key === key);
  return idx === -1 ? null : idx + 1;
}

/** A single answered intake field, safe to show back to the owning session for review/edit. */
export interface IntakeAnswer {
  key: string;
  label: string;
  value: string;
  tier: 1 | 2 | 3;
}

/**
 * Build the ordered list of answered fields (non-empty values).
 *
 * This is the only place collected vars are surfaced for display, and it is
 * returned exclusively to the owning session (see GET /api/intake) so the user
 * can review and correct what they typed — never to a third party.
 */
export function buildAnswers(vars: RawVars): IntakeAnswer[] {
  const out: IntakeAnswer[] = [];
  for (const f of ALL_FIELDS) {
    const value = (vars as Record<string, string | undefined>)[f.key];
    if (value && value.trim().length > 0) {
      out.push({ key: f.key, label: f.label, value, tier: f.tier });
    }
  }
  return out;
}

/**
 * Extract structured vars from a free-text user message.
 * Does not overwrite existing vars that are already set.
 */
export function parseUserMessage(message: string, existing: RawVars): RawVars {
  const result: RawVars = { ...existing };

  // ZIP code extraction — 5-digit or ZIP+4
  if (!result.zip_code) {
    const zipMatch = message.match(/\b(\d{5}(?:-\d{4})?)\b/);
    if (zipMatch) {
      result.zip_code = zipMatch[1];
    }
  }

  // Income extraction
  if (!result.annual_income) {
    // Monthly: "$3,500/month" or "$3,500 per month" → annualize
    const monthlyMatch = message.match(/\$\s*([\d,]+)\s*(?:\/\s*mo(?:nth)?|per\s+mo(?:nth)?)/i);
    if (monthlyMatch) {
      const monthly = parseInt(monthlyMatch[1].replace(/,/g, ''), 10);
      result.annual_income = String(monthly * 12);
    } else {
      // Annual: "$42k" → 42000, "$42,000" → 42000
      const annualMatch = message.match(/\$\s*([\d,]+)\s*k?\b/i);
      if (annualMatch) {
        const raw = annualMatch[1].replace(/,/g, '');
        // Multiply by 1000 when the matched text ends with 'k' (shorthand: "$42k" = 42000)
        const suffix = annualMatch[0].toLowerCase().endsWith('k') ? 1000 : 1;
        result.annual_income = String(parseInt(raw, 10) * suffix);
      }
    }
  }

  // Household composition — look for family/household mentions
  if (!result.household_profile) {
    const hasFamily =
      /\b(single\s+parent|family|household|kids?|children|child|spouse|partner|husband|wife|son|daughter)\b/i.test(
        message,
      );
    if (hasFamily) {
      result.household_profile = message.trim();
    }
  }

  return result;
}

/**
 * Returns true when all Tier 1 required fields have non-empty values.
 */
export function isTier1Complete(vars: RawVars): boolean {
  const zipOk = typeof vars.zip_code === 'string' && vars.zip_code.trim().length > 0;
  const incomeOk = typeof vars.annual_income === 'string' && vars.annual_income.trim().length > 0;
  const profileOk =
    typeof vars.household_profile === 'string' && vars.household_profile.trim().length > 0;
  return zipOk && incomeOk && profileOk;
}

/**
 * Return the next unanswered IntakeField for the given tier, or null if all fields answered.
 * Returns null immediately when skipIntake is true.
 */
export function getNextQuestion(
  vars: RawVars,
  currentTier: number,
  skipIntake: boolean,
): IntakeField | null {
  if (skipIntake) return null;

  // Tier 1 first
  for (const field of TIER_1_FIELDS) {
    const value = (vars as Record<string, string | undefined>)[field.key];
    if (!value || value.trim().length === 0) return field;
  }

  // Tier 2 is only reached once all Tier 1 fields are present.
  // currentTier is updated server-side by the intake route when tier 1 is complete.
  if (currentTier < 2) return null;

  // Tier 2
  for (const field of TIER_2_FIELDS) {
    const value = (vars as Record<string, string | undefined>)[field.key];
    if (!value || value.trim().length === 0) return field;
  }

  return null;
}

/**
 * Returns true if the exact same user message already exists in message history.
 */
export function isIdempotentSubmission(messages: ChatMessage[], content: string): boolean {
  return messages.some((m) => m.role === 'user' && m.content === content);
}

/**
 * Build a human-readable summary string from populated household vars.
 */
export function buildHouseholdProfile(vars: RawVars): string {
  const parts: string[] = [];
  if (vars.zip_code) parts.push(`ZIP: ${vars.zip_code}`);
  if (vars.annual_income) parts.push(`Income: $${vars.annual_income}/year`);
  if (vars.household_profile) parts.push(vars.household_profile);
  if (vars.state) parts.push(vars.state);
  return parts.join(' | ');
}
