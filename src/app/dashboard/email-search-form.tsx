"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

interface EmailResult {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  summary: string;
  reason: string;
  relevanceScore: number;
}

interface EmailSearchFormProps {
  userId?: string;
}

function toInputDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getRelevanceBand(score: number): { label: string; className: string } {
  if (score >= 70) {
    return {
      label: "Relevant",
      className: "bg-emerald-100 text-emerald-800 border border-emerald-200",
    };
  }

  if (score >= 50) {
    return {
      label: "Possible Match",
      className: "bg-amber-100 text-amber-800 border border-amber-200",
    };
  }

  return {
    label: "Low Confidence",
    className: "bg-slate-100 text-slate-700 border border-slate-200",
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
  const [warning, setWarning] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      return;
    }

    const stepTimer = window.setInterval(() => {
      setLoadingStepIndex((current) => (current + 1) % loadingSteps.length);
    }, 1300);

    const counterTimer = window.setInterval(() => {
      setProcessedCount((current) => (current < 20 ? current + 1 : current));
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
        results?: EmailResult[];
        warning?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Search failed");
      }

      setResults(data.results ?? []);
      setWarning(data.warning ?? null);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unexpected error";
      setError(message);
      setWarning(null);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="mt-10 rounded-xl border border-slate-200 p-6">
      <h2 className="text-xl font-semibold text-slate-900">Search Emails</h2>
      <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm text-slate-700">
            Start Date
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
              required
            />
          </label>

          <label className="flex flex-col gap-2 text-sm text-slate-700">
            End Date
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
              required
            />
          </label>
        </div>

        <label className="flex flex-col gap-2 text-sm text-slate-700">
          Query
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="payment issues or refunds"
            className="rounded-md border border-slate-300 px-3 py-2 text-slate-900"
            required
          />
        </label>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "AI is analyzing your emails" : "Search Emails"}
        </button>
      </form>

      {isLoading ? (
        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p className="font-medium">AI is analyzing your emails...</p>
          <p className="mt-1 inline-flex items-center gap-2 text-blue-800">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            {loadingSteps[loadingStepIndex]}...
          </p>
          <p className="mt-1 text-xs text-blue-700">Processed {processedCount}+ emails</p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {warning ? (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {warning}
        </p>
      ) : null}

      {!isLoading && submitted && !error && results.length === 0 ? (
        <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No emails found for this query and date range.
        </p>
      ) : null}

      {results.length > 0 ? (
        <div className="mt-6 space-y-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700">
            <p>🟢 Relevant (70+)</p>
            <p>🟡 Possible Match (50-69)</p>
            <p>🔴 Not Relevant (&lt;50 - hidden)</p>
          </div>
          {results.map((email) => (
            <article key={email.id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
              {(() => {
                const relevanceBand = getRelevanceBand(email.relevanceScore);
                return (
                  <p
                    className={`mb-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${relevanceBand.className}`}
                  >
                    {relevanceBand.label}
                  </p>
                );
              })()}
              <h3 className="text-sm font-semibold text-slate-900">{email.subject || "(No subject)"}</h3>
              <p className="mt-1 text-xs text-slate-600">From: {email.from || "Unknown sender"}</p>
              <p className="text-xs text-slate-600">Date: {email.date || "Unknown date"}</p>
              <p className="mt-1 text-xs font-medium text-indigo-700">
                Relevance Score: {email.relevanceScore}
              </p>
              <p className="mt-2 text-sm text-slate-800">
                <span className="font-medium">AI Summary:</span> {email.summary || "(No summary)"}
              </p>
              <p className="mt-1 text-sm text-slate-700">
                <span className="font-medium">Reason:</span> {email.reason || "(No reason)"}
              </p>
              <p className="mt-2 text-sm text-slate-700">{email.snippet || "(No snippet)"}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
