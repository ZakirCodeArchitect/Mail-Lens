"use client";

import { FormEvent, useMemo, useState } from "react";

interface JournalResult {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  gmailUrl: string;
  label: "Highly Relevant" | "Relevant" | "Possible Match";
  ruleScore: number;
  aiScore: number;
  finalScore: number;
  summary: string;
  reason: string;
  matchedSignals: string[];
}

interface JournalSearchResponse {
  summary: {
    totalFetched: number;
    uniqueCandidates: number;
    afterListedSenderGate?: number;
    afterKeywordFilter: number;
    autoIncluded: number;
    aiChecked: number;
    finalCount: number;
  };
  queriesUsed: string[];
  results: JournalResult[];
  error?: string;
}

interface JournalSearchFormProps {
  userId?: string;
}

interface VerifyLineItem {
  display: string;
  resultSizeEstimate: number | null;
  queriesChecked: string[];
  ok: boolean;
  emails: Array<{
    id: string;
    threadId: string;
    subject: string;
    from: string;
    date: string;
    snippet: string;
    gmailUrl: string;
  }>;
}

interface VerifyResponse {
  scope: "senders" | "sources";
  items: VerifyLineItem[];
  message?: string;
  error?: string;
}

function toInputDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function badgeClass(label: JournalResult["label"]): string {
  if (label === "Highly Relevant") {
    return "border border-emerald-200 bg-emerald-100 text-emerald-800";
  }
  if (label === "Relevant") {
    return "border border-indigo-200 bg-indigo-100 text-indigo-800";
  }
  return "border border-amber-200 bg-amber-100 text-amber-800";
}

const DEFAULT_INTENT =
  "Find emails related to student achievements, college achievements, awards, projects, seminars, webinars, talks, discussions, conferences, participation, recognition, and success stories.";

export function JournalSearchForm({ userId }: JournalSearchFormProps) {
  const today = useMemo(() => new Date(), []);
  const [startDate, setStartDate] = useState(toInputDate(new Date(today.getFullYear(), 0, 1)));
  const [endDate, setEndDate] = useState(toInputDate(today));
  const [senderInputs, setSenderInputs] = useState<string[]>([""]);
  const [sources, setSources] = useState("");
  const [intent, setIntent] = useState(DEFAULT_INTENT);
  const [results, setResults] = useState<JournalResult[]>([]);
  const [summary, setSummary] = useState<JournalSearchResponse["summary"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [senderVerify, setSenderVerify] = useState<VerifyResponse | null>(null);
  const [sourceVerify, setSourceVerify] = useState<VerifyResponse | null>(null);
  const [verifySendersLoading, setVerifySendersLoading] = useState(false);
  const [verifySourcesLoading, setVerifySourcesLoading] = useState(false);
  const [verifySendersError, setVerifySendersError] = useState<string | null>(null);
  const [verifySourcesError, setVerifySourcesError] = useState<string | null>(null);

  const senderLines = senderInputs.map((value) => value.trim()).filter(Boolean);

  function updateSenderInput(index: number, value: string) {
    setSenderInputs((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function addSenderInput() {
    setSenderInputs((current) => [...current, ""]);
  }

  function removeSenderInput(index: number) {
    setSenderInputs((current) => {
      if (current.length <= 1) {
        return [""];
      }
      const updated = current.filter((_, itemIndex) => itemIndex !== index);
      return updated.length > 0 ? updated : [""];
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    setError(null);
    setIsLoading(true);
    setResults([]);
    setSummary(null);

    try {
      const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
      const response = await fetch(`/api/journal/search${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate,
          endDate,
          senders: senderLines,
          sources: sources.split(/\r?\n/g),
          intent,
        }),
      });
      const data = (await response.json()) as JournalSearchResponse;
      if (!response.ok) {
        throw new Error(data.error || "Failed to search journal emails.");
      }
      setResults(data.results ?? []);
      setSummary(data.summary ?? null);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unexpected error";
      setError(message);
      setResults([]);
      setSummary(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function verifyScope(scope: "senders" | "sources") {
    const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    const body =
      scope === "senders"
        ? { startDate, endDate, scope, senders: senderLines }
        : { startDate, endDate, scope, sources: sources.split(/\r?\n/g) };

    const response = await fetch(`/api/journal/verify${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as VerifyResponse;
    if (!response.ok) {
      throw new Error(data.error || "Verify request failed.");
    }
    return data;
  }

  async function handleVerifySenders() {
    setVerifySendersError(null);
    setSenderVerify(null);
    setVerifySendersLoading(true);
    try {
      const data = await verifyScope("senders");
      setSenderVerify(data);
    } catch (e) {
      setVerifySendersError(e instanceof Error ? e.message : "Verify failed.");
      setSenderVerify(null);
    } finally {
      setVerifySendersLoading(false);
    }
  }

  async function handleVerifySources() {
    setVerifySourcesError(null);
    setSourceVerify(null);
    setVerifySourcesLoading(true);
    try {
      const data = await verifyScope("sources");
      setSourceVerify(data);
    } catch (e) {
      setVerifySourcesError(e instanceof Error ? e.message : "Verify failed.");
      setSourceVerify(null);
    } finally {
      setVerifySourcesLoading(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Journal Email Filtering</h2>
      <p className="mt-1 text-sm text-slate-600">
        Scan Gmail and keep only emails relevant for journal writing evidence.
      </p>

      <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Date Range</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
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
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                People / Email Identities
              </p>
              <p className="text-xs text-slate-500">
                Add emails or names to match anywhere in messages (from/to/cc/content). Use + to add more.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={addSenderInput}
                disabled={isLoading}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-lg font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Add sender input"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => void handleVerifySenders()}
                disabled={verifySendersLoading || isLoading}
                className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {verifySendersLoading ? "Verifying…" : "Search verify"}
              </button>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {senderInputs.map((sender, index) => (
              <div key={`sender-input-${index}`} className="flex items-center gap-2">
                <input
                  type="email"
                  value={sender}
                  onChange={(event) => updateSenderInput(index, event.target.value)}
                  placeholder="person@example.com or Person Name"
                  className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                />
                {senderInputs.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeSenderInput(index)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 bg-white text-base font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                    aria-label={`Remove sender input ${index + 1}`}
                  >
                    -
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {verifySendersError ? (
            <p className="mt-2 text-xs text-red-600">{verifySendersError}</p>
          ) : null}
          {senderVerify?.message && senderVerify.items.length === 0 ? (
            <p className="mt-2 text-xs text-amber-800">{senderVerify.message}</p>
          ) : null}
          {senderVerify && senderVerify.items.length > 0 ? (
            <ul className="mt-2 space-y-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
              {senderVerify.items.map((row) => (
                <li key={`sender-${row.display}`} className="rounded-md border border-slate-100 p-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-slate-900">{row.display}</span>
                    <span className={row.ok ? "text-emerald-700" : "text-slate-500"}>
                      {row.ok
                        ? `${row.resultSizeEstimate ?? 0} email${(row.resultSizeEstimate ?? 0) === 1 ? "" : "s"} found`
                        : "0 emails found"}
                    </span>
                  </div>
                  {row.emails.length > 0 ? (
                    <details className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                        Show matched emails
                      </summary>
                      <div className="mt-2 max-h-72 space-y-2 overflow-auto pr-1">
                        {row.emails.map((email) => (
                          <article key={`sender-preview-${row.display}-${email.id}`} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                            <p className="text-xs font-semibold text-slate-900">{email.subject || "(No subject)"}</p>
                            <p className="mt-0.5 text-[11px] text-slate-600">From: {email.from || "Unknown sender"}</p>
                            <p className="text-[11px] text-slate-500">{email.date || "Unknown date"}</p>
                            <p className="mt-1 text-[11px] text-slate-700">{email.snippet || "(No snippet)"}</p>
                            {email.gmailUrl ? (
                              <a
                                href={email.gmailUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-flex text-[11px] font-semibold text-indigo-700 hover:text-indigo-600"
                              >
                                Open in Gmail
                              </a>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {senderVerify && senderVerify.items.length > 0 ? (
            <p className="mt-1 text-xs text-slate-500">Counts are within the selected date range.</p>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Sources / Newsletters / Keywords
              </p>
              <p className="text-xs text-slate-500">
                Enter source names, newsletter names, or institutional keywords, one per line.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleVerifySources()}
              disabled={verifySourcesLoading || isLoading}
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifySourcesLoading ? "Verifying…" : "Search verify"}
            </button>
          </div>
          <textarea
            value={sources}
            onChange={(event) => setSources(event.target.value)}
            placeholder={"Daily Buzz\nNASTP\nQAU"}
            rows={4}
            className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          />
          {verifySourcesError ? (
            <p className="mt-2 text-xs text-red-600">{verifySourcesError}</p>
          ) : null}
          {sourceVerify?.message && sourceVerify.items.length === 0 ? (
            <p className="mt-2 text-xs text-amber-800">{sourceVerify.message}</p>
          ) : null}
          {sourceVerify && sourceVerify.items.length > 0 ? (
            <ul className="mt-2 space-y-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
              {sourceVerify.items.map((row) => (
                <li key={`source-${row.display}`} className="rounded-md border border-slate-100 p-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-slate-900">{row.display}</span>
                    <span className={row.ok ? "text-emerald-700" : "text-slate-500"}>
                      {row.ok
                        ? `${row.resultSizeEstimate ?? 0} email${(row.resultSizeEstimate ?? 0) === 1 ? "" : "s"} found`
                        : "0 emails found"}
                    </span>
                  </div>
                  {row.emails.length > 0 ? (
                    <details className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                        Show matched emails
                      </summary>
                      <div className="mt-2 max-h-72 space-y-2 overflow-auto pr-1">
                        {row.emails.map((email) => (
                          <article key={`source-preview-${row.display}-${email.id}`} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                            <p className="text-xs font-semibold text-slate-900">{email.subject || "(No subject)"}</p>
                            <p className="mt-0.5 text-[11px] text-slate-600">From: {email.from || "Unknown sender"}</p>
                            <p className="text-[11px] text-slate-500">{email.date || "Unknown date"}</p>
                            <p className="mt-1 text-[11px] text-slate-700">{email.snippet || "(No snippet)"}</p>
                            {email.gmailUrl ? (
                              <a
                                href={email.gmailUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-1 inline-flex text-[11px] font-semibold text-indigo-700 hover:text-indigo-600"
                              >
                                Open in Gmail
                              </a>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {sourceVerify && sourceVerify.items.length > 0 ? (
            <p className="mt-1 text-xs text-slate-500">Counts are within the selected date range.</p>
          ) : null}
        </div>

        <label className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            What kind of emails are relevant?
          </span>
          <textarea
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            rows={4}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            required
          />
        </label>

        <button
          type="submit"
          disabled={isLoading}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-300"
        >
          {isLoading ? "Scanning Gmail sources and filtering relevant emails..." : "Find Relevant Emails"}
        </button>
      </form>

      {error ? (
        <p className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}

      {!isLoading && submitted && !error && results.length === 0 ? (
        <p className="mt-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          No relevant emails found from selected senders/sources for this date range.
        </p>
      ) : null}

      {summary ? (
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
          <p className="font-semibold text-slate-800">Debug summary</p>
          <p className="mt-1">
            total fetched: {summary.totalFetched} | unique candidates: {summary.uniqueCandidates}
            {typeof summary.afterListedSenderGate === "number"
              ? ` | after sender gate: ${summary.afterListedSenderGate}`
              : ""}{" "}
            | after keyword filter: {summary.afterKeywordFilter} | auto included: {summary.autoIncluded} | AI checked:{" "}
            {summary.aiChecked} | final count: {summary.finalCount}
          </p>
        </div>
      ) : null}

      {results.length > 0 ? (
        <div className="mt-7 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Results</h3>
            <p className="text-sm text-slate-500">{results.length} relevant emails</p>
          </div>
          {results.map((email) => (
            <article key={email.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className={`inline-flex rounded-sm px-2.5 py-1 text-xs font-semibold ${badgeClass(email.label)}`}>
                  {email.label}
                </p>
                <p className="text-xs font-semibold text-indigo-700">Final Score {email.finalScore}</p>
              </div>
              <h3 className="text-base font-semibold text-slate-900">{email.subject || "(No subject)"}</h3>
              <div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
                <p>From: {email.from || "Unknown sender"}</p>
                <p>Date: {email.date || "Unknown date"}</p>
              </div>
              <p className="mt-3 text-sm text-slate-700">{email.snippet || "(No snippet)"}</p>
              <p className="mt-2 text-sm text-slate-800">
                <span className="font-semibold text-slate-900">AI summary:</span> {email.summary || "(No summary)"}
              </p>
              <p className="mt-1 text-sm text-slate-700">
                <span className="font-semibold text-slate-900">Reason:</span> {email.reason || "(No reason)"}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Rule Score: {email.ruleScore} | AI Score: {email.aiScore}
              </p>
              {email.matchedSignals.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {email.matchedSignals.map((signal) => (
                    <span
                      key={`${email.id}-${signal}`}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                    >
                      {signal}
                    </span>
                  ))}
                </div>
              ) : null}
              {email.gmailUrl ? (
                <a
                  href={email.gmailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                >
                  Open in Gmail
                </a>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
