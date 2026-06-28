//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

import { useEffect, useState } from 'react';
import { TIER_1_FIELDS, TIER_2_FIELDS, type IntakeField } from '@/lib/intake-flow';
import ErrorBanner from './error-banner';

/** All fields shown in the edit form, required (Tier 1) first. */
const FIELDS: IntakeField[] = [...TIER_1_FIELDS, ...TIER_2_FIELDS];

/** Field keys rendered as multi-line textareas rather than single-line inputs. */
const MULTILINE_KEYS = new Set([
  'household_profile',
  'health_needs',
  'medications',
  'providers',
  'current_coverage',
]);

interface EditInfoFormProps {
  /** Called with the new runId after the user saves and a fresh run starts. */
  onSaved: (runId: string) => void;
  /** Called when the user cancels editing. */
  onCancel: () => void;
}

/**
 * EditInfoForm — structured review/edit of the collected intake values.
 *
 * Shown when the user stops a run or hits an error. Loads the current values
 * from /api/intake/vars, lets the user correct them, then saves and re-runs the
 * analysis via /api/workflow/start.
 */
export default function EditInfoForm({ onSaved, onCancel }: EditInfoFormProps) {
  const [vars, setVars] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/intake/vars', { credentials: 'include' });
        if (!res.ok) throw new Error('load failed');
        const data = (await res.json()) as { vars?: Record<string, string> };
        if (!cancelled) setVars(data.vars ?? {});
      } catch {
        if (!cancelled) setError('Could not load your information. Please refresh and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setField(key: string, value: string) {
    setVars((prev) => ({ ...prev, [key]: value }));
  }

  const requiredMissing = TIER_1_FIELDS.some((f) => !(vars[f.key] ?? '').trim());

  async function handleSave() {
    if (saving || requiredMissing) return;
    setSaving(true);
    setError(null);

    try {
      const saveRes = await fetch('/api/intake/vars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ vars }),
      });

      if (!saveRes.ok) {
        const body = (await saveRes.json()) as { error?: string };
        setError(body.error ?? 'Could not save your changes. Please try again.');
        setSaving(false);
        return;
      }

      const startRes = await fetch('/api/workflow/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const startData = (await startRes.json()) as { runId?: string; error?: string };

      if (startData.runId) {
        onSaved(startData.runId);
        return;
      }
      setError(startData.error ?? 'Could not start the analysis. Please try again.');
      setSaving(false);
    } catch {
      setError('Something went wrong. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Review your information</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Correct anything that looks wrong, then re-run the analysis.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 py-4">Loading your information…</p>
      ) : (
        <div className="space-y-4">
          {FIELDS.map((field) => {
            const value = vars[field.key] ?? '';
            const isRequired = field.tier === 1;
            const multiline = MULTILINE_KEYS.has(field.key);
            return (
              <div key={field.key} className="space-y-1">
                <label htmlFor={`edit-${field.key}`} className="block text-sm font-medium text-slate-700">
                  {field.label}
                  {isRequired && <span className="text-red-500 ml-0.5">*</span>}
                </label>
                {multiline ? (
                  <textarea
                    id={`edit-${field.key}`}
                    value={value}
                    onChange={(e) => setField(field.key, e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm leading-snug focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                ) : (
                  <input
                    id={`edit-${field.key}`}
                    type="text"
                    value={value}
                    onChange={(e) => setField(field.key, e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                )}
                <p className="text-xs text-slate-400">{field.rationale}</p>
              </div>
            );
          })}
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={() => void handleSave()} />}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || loading || requiredMissing}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors"
        >
          {saving ? 'Starting…' : 'Save & re-run analysis'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-slate-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
