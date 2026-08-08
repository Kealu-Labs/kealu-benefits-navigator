//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

/**
 * Shared TypeScript types for session state, workflow events, and report payloads.
 *
 * These types form the single source of truth shared between:
 * - Server-side lib modules (session-store, kvr-runner, report-assembler)
 * - API route handlers (web/src/app/api/)
 * - Client components (web/src/components/)
 *
 * Keep this file free of runtime logic — it is imported by both server and client bundles.
 */

/**
 * HouseholdVars — maps 1:1 to the `variables:` block in benefits-navigator.yaml,
 * plus `annual_income` which is an extra runtime var passed via `--var` at run time.
 *
 * All fields are `string` because KVR accepts only string `--var` values.
 * Fields are intentionally non-optional here; use `Partial<HouseholdVars>` for
 * partially-filled intake state.
 */
export interface HouseholdVars {
  /** Natural-language description of household members, ages, and special circumstances. */
  household_profile: string;
  /** Two-letter US state abbreviation derived from the ZIP code. */
  state: string;
  /** County name for county-specific benefit programs. */
  county: string;
  /** Five-digit ZIP code (or ZIP+4). */
  zip_code: string;
  /** Employment type: "employed", "self-employed", "unemployed", etc. */
  income_type: string;
  /** Comma-separated list of prescription medications, or "none". */
  medications: string;
  /** Current physicians or specialists the household wants to keep in-network. */
  providers: string;
  /** Chronic conditions, planned procedures, or other anticipated healthcare needs. */
  health_needs: string;
  /** Expected care frequency: "low", "moderate", "high". */
  usage_pattern: string;
  /** Existing coverage: "uninsured", "employer", "COBRA", "marketplace", etc. */
  current_coverage: string;
  /** Maximum monthly premium the household can afford (e.g., "$300/month"). */
  premium_budget: string;
  /** Preferred network type: "HMO", "PPO", "any", etc. */
  network_preference: string;
  /** Preferred pharmacy or "any". */
  pharmacy_preference: string;
  /** Any existing benefits already enrolled in (Medicaid, CHIP, VA, etc.). */
  existing_benefits: string;
  /** Household liquid assets — relevant for Medicaid asset tests. */
  assets: string;
  /** Anticipated income change in the next 12 months. */
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

/** Lifecycle state of a KVR workflow run. */
export type RunStatus = 'idle' | 'running' | 'complete' | 'error';

/** A single message exchanged during the intake conversation. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Unix timestamp in milliseconds (Date.now()). */
  timestamp: number;
  /**
   * For user messages: the intake field key that was pending when this
   * message was recorded (i.e. the question it answered). Used by duplicate
   * detection so the same answer to two different questions is never treated
   * as a resubmission. Absent on assistant messages and legacy sessions.
   */
  answeredField?: string;
}

/**
 * A `[PHASE_STREAM]` event emitted by the KVR subprocess on stdout.
 * Deserialized from JSON; extra fields are preserved via the index signature
 * so downstream code can access phase-specific metadata without type assertions.
 */
export interface PhaseEvent {
  /** Discriminator: "workflow_start" | "phase_start" | "phase_complete" | "error". */
  event_type: string;
  /** Phase identifier, e.g. "benefits-research". Present on phase_start/complete events. */
  phase?: string;
  /** Human-readable message. Present on error events. */
  message?: string;
  /** Additional phase-specific metadata from KVR. */
  [key: string]: unknown;
}

/**
 * Server-side session state stored in the in-memory SessionStore.
 *
 * Only serializable primitives and plain objects are stored here so that the
 * session can be JSON-stringified for debugging without circular references.
 * PII fields (vars, reportContent) are never sent to the client via API responses.
 */
export interface Session {
  /** UUID v4 — the value stored in the `session` httpOnly cookie. */
  sessionId: string;
  /** Unix timestamp (ms) when the session was created. */
  createdAt: number;
  /** Unix timestamp (ms) after which the session is expired and evicted. */
  expiresAt: number;
  /**
   * Current intake tier (1–3). Advances automatically when all fields for
   * the current tier are answered.
   */
  currentTier: number;
  /** True when the user clicked "Skip remaining questions" or sent "skip". */
  skipIntake: boolean;
  /**
   * Key of the intake field most recently asked and still awaiting an answer.
   * The next free-text message is stored under this key for fields that are not
   * regex-extracted (i.e. the Tier 2 questions). Undefined before the first
   * server-issued question.
   */
  pendingField?: string;
  /**
   * Accumulated intake variables. Uses `Partial` because collection is
   * incremental; `annual_income` is added as an extra key not in HouseholdVars.
   */
  vars: Partial<HouseholdVars> & { annual_income?: string };
  /** Ordered chat history for the intake conversation. */
  messages: ChatMessage[];
  /** UUID v4 of the most recently started KVR workflow run, if any. */
  runId?: string;
  /** Current status of the most recently started run. */
  runStatus?: RunStatus;
  /**
   * Cached assembled report. Populated by the report route on first fetch and
   * used on subsequent requests after the run directory is deleted.
   */
  reportContent?: unknown;
  /**
   * Absolute filesystem path to the pre-filled benefit application draft PDF.
   * Server-side only — never serialized to the client. null when no draft was generated.
   */
  draftPath?: string | null;
  /**
   * Form type of the draft PDF. "official" for a real state AcroForm,
   * "worksheet" for the fallback worksheet PDF. null when no draft was generated.
   */
  draftFormType?: 'official' | 'worksheet' | null;
}
