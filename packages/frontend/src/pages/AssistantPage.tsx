import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type { SalesAnalytics, InventoryAnalytics } from '@store/shared';
import { api } from '../lib/api.js';
import { formatCurrency } from '../lib/currency.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DatePreset = 'today' | '7d' | '30d';
type ActivePreset = DatePreset | 'custom' | undefined;

interface Message {
  role: 'user' | 'assistant';
  content: string;
  analytics?: SalesAnalytics;
  inventory?: InventoryAnalytics;
  isError?: boolean;
  /** true = AI-generated reply; false = deterministic fallback */
  aiGenerated?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRESET_OPTIONS: Array<{ id: DatePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
];

const SUGGESTED_QUESTIONS = [
  "Summarise today's sales",
  'How much revenue did I make this week?',
  'How many products are in stock?',
  'Show my low-stock products.',
  'Which products are out of stock?',
  'Summarize my inventory.',
  'Which products sold the most this month?',
  'What are my slowest-selling products?',
];

const MAX_CHARS = 1000;

/** Remove Markdown bold delimiters while keeping model output as plain text. */
function formatAssistantReply(text: string): string {
  return text.replace(/\\\*/g, '*').replace(/\*{2,}/g, '');
}

// ---------------------------------------------------------------------------
// Small helpers: compact analytics and inventory summaries rendered below reply
// ---------------------------------------------------------------------------

function AnalyticsSummaryCard({ data }: { data: SalesAnalytics }) {
  const currency = data.currency;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Sales metrics summary">
      <MetricChip
        label="Revenue"
        value={formatCurrency(data.revenueCents, currency)}
      />
      <MetricChip
        label="Orders"
        value={data.completedOrderCount.toLocaleString()}
      />
      <MetricChip
        label="Avg order"
        value={formatCurrency(data.averageOrderValueCents, currency)}
      />
      <MetricChip
        label="Currency"
        value={currency}
      />
    </div>
  );
}

function InventorySummaryCard({ data }: { data: InventoryAnalytics }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Inventory metrics summary">
      <MetricChip
        label="Total products"
        value={data.totalProducts.toLocaleString()}
      />
      <MetricChip
        label="Available"
        value={data.availableProductsCount.toLocaleString()}
      />
      <MetricChip
        label="Low stock"
        value={data.lowStockProductsCount.toLocaleString()}
      />
      <MetricChip
        label="Out of stock"
        value={data.outOfStockProductsCount.toLocaleString()}
      />
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-3 py-2 dark:border-slate-600 dark:bg-slate-700/50">
      <p className="text-2xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className={`h-${size} w-${size} animate-spin text-brand-500`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AssistantPage() {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [preset, setPreset] = useState<ActivePreset>(undefined);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages update
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus textarea after each response
  useEffect(() => {
    if (!loading) {
      textareaRef.current?.focus();
    }
  }, [loading]);

  const selectPreset = useCallback((id: DatePreset) => {
    setPreset(id);
    setCustomStart('');
    setCustomEnd('');
    setCustomError(null);
  }, []);

  const applyCustomRange = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setCustomError(null);

      if (!customStart || !customEnd) {
        setCustomError('Select both a start and an end date.');
        return;
      }
      if (customStart > customEnd) {
        setCustomError('Start date must be on or before the end date.');
        return;
      }
      const days =
        Math.floor(
          (Date.parse(`${customEnd}T00:00:00Z`) - Date.parse(`${customStart}T00:00:00Z`)) /
            86_400_000,
        ) + 1;
      if (!Number.isFinite(days) || days < 1 || days > 366) {
        setCustomError('Choose a valid range of 366 days or fewer.');
        return;
      }
      setPreset('custom');
    },
    [customStart, customEnd],
  );

  async function submitQuestion(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    // Append the user's message
    const userMessage: Message = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setQuestion('');
    setLoading(true);

    // Build request params
    const params: Parameters<typeof api.assistant.query>[0] = { question: trimmed };
    if (preset === 'today' || preset === '7d' || preset === '30d') {
      params.preset = preset;
    } else if (preset === 'custom' && customStart && customEnd) {
      params.start = customStart;
      params.end = customEnd;
    }

    const res = await api.assistant.query(params);

    if (res.ok) {
      const assistantMessage: Message = {
        role: 'assistant',
        content: res.data.reply,
        analytics: res.data.analytics,
        inventory: res.data.inventory,
        aiGenerated: res.data.aiGenerated,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } else {
      const errorMessage: Message = {
        role: 'assistant',
        content: res.message ?? 'Something went wrong. Please try again.',
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
    }

    setLoading(false);
  }

  function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submitQuestion(question);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Submit on Enter without Shift
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitQuestion(question);
    }
  }

  function handleSuggestedQuestion(q: string) {
    setQuestion(q);
    textareaRef.current?.focus();
  }

  const charsRemaining = MAX_CHARS - question.length;
  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {/* ------------------------------------------------------------------ */}
      {/* Page header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          AI Assistant
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Ask questions about your store&apos;s performance and analytics.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Read-only disclaimer                                                 */}
      {/* ------------------------------------------------------------------ */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800/50 dark:bg-blue-900/20">
        <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
          Read-only analytics assistant
        </p>
        <p className="mt-0.5 text-xs text-blue-700 dark:text-blue-400">
          The AI assistant can only read your store&apos;s analytics data. It cannot create,
          modify or delete any records, confirm payments, or access other stores&apos; data.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Date range selector                                                  */}
      {/* ------------------------------------------------------------------ */}
      <div className="card">
        <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">
          Analytics context date range
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Preset date ranges">
          {PRESET_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={preset === option.id ? 'btn-primary' : 'btn-secondary'}
              aria-pressed={preset === option.id}
              onClick={() => selectPreset(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={applyCustomRange}
          className="mt-3 flex flex-wrap items-end gap-2"
          aria-label="Custom date range"
        >
          <div>
            <label htmlFor="assistant-start" className="label text-xs">
              From
            </label>
            <input
              id="assistant-start"
              type="date"
              className="input w-auto"
              value={customStart}
              onChange={(e) => {
                setCustomStart(e.target.value);
                if (preset === 'custom') setPreset(undefined);
              }}
            />
          </div>
          <div>
            <label htmlFor="assistant-end" className="label text-xs">
              To
            </label>
            <input
              id="assistant-end"
              type="date"
              className="input w-auto"
              value={customEnd}
              onChange={(e) => {
                setCustomEnd(e.target.value);
                if (preset === 'custom') setPreset(undefined);
              }}
            />
          </div>
          <button type="submit" className="btn-secondary">
            Apply range
          </button>
          {preset === 'custom' && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3.5 w-3.5"
              >
                <path
                  fillRule="evenodd"
                  d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z"
                  clipRule="evenodd"
                />
              </svg>
              Custom range applied
            </span>
          )}
        </form>
        {customError && (
          <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
            {customError}
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Chat area                                                            */}
      {/* ------------------------------------------------------------------ */}
      {!hasMessages ? (
        /* Empty state */
        <div className="card flex flex-col items-center gap-4 py-10 text-center">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-10 w-10 text-slate-300 dark:text-slate-600"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Ask me anything about your sales, revenue, orders, products, or inventory.
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Select a date range for sales context, then type a question or choose one below.
            </p>
          </div>

          {/* Suggested question chips */}
          <div className="flex flex-wrap justify-center gap-2" role="list" aria-label="Suggested questions">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                role="listitem"
                className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-slate-700
                           hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
                           dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300
                           dark:hover:border-brand-500 dark:hover:bg-brand-900/20 dark:hover:text-brand-300
                           transition-colors"
                onClick={() => handleSuggestedQuestion(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* Chat log */
        <section aria-labelledby="assistant-conversation-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3
              id="assistant-conversation-heading"
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Conversation
            </h3>
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={loading}
              onClick={() => setMessages([])}
              aria-label="Clear conversation"
            >
              Clear conversation
            </button>
          </div>

          <div
            role="log"
            aria-live="polite"
            aria-label="Conversation history"
            className="flex min-h-[200px] flex-col gap-4 rounded-xl border border-border bg-surface-subtle p-4 dark:border-slate-700 dark:bg-slate-900/40"
          >
            {messages.map((msg, idx) => (
              <ChatBubble key={idx} message={msg} />
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex items-start gap-3">
                <AssistantAvatar />
                <div className="card flex items-center gap-2 px-4 py-3">
                  <Spinner size={4} />
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    Analysing your store data…
                  </span>
                </div>
              </div>
            )}

            {/* Scroll anchor */}
            <div ref={chatEndRef} aria-hidden="true" />
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Suggested questions (shown under the log once chat has started)     */}
      {/* ------------------------------------------------------------------ */}
      {hasMessages && !loading && (
        <div className="flex flex-wrap gap-2" aria-label="Suggested questions">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              className="rounded-full border border-border bg-white px-3 py-1.5 text-xs font-medium text-slate-700
                         hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500
                         dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300
                         dark:hover:border-brand-500 dark:hover:bg-brand-900/20 dark:hover:text-brand-300
                         transition-colors"
              onClick={() => handleSuggestedQuestion(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Input area                                                           */}
      {/* ------------------------------------------------------------------ */}
      <form onSubmit={handleFormSubmit} className="card space-y-3">
        <label
          htmlFor="assistant-question"
          className="label"
        >
          Ask about your store&apos;s performance
        </label>

        <div className="relative">
          <textarea
            id="assistant-question"
            ref={textareaRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={MAX_CHARS}
            rows={3}
            disabled={loading}
            placeholder="e.g. What were my top products last week?"
            aria-label="Ask about your store's performance"
            aria-describedby="question-counter"
            className="input resize-none pr-4"
          />
        </div>

        <div className="flex items-center justify-between">
          <p
            id="question-counter"
            className={`text-xs ${
              charsRemaining < 100
                ? charsRemaining < 20
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-amber-600 dark:text-amber-400'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {charsRemaining} characters remaining
          </p>

          <button
            type="submit"
            disabled={loading || question.trim().length === 0}
            aria-label="Send message"
            className="btn-primary"
          >
            {loading ? (
              <>
                <Spinner size={4} />
                <span>Sending…</span>
              </>
            ) : (
              <>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z" />
                </svg>
                <span>Send</span>
              </>
            )}
          </button>
        </div>

        <p className="text-2xs text-slate-400 dark:text-slate-500">
          Press <kbd className="rounded border border-border px-1 py-0.5 font-mono text-2xs">Enter</kbd> to send,{' '}
          <kbd className="rounded border border-border px-1 py-0.5 font-mono text-2xs">Shift+Enter</kbd> for a new line.
        </p>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat bubble
// ---------------------------------------------------------------------------

function AssistantAvatar() {
  return (
    <div
      aria-hidden="true"
      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-900/40"
    >
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4 text-brand-600 dark:text-brand-400"
      >
        <path
          fillRule="evenodd"
          d="M10 2a6 6 0 00-6 6v1H3a1 1 0 000 2h1v1a6 6 0 006 6 6 6 0 006-6v-1h1a1 1 0 000-2h-1V8a6 6 0 00-6-6zm0 2a4 4 0 014 4v1H6V8a4 4 0 014-4zm-1 9a1 1 0 102 0v-1a1 1 0 10-2 0v1z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2.5 text-sm text-white shadow-sm"
          role="article"
          aria-label="Your message"
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {message.isError ? (
          /* Error state */
          <div
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
            role="alert"
          >
            <p className="font-medium">Something went wrong</p>
            <p className="mt-0.5">{message.content}</p>
          </div>
        ) : (
          <>
            {/* Fallback info banner */}
            {message.aiGenerated === false && (
              <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-700 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-400">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="h-3.5 w-3.5 flex-shrink-0"
                >
                  <path
                    fillRule="evenodd"
                    d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.804a1.5 1.5 0 0 1-1.3-2.25l5.197-9ZM8 4a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                    clipRule="evenodd"
                  />
                </svg>
                AI assistant unavailable — showing your analytics data
              </div>
            )}

            {/* Reply text — plain text only, never dangerouslySetInnerHTML */}
            <div
              className="card px-4 py-3"
              role="article"
              aria-label="Assistant reply"
            >
              <p className="whitespace-pre-wrap break-words text-sm text-slate-800 dark:text-slate-200">
                {formatAssistantReply(message.content)}
              </p>

              {/* Analytics summary card */}
              {message.analytics && (
                <AnalyticsSummaryCard data={message.analytics} />
              )}

              {/* Inventory summary card */}
              {message.inventory && (
                <InventorySummaryCard data={message.inventory} />
              )}
            </div>

            {/* AI badge */}
            {message.aiGenerated === true && (
              <p className="ml-1 text-2xs text-slate-400 dark:text-slate-500">
                Powered by AI — figures from your store data
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
