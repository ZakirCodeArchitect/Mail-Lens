"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

interface EmailResult {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  gmailUrl: string;
  summary: string;
  reason: string;
  ruleScore: number;
  aiScore: number;
  finalScore: number;
  matchedSignals: string[];
  label: "Highly Relevant" | "Possible Match";
}

interface EmailSearchFormProps {
  userId?: string;
}

function toInputDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getRelevanceBand(label: EmailResult["label"]): { label: string; className: string } {
  if (label === "Highly Relevant") {
    return {
      label,
      className: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    };
  }
  return {
    label,
    className: "bg-amber-100 text-amber-800 border border-amber-200",
  };
}

export function EmailSearchForm({ userId }: EmailSearchFormProps) {
  const loadingSteps = useMemo(
    () => ["Fetching Gmail emails", "Annotating email intent", "Searching relevant emails"],
    [],
  );
  const today = useMemo(() => new Date(), []);
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState(toInputDate(new Date(today.getFullYear(), 0, 1)));
  const [endDate, setEndDate] = useState(toInputDate(today));
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStepIndex, setLoadingStepIndex] = useState(0);
  const [processedCount, setProcessedCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<EmailResult[]>([]);
  const [candidateCountBeforeDedup, setCandidateCountBeforeDedup] = useState<number | null>(null);
  const [uniqueCandidateCount, setUniqueCandidateCount] = useState<number | null>(null);
  const [aiAnalyzedCount, setAiAnalyzedCount] = useState<number | null>(null);
  const [finalCount, setFinalCount] = useState<number | null>(null);
  const [mode, setMode] = useState<"search" | "collection" | null>(null);
  const [modeReason, setModeReason] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 25;
  const [warning, setWarning] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading) {
      return;
    }

    const stepTimer = window.setInterval(() => {
      setLoadingStepIndex((current) => (current + 1) % loadingSteps.length);
    }, 1300);

    const counterTimer = window.setInterval(() => {
      setProcessedCount((current) => (current < 50 ? current + 1 : current));
    }, 900);

    return () => {
      window.clearInterval(stepTimer);
      window.clearInterval(counterTimer);
    };
  }, [isLoading, loadingSteps]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    setWarning(null);
    setResults([]);
    setCandidateCountBeforeDedup(null);
    setUniqueCandidateCount(null);
    setAiAnalyzedCount(null);
    setFinalCount(null);
    setMode(null);
    setModeReason(null);
    setCurrentPage(1);
    setExpandedEmailId(null);
    setLoadingStepIndex(0);
    setProcessedCount(1);
    setIsLoading(true);

    try {
      const queryParams = userId ? `?userId=${encodeURIComponent(userId)}` : "";
      const response = await fetch(`/api/gmail/search${queryParams}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, startDate, endDate }),
      });

      const data = (await response.json()) as {
        mode?: "search" | "collection";
        reason?: string;
        results?: EmailResult[];
        warning?: string;
        candidateCountBeforeDedup?: number;
        uniqueCandidateCount?: number;
        aiAnalyzedCount?: number;
        finalCount?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Search failed");
      }

      setResults(data.results ?? []);
      setMode(data.mode ?? null);
      setModeReason(data.reason ?? null);
      setCandidateCountBeforeDedup(
        typeof data.candidateCountBeforeDedup === "number" ? data.candidateCountBeforeDedup : null,
      );
      setUniqueCandidateCount(typeof data.uniqueCandidateCount === "number" ? data.uniqueCandidateCount : null);
      setAiAnalyzedCount(typeof data.aiAnalyzedCount === "number" ? data.aiAnalyzedCount : null);
      setFinalCount(typeof data.finalCount === "number" ? data.finalCount : null);
      setWarning(data.warning ?? null);
      setCurrentPage(1);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unexpected error";
      setError(message);
      setWarning(null);
      setResults([]);
      setCandidateCountBeforeDedup(null);
      setUniqueCandidateCount(null);
      setAiAnalyzedCount(null);
      setFinalCount(null);
      setMode(null);
      setModeReason(null);
      setCurrentPage(1);
    } finally {
      setIsLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedResults = results.slice(pageStart, pageStart + pageSize);

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Search Emails</h2>
          <p className="mt-1 text-sm text-slate-600">
            Describe intent in natural language. AI will rank semantic relevance.
          </p>
        </div>
      </div>

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Start Date</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
              required
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">End Date</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
              required
            />
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">Query</span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="emails sent by or forwarded from Zia related to course links"
            className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            required
          />
        </label>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-300"
        >
          {isLoading ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
              Analyzing...
            </span>
          ) : (
            "Search Semantically"
          )}
        </button>
      </form>

      {isLoading ? (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">Searching with semantic AI</p>
              <p className="mt-1 text-sm text-slate-600">{loadingSteps[loadingStepIndex]}...</p>
            </div>
            <div className="inline-flex items-center gap-1.5 pt-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:160ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:320ms]" />
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-slate-300" />
          </div>
          <p className="mt-2 text-xs font-medium text-slate-500">Candidates analyzed: {processedCount}+</p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      {warning ? (
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {warning}
        </p>
      ) : null}

      {!isLoading && submitted && !error && results.length === 0 ? (
        <p className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No semantically relevant emails found for this query and date range.
        </p>
      ) : null}

      {mode ? (
        <p className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
          Mode: <span className="font-semibold capitalize">{mode}</span>
          {modeReason ? ` - ${modeReason}` : ""}
        </p>
      ) : null}

      {results.length > 0 ? (
        <div className="mt-7 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Results</h3>
            <p className="text-sm text-slate-500">
              {results.length} matched emails (Page {currentPage} of {totalPages})
            </p>
          </div>
          {paginatedResults.map((email) => {
            const relevanceBand = getRelevanceBand(email.label);
            return (
              <article
                key={email.id}
                onClick={() => {
                  setExpandedEmailId((current) => (current === email.id ? null : email.id));
                }}
                className="cursor-pointer rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p
                    className={`inline-flex rounded-sm px-2.5 py-1 text-xs font-semibold ${relevanceBand.className}`}
                  >
                    {relevanceBand.label}
                  </p>
                  <p className="text-xs font-semibold text-indigo-700">Final Score {email.finalScore}</p>
                </div>

                <h3 className="text-base font-semibold text-slate-900">{email.subject || "(No subject)"}</h3>
                <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                  <p>From: {email.from || "Unknown sender"}</p>
                  <p>Date: {email.date || "Unknown date"}</p>
                </div>

                <p className="mt-4 text-sm leading-6 text-slate-800">
                  <span className="font-semibold text-slate-900">AI Summary:</span>{" "}
                  {email.summary || "(No summary)"}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  <span className="font-semibold text-slate-900">Reason:</span> {email.reason || "(No reason)"}
                </p>
                <p className="mt-2 text-xs text-slate-600">
                  Rule Score: {email.ruleScore} | AI Score: {email.aiScore}
                </p>
                {email.matchedSignals.length > 0 ? (
                  <p className="mt-1 text-xs text-slate-600">
                    <span className="font-semibold text-slate-800">Matched Signals:</span>{" "}
                    {email.matchedSignals.join(", ")}
                  </p>
                ) : null}
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                  {email.snippet || "(No snippet)"}
                </p>

                {expandedEmailId === email.id ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Exact Email
                      </p>
                      <a
                        href={email.gmailUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                        className="inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                      >
                        View in Gmail
                      </a>
                    </div>
                    <p className="mt-2 text-sm text-slate-800">
                      <span className="font-semibold text-slate-900">Subject:</span>{" "}
                      {email.subject || "(No subject)"}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
                      {email.snippet || "(No email content available)"}
                    </p>
                  </div>
                ) : null}
              </article>
            );
          })}
          {totalPages > 1 ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <p className="text-slate-600">
                Showing {pageStart + 1}-{Math.min(pageStart + pageSize, results.length)} of {results.length}
              </p>
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((value) => Math.min(totalPages, value + 1))}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          ) : null}
          {process.env.NODE_ENV !== "production" &&
          candidateCountBeforeDedup !== null &&
          uniqueCandidateCount !== null &&
          aiAnalyzedCount !== null &&
          finalCount !== null ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
              Candidates before dedup: {candidateCountBeforeDedup} | Unique candidates: {uniqueCandidateCount} | AI
              analyzed: {aiAnalyzedCount} | Final count: {finalCount}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
