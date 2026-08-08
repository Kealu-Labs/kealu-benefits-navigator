//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

import { useState, useEffect, useRef, type FormEvent } from 'react';
import type { ChatMessage } from '@/types/session';
import { ALL_FIELDS, TOTAL_STEPS, type IntakeField, type IntakeAnswer } from '@/lib/intake-flow';
import { useTranslation } from '@/hooks/use-translation';

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

/** Shape of /api/intake responses (POST and GET share these fields). */
interface IntakeResponse {
  type?: 'question' | 'ready';
  field?: IntakeField;
  next?: IntakeField | null;
  answers?: IntakeAnswer[];
  step?: { current: number | null; total: number } | null;
}

/** 1-based step number for a field, or null. */
function stepFor(field: IntakeField | null): number | null {
  if (!field) return null;
  const idx = ALL_FIELDS.findIndex((f) => f.key === field.key);
  return idx === -1 ? null : idx + 1;
}

interface ChatInterfaceProps {
  initialMessages: ChatMessage[];
  initialNextQuestion: IntakeField | null;
  onReady: (runId: string) => void;
}

// Module-level counter for generating stable, unique per-component message IDs.
// Using a counter (not crypto.randomUUID) keeps the ID predictable and avoids
// a hydration mismatch: the same counter value is produced whether the component
// is initialized during SSR or on the client.
let _id = 0;
function uid(): string {
  return `m${++_id}`;
}

/**
 * ChatInterface — chat-style intake conversation.
 *
 * - Fresh session: shows welcome message + first question.
 * - Resumed session: shows prior user messages + "welcome back" + next question.
 * - On 'ready' from server: POSTs to /api/workflow/start, calls onReady(runId).
 * - Skip button appears once Tier-2 questions begin.
 * - Send button disabled while request in-flight (prevents double-submit).
 */
export default function ChatInterface({
  initialMessages,
  initialNextQuestion,
  onReady,
}: ChatInterfaceProps) {
  const { t, locale } = useTranslation();
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [showSkip, setShowSkip] = useState(false);
  // Intake progress + editable-answers state
  const [currentField, setCurrentField] = useState<IntakeField | null>(initialNextQuestion);
  const [answers, setAnswers] = useState<IntakeAnswer[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Populate initial message list once on mount
  useEffect(() => {
    const init: LocalMessage[] = [];

    if (initialMessages.length === 0) {
      init.push({ id: uid(), role: 'assistant', content: t('chat_welcome') });
    } else {
      for (const m of initialMessages) {
        init.push({ id: uid(), role: m.role, content: m.content });
      }
      init.push({ id: uid(), role: 'assistant', content: t('chat_welcome_back') });
    }

    if (initialNextQuestion && initialMessages.length > 0) {
      const text = initialNextQuestion.rationale
        ? `${initialNextQuestion.prompt}\n\n${initialNextQuestion.rationale}`
        : initialNextQuestion.prompt;
      init.push({ id: uid(), role: 'assistant', content: text });
      if (initialNextQuestion.tier >= 2) setShowSkip(true);
    } else if (initialMessages.length > 0) {
      // All tiers answered — prompt user to start analysis
      init.push({
        id: uid(),
        role: 'assistant',
        content: t('chat_run_prompt'),
      });
    }

    setMessages(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessages, initialNextQuestion, locale]);

  // Load the answers-so-far snapshot for the progress bar + editable panel
  // (also covers resumed sessions). The conversational POST never returns PII,
  // so the panel is refreshed from this dedicated GET channel.
  async function refreshAnswers() {
    try {
      const res = await fetch('/api/intake', { method: 'GET', credentials: 'include' });
      const d = (await res.json()) as IntakeResponse;
      if (d.answers) setAnswers(d.answers);
    } catch {
      /* best-effort — panel just stays empty */
    }
  }

  useEffect(() => {
    void refreshAnswers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isPending) return;

    setIsPending(true);
    setMessages((prev) => [...prev, { id: uid(), role: 'user', content: trimmed }]);
    setInput('');

    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: trimmed }),
      });

      const data = (await res.json()) as IntakeResponse;

      if (data.type === 'ready') {
        setCurrentField(null);
        await refreshAnswers();
        // All required fields collected — show confirmation then kick off the run.
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: 'assistant', content: t('chat_ready') },
        ]);
        if (await startAnalysis()) return;
      } else if (data.type === 'question' && data.field) {
        setCurrentField(data.field);
        const text = data.field.rationale
          ? `${data.field.prompt}\n\n${data.field.rationale}`
          : data.field.prompt;
        setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: text }]);
        if (data.field.tier >= 2) setShowSkip(true);
        // Refresh the progress bar + answers panel (PII comes only from this GET).
        void refreshAnswers();
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: t('chat_error_generic') },
      ]);
    } finally {
      setIsPending(false);
      textareaRef.current?.focus();
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  /**
   * Kick off the benefits analysis. Shared by the auto-start on `ready` and the
   * explicit "Run Analysis" button (shown once all info is collected, e.g. after
   * editing answers or stopping a run). Returns true when a run started.
   *
   * POST /api/workflow/start is idempotent: if a run is already in progress for
   * this session the server returns the existing runId without re-spawning.
   */
  async function startAnalysis(): Promise<boolean> {
    const startRes = await fetch('/api/workflow/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    });
    const startData = (await startRes.json()) as { runId?: string; error?: string };

    if (startData.runId) {
      onReady(startData.runId);
      return true;
    }
    // Non-503 error (e.g., session expired between intake and start)
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: 'assistant',
        content: `${t('chat_unable_to_start')}: ${startData.error ?? t('chat_please_retry')}`,
      },
    ]);
    return false;
  }

  /** "Run Analysis" button handler — start a run with the info collected so far. */
  async function handleRunAnalysis() {
    if (isPending) return;
    setIsPending(true);
    try {
      await startAnalysis();
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: t('chat_error_generic') },
      ]);
    } finally {
      setIsPending(false);
    }
  }

  /** Save an inline edit of a previously-answered field. */
  async function saveEdit(key: string) {
    const value = editValue.trim();
    setEditingKey(null);
    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ edit: { key, value } }),
      });
      const data = (await res.json()) as IntakeResponse;
      if (data.answers) setAnswers(data.answers);
      // Keep the progress indicator in sync with the recomputed next question.
      if (data.type === 'ready') setCurrentField(null);
      else if (data.field) setCurrentField(data.field);
    } catch {
      /* leave panel as-is on failure */
    }
  }

  const step = stepFor(currentField);

  return (
    <div className="flex flex-col bg-slate-900 rounded-xl shadow-sm border border-slate-800 h-[580px]">
      {/* Progress indicator + editable answers panel */}
      {(currentField || answers.length > 0) && (
        <div className="px-4 pt-3 pb-2.5 border-b border-slate-800">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-300">
              {currentField && step ? (
                <>
                  Step {step} of {TOTAL_STEPS}
                  <span className="text-slate-500"> · {currentField.label}</span>
                </>
              ) : (
                t('chat_all_set')
              )}
            </span>
            {answers.length > 0 && (
              <button
                type="button"
                onClick={() => setShowPanel((v) => !v)}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 focus:outline-none"
              >
                {showPanel ? t('chat_hide_answers') : t('chat_edit_answers')}
              </button>
            )}
          </div>

          {/* Progress bar — fills by number of answered fields */}
          <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${Math.round((answers.length / TOTAL_STEPS) * 100)}%` }}
            />
          </div>

          {/* Editable answers — stop and correct anything entered so far */}
          {showPanel && answers.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {answers.map((a) => (
                <div key={a.key} className="flex items-start gap-2 text-xs">
                  <span className="w-28 shrink-0 pt-1 text-slate-400">{a.label}</span>
                  {editingKey === a.key ? (
                    <div className="flex-1 flex items-center gap-1.5">
                      <input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveEdit(a.key);
                          if (e.key === 'Escape') setEditingKey(null);
                        }}
                        autoFocus
                        className="flex-1 rounded border border-slate-600 bg-slate-800 text-slate-100 px-2 py-1 focus:border-blue-400 focus:outline-none"
                        aria-label={`Edit ${a.label}`}
                      />
                      <button
                        type="button"
                        onClick={() => void saveEdit(a.key)}
                        className="font-medium text-blue-400 hover:text-blue-300 focus:outline-none"
                      >
                        {t('chat_save')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingKey(null)}
                        className="text-slate-500 hover:text-slate-300 focus:outline-none"
                      >
                        {t('chat_cancel')}
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 pt-1 text-slate-200 break-words">{a.value}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingKey(a.key);
                          setEditValue(a.value);
                        }}
                        className="pt-1 font-medium text-blue-400 hover:text-blue-300 focus:outline-none"
                      >
                        {t('chat_edit')}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-3xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-200'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isPending && (
          <div className="flex justify-start">
            <div className="bg-slate-800 rounded-3xl px-4 py-3 flex gap-1 items-center">
              <span className="w-2 h-2 rounded-full bg-slate-400 typing-dot" />
              <span className="w-2 h-2 rounded-full bg-slate-400 typing-dot" />
              <span className="w-2 h-2 rounded-full bg-slate-400 typing-dot" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Skip button */}
      {showSkip && !isPending && (
        <div className="px-4 pb-1">
          <button
            type="button"
            onClick={() => {
              setShowSkip(false);
              void sendMessage('skip');
            }}
            className="text-xs text-slate-400 underline hover:text-slate-600 focus:outline-none"
          >
            {t('chat_skip')}
          </button>
        </div>
      )}

      {/* Run Analysis — shown once all info is collected (e.g. after editing
          answers or stopping a run), so re-running is an explicit action. */}
      {currentField === null && answers.length > 0 && (
        <div className="px-4 pb-2">
          <button
            type="button"
            onClick={() => void handleRunAnalysis()}
            disabled={isPending}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 focus:ring-offset-slate-900 transition-colors"
          >
            {isPending ? t('chat_starting') : t('chat_run_analysis')}
          </button>
        </div>
      )}

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 px-4 py-3 border-t border-slate-800"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isPending}
          rows={2}
          placeholder={t('chat_placeholder')}
          className="flex-1 resize-none rounded-lg border border-slate-700 bg-slate-800 text-slate-100 placeholder-slate-500 px-3 py-2 text-sm leading-snug focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label={t('chat_input_aria')}
        />
        <button
          type="submit"
          disabled={isPending || !input.trim()}
          className="self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors"
          aria-label={t('chat_send_aria')}
        >
          {t('chat_send')}
        </button>
      </form>
    </div>
  );
}
