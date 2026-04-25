"use client";

import { FormEvent, useMemo, useState } from "react";

interface EmailResult {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body: string;
}

interface EmailSearchFormProps {
  userId?: string;
}

function toInputDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function EmailSearchForm({ userId }: EmailSearchFormProps) {
  const today = useMemo(() => new Date(), []);
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState(toInputDate(new Date(today.getFullYear(), 0, 1)));
  const [endDate, setEndDate] = useState(toInputDate(today));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<EmailResult[]>([]);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch(`/api/gmail/search?userId=${encodeURIComponent(userId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, startDate, endDate }),
      });

      const data = (await response.json()) as { results?: EmailResult[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error || "Search failed");
      }

      setResults(data.results ?? []);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unexpected error";
      setError(message);
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
          {isLoading ? "Searching..." : "Search Emails"}
        </button>
      </form>

      {error ? (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {!isLoading && submitted && !error && results.length === 0 ? (
        <p className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No emails found for this query and date range.
        </p>
      ) : null}

      {results.length > 0 ? (
        <div className="mt-6 space-y-3">
          {results.map((email) => (
            <article key={email.id} className="rounded-md border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">{email.subject || "(No subject)"}</h3>
              <p className="mt-1 text-xs text-slate-600">From: {email.from || "Unknown sender"}</p>
              <p className="text-xs text-slate-600">Date: {email.date || "Unknown date"}</p>
              <p className="mt-2 text-sm text-slate-700">{email.snippet || "(No snippet)"}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
