//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

import type { HouseholdVars, ChatMessage } from '@/types/session';

type RawVars = Partial<HouseholdVars> & { annual_income?: string };

export interface IntakeField {
  key: string;
  label: string;
  rationale: string;
  prompt: string;
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
      // Annual: "$42k", "$42,000"
      const annualMatch = message.match(/\$\s*([\d,]+)\s*k?\b/i);
      if (annualMatch) {
        const raw = annualMatch[1].replace(/,/g, '');
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
