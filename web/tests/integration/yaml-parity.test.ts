/**
 * Integration test: YAML variable parity with TypeScript HouseholdVars interface.
 *
 * These tests FAIL before implementation (modules do not exist).
 *
 * Reads workflows/benefits-navigator.yaml directly from the repo root,
 * parses the 'variables:' block, and asserts that every YAML variable name
 * appears as a key in the HouseholdVars TypeScript interface.
 *
 * This cross-stack parity test catches:
 * - Missing variables in the TypeScript implementation
 * - Extra variables in TypeScript that have no YAML counterpart
 * - The advisory resolution: annual_income is an EXTRA runtime var (not in YAML)
 *
 * AC: Story 1 AC 6 — collected fields map exactly to the workflow variables;
 *     Advisory fix: YAML defines 16 vars; annual_income is an extra runtime var.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// YAML variable extraction
// ---------------------------------------------------------------------------

/**
 * Parse the 'variables:' block from benefits-navigator.yaml.
 * Returns an array of variable names (keys).
 *
 * We use a simple regex approach rather than a full YAML parser to avoid
 * adding a YAML parsing dependency.
 */
function extractYamlVariableNames(yamlContent: string): string[] {
  const lines = yamlContent.split('\n');
  const variableNames: string[] = [];
  let inVariablesBlock = false;

  for (const line of lines) {
    if (line.trim() === 'variables:') {
      inVariablesBlock = true;
      continue;
    }

    if (inVariablesBlock) {
      // Stop at the next top-level key (not indented)
      if (line.match(/^[a-z_]+:/) && !line.startsWith(' ')) {
        break;
      }

      // Match variable definition lines: "  variable_name: ..."
      const match = line.match(/^\s{2}([a-z_]+):\s/);
      if (match) {
        variableNames.push(match[1]);
      }
    }
  }

  return variableNames;
}

// ---------------------------------------------------------------------------
// Load the YAML file
// ---------------------------------------------------------------------------

// The workflow YAML is in the repo root's workflows/ directory.
// When running tests from web/, this is one level up.
const YAML_PATH = path.join(process.cwd(), '..', 'workflows', 'benefits-navigator.yaml');

let yamlContent: string;
let yamlVariableNames: string[];

try {
  yamlContent = fs.readFileSync(YAML_PATH, 'utf8');
  yamlVariableNames = extractYamlVariableNames(yamlContent);
} catch {
  yamlContent = '';
  yamlVariableNames = [];
}

// ---------------------------------------------------------------------------
// HouseholdVars key manifest
// ---------------------------------------------------------------------------

// We cannot import TypeScript type information at runtime without compilation.
// Instead, we maintain a manifest of HouseholdVars keys here that must stay
// synchronized with web/src/types/session.ts.
//
// When the implementation creates HouseholdVars, this manifest is verified against it.
// If web/src/types/session.ts exports a HOUSEHOLD_VARS_KEYS constant or similar,
// we import that instead.

// Attempt to import the types module
let HOUSEHOLD_VARS_KEYS: string[] = [];

try {
  // This import FAILS before implementation.
  // When implementation creates @/types/session.ts, it MUST export HOUSEHOLD_VARS_KEYS
  // or the type must be inspectable via a runtime export.
  const sessionTypes = await import('@/types/session');
  if ('HOUSEHOLD_VARS_KEYS' in sessionTypes) {
    HOUSEHOLD_VARS_KEYS = (sessionTypes as any).HOUSEHOLD_VARS_KEYS;
  }
} catch {
  // Module doesn't exist yet — tests fail
  HOUSEHOLD_VARS_KEYS = [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('YAML variable parity with HouseholdVars TypeScript interface', () => {
  it('benefits-navigator.yaml is readable from the test environment', () => {
    expect(yamlContent.length).toBeGreaterThan(0);
    expect(yamlContent).toContain('variables:');
  });

  it('YAML has exactly 16 variables (per ground-truth YAML)', () => {
    // Advisory fix: the YAML defines 16 variables (not 17 as the spec states)
    expect(yamlVariableNames).toHaveLength(16);
  });

  it('YAML contains all expected variable names', () => {
    const expectedVars = [
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
    ];

    for (const varName of expectedVars) {
      expect(yamlVariableNames).toContain(varName);
    }
  });

  it('HOUSEHOLD_VARS_KEYS includes all 16 YAML variables', () => {
    // This fails until @/types/session.ts is created and exports HOUSEHOLD_VARS_KEYS
    expect(HOUSEHOLD_VARS_KEYS.length).toBeGreaterThan(0);

    for (const yamlVar of yamlVariableNames) {
      expect(HOUSEHOLD_VARS_KEYS).toContain(yamlVar);
    }
  });

  it('annual_income is an EXTRA runtime var (not in YAML variables block)', () => {
    // Advisory fix: annual_income is passed as --var at runtime (mirrors mcp_server.py:722)
    // but is NOT defined in the YAML variables: block
    expect(yamlVariableNames).not.toContain('annual_income');
  });

  it('HOUSEHOLD_VARS_KEYS includes annual_income as the extra runtime var', () => {
    // The TypeScript interface should include annual_income even though it is not in YAML
    // (matches the plan advisory resolution)
    expect(HOUSEHOLD_VARS_KEYS).toContain('annual_income');
  });

  it('HouseholdVars has no unexpected extra variables beyond YAML + annual_income', () => {
    // Only annual_income should be in HouseholdVars but NOT in YAML
    const allowedExtras = new Set(['annual_income']);

    const unexpectedExtras = HOUSEHOLD_VARS_KEYS.filter(
      (key) => !yamlVariableNames.includes(key) && !allowedExtras.has(key)
    );

    expect(unexpectedExtras).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// YAML structure validation
// ---------------------------------------------------------------------------

describe('YAML structure validation', () => {
  it('benefits-navigator.yaml has required_variables block', () => {
    expect(yamlContent).toContain('required_variables:');
  });

  it('YAML required_variables includes household_profile and zip_code', () => {
    // Extract required_variables section
    const requiredMatch = yamlContent.match(/required_variables:\s*\n([\s\S]*?)(?=\n\w|$)/);
    if (requiredMatch) {
      expect(requiredMatch[1]).toContain('household_profile');
      expect(requiredMatch[1]).toContain('zip_code');
    }
  });

  it('YAML defines parallel_phases: true (phases 1 and 2 run in parallel)', () => {
    expect(yamlContent).toContain('parallel_phases: true');
  });

  it('YAML defines max_parallel_phases: 2', () => {
    expect(yamlContent).toContain('max_parallel_phases: 2');
  });

  it('YAML has all 5 expected phases', () => {
    const phases = [
      'benefits-research',
      'insurance-research',
      'evidence-verification',
      'eligibility-validation',
      'action-plan',
    ];

    for (const phase of phases) {
      expect(yamlContent).toContain(`name: ${phase}`);
    }
  });
});
