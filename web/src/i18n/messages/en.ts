/**
 * Copyright 2025 Kealu Inc. All rights reserved.
 * Licensed under the Kealu Vector License v1.0 — PATENT PENDING
 */

/**
 * English message catalog — source of truth for the Messages type shape.
 * Every key in this file must have a corresponding key in es.ts.
 */
const en = {
  // ── page.tsx ──────────────────────────────────────────────────────────────
  page_title: 'Benefits Navigator',
  page_subtitle:
    'Find health coverage and benefit programs for your household — no account required.',
  offline_banner:
    'Workflow engine offline — analysis is temporarily unavailable. Check back soon.',

  // ── chat-interface.tsx ───────────────────────────────────────────────────
  chat_welcome:
    "Hello! I am an AI Agent powered by Kealu Vector to help you find health insurance and benefit programs for your household.\n\nI'll ask a few questions to understand your situation — no account info needed, and your information always stays private.\n\nLet's start with some basics. What is your ZIP code?\n\n(Your ZIP code tells us which health plans, state programs, county services, clinics, and local assistance options are available where you live.)",
  chat_welcome_back: 'Welcome back! Picking up where we left off.',
  chat_ready: 'Great — I have enough information to get started. Launching the analysis now…',
  chat_all_set: 'All set — ready to run',
  chat_run_prompt:
    "You're all set! Click 'Run Analysis' below or type anything to kick off the benefits analysis.",
  chat_error_generic: '⚠ Something went wrong. Please try again.',
  chat_unable_to_start: '⚠ Unable to start analysis',
  chat_please_retry: 'please try again.',
  chat_hide_answers: 'Hide answers',
  chat_edit_answers: 'Edit answers',
  chat_save: 'Save',
  chat_cancel: 'Cancel',
  chat_edit: 'Edit',
  chat_skip: 'Skip remaining questions',
  chat_starting: 'Starting…',
  chat_run_analysis: 'Run Analysis',
  chat_placeholder: 'Type your answer… (Enter to send, Shift+Enter for newline)',
  chat_input_aria: 'Your message',
  chat_send: 'Send',
  chat_send_aria: 'Send message',

  // ── phase-tracker.tsx ────────────────────────────────────────────────────
  phase_benefits_research: 'Benefits Research',
  phase_insurance_research: 'Insurance Research',
  phase_evidence_verification: 'Evidence Verification',
  phase_eligibility_validation: 'Eligibility Validation',
  phase_action_plan: 'Action Plan',
  phase_status_idle: 'Waiting',
  phase_status_running: 'Running…',
  phase_status_rerunning: 'Re-checking…',
  phase_status_complete: 'Complete',
  phase_status_error: 'Error',
  phase_analyzing: 'Analyzing your household…',
  phase_description: 'A 5-phase AI workflow is running. This typically takes 5–15 minutes.',
  phase_stopping: 'Stopping…',
  phase_stop_edit: 'Stop & edit',
  phase_finalizing: 'Finalizing…',
  phase_running_label: 'Running',
  phase_starting: 'Starting…',
  phase_progress_aria: 'Overall analysis progress',
  phase_complete_aria: 'Complete',
  phase_error_aria: 'Error',

  // ── report-view.tsx ──────────────────────────────────────────────────────
  report_bottom_line: 'Bottom Line',
  report_expand: 'expand',
  report_collapse: 'collapse',
  report_starting: 'Starting…',
  report_run_again: 'Run Again',

  // ── error-banner.tsx ─────────────────────────────────────────────────────
  error_try_again: 'Try Again',
  error_edit_info: 'Edit my information',

  // ── language-switcher.tsx ────────────────────────────────────────────────
  lang_select_aria: 'Select language',
  lang_en: 'English',
  lang_es: 'Español',
  lang_zh_CN: '简体中文',
} as const;

export default en;
