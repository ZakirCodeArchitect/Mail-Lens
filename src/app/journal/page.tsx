import Link from "next/link";

import { JournalSearchForm } from "@/app/journal/journal-search-form";

interface JournalPageProps {
  searchParams?: Promise<{
    userId?: string;
  }>;
}

export default async function JournalPage({ searchParams }: JournalPageProps) {
  const params = searchParams ? await searchParams : {};
  const userId = params.userId;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                Journal Email Filtering
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">/journal</h1>
              <p className="mt-2 text-sm text-slate-600">
                Candidate retrieval from Gmail with rule scoring and AI checks for uncertain cases.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="/api/auth/google"
                className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Connect Gmail
              </a>
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                Semantic Dashboard
              </Link>
            </div>
          </div>
          <JournalSearchForm userId={userId} />
        </div>
      </div>
    </main>
  );
}
