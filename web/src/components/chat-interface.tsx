//
// Copyright 2025 Kealu Inc. All rights reserved.
// Licensed under the Kealu Vector License v1.0 — PATENT PENDING
//

'use client';

import { useState, useEffect, useRef, type FormEvent } from 'react';
import type { ChatMessage } from '@/types/session';
import type { IntakeField } from '@/lib/intake-flow';

interface LocalMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatInterfaceProps {
  initialMessages: ChatMessage[];
  initialNextQuestion: IntakeField | null;
  onReady: (runId: string) => void;
}

const WELCOME =
  "Hello! I am an AI Agent powered by Kealu Vector to help you find health insurance and benefit programs for your household.\n\n I'll ask a few questions to understand your situation — no account info needed, and your information stays private.\n\nLet's start with some basics. What is your zip code?";

const WELCOME_BACK =
  'Welcome back! Picking up where we left off.';

const READY_MSG =
  "Great — I have enough information to get started. Launching the analysis now…";

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
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [showSkip, setShowSkip] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Populate initial message list once on mount
  useEffect(() => {
    const init: LocalMessage[] = [];

    if (initialMessages.length === 0) {
      init.push({ id: uid(), role: 'assistant', content: WELCOME });
    } else {
      for (const m of initialMessages) {
        init.push({ id: uid(), role: m.role, content: m.content });
      }
      init.push({ id: uid(), role: 'assistant', content: WELCOME_BACK });
    }

    if (initialNextQuestion) {
      const text = initialNextQuestion.rationale
        ? `${initialNextQuestion.prompt}\n\n_${initialNextQuestion.rationale}_`
        : initialNextQuestion.prompt;
      init.push({ id: uid(), role: 'assistant', content: text });
      if (initialNextQuestion.tier >= 2) setShowSkip(true);
    } else if (initialMessages.length > 0) {
      // All tiers answered — prompt user to start analysis
      init.push({
        id: uid(),
        role: 'assistant',
        content:
          "You're all set! Click 'Run Analysis' below or type anything to kick off the benefits analysis.",
      });
    }

    setMessages(init);
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

      const data = (await res.json()) as { type: string; field?: IntakeField };

      if (data.type === 'ready') {
        // All required fields collected — show confirmation then kick off the run.
        setMessages((prev) => [
          ...prev,
          { id: uid(), role: 'assistant', content: READY_MSG },
        ]);

        // POST /api/workflow/start is idempotent: if a run is already in progress
        // for this session, the server returns the existing runId without re-spawning.
        const startRes = await fetch('/api/workflow/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });
        const startData = (await startRes.json()) as { runId?: string; error?: string };

        if (startData.runId) {
          onReady(startData.runId);
          return;
        }
        // Non-503 error (e.g., session expired between intake and start)
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            content: `⚠ Unable to start analysis: ${startData.error ?? 'please try again.'}`,
          },
        ]);
      } else if (data.type === 'question' && data.field) {
        const text = data.field.rationale
          ? `${data.field.prompt}\n\n_${data.field.rationale}_`
          : data.field.prompt;
        setMessages((prev) => [...prev, { id: uid(), role: 'assistant', content: text }]);
        if (data.field.tier >= 2) setShowSkip(true);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: '⚠ Something went wrong. Please try again.' },
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

  return (
    <div className="flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 h-[580px]">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-slate-100 text-slate-800 rounded-bl-sm'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {isPending && (
          <div className="flex justify-start">
            <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1 items-center">
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
            Skip remaining questions
          </button>
        </div>
      )}

      {/* Input area */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-2 px-4 py-3 border-t border-slate-100"
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isPending}
          rows={2}
          placeholder="Type your answer… (Enter to send, Shift+Enter for newline)"
          className="flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm leading-snug focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Your message"
        />
        <button
          type="submit"
          disabled={isPending || !input.trim()}
          className="self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors"
          aria-label="Send message"
        >
          Send
        </button>
      </form>
    </div>
  );
}
