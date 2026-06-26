//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * HouseholdVars — maps 1:1 to the `variables:` block in benefits-navigator.yaml,
 * plus `annual_income` which is an extra runtime var passed via --var.
 */
export interface HouseholdVars {
  household_profile: string;
  state: string;
  county: string;
  zip_code: string;
  income_type: string;
  medications: string;
  providers: string;
  health_needs: string;
  usage_pattern: string;
  current_coverage: string;
  premium_budget: string;
  network_preference: string;
  pharmacy_preference: string;
  existing_benefits: string;
  assets: string;
  expected_income_change: string;
}

/**
 * Runtime-inspectable manifest of HouseholdVars keys.
 * Includes all 16 YAML variables + annual_income (extra runtime var).
 */
export const HOUSEHOLD_VARS_KEYS: string[] = [
  'household_profile',
  'state',
  'county',
  'zip_code',
  'income_type',
  'medications',
  'providers',
  'health_needs',
  'usage_pattern',
  'current_coverage',
  'premium_budget',
  'network_preference',
  'pharmacy_preference',
  'existing_benefits',
  'assets',
  'expected_income_change',
  'annual_income',
];

export type RunStatus = 'idle' | 'running' | 'complete' | 'error';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface PhaseEvent {
  event_type: string;
  phase?: string;
  message?: string;
  [key: string]: unknown;
}

export interface Session {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  currentTier: number;
  skipIntake: boolean;
  vars: Partial<HouseholdVars> & { annual_income?: string };
  messages: ChatMessage[];
  runId?: string;
  runStatus?: RunStatus;
  reportContent?: unknown;
}
