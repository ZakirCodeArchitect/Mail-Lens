import Link from "next/link";

import { EmailSearchForm } from "@/app/dashboard/email-search-form";

interface DashboardPageProps {
  searchParams?: Promise<{
    gmail?: string;
    reason?: string;
    userId?: string;
  }>;
}

function renderStatusMessage(gmail?: string, reason?: string) {
  if (gmail === "connected") {
    return (
      <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
        Gmail connected successfully.
      </p>
    );
  }

  if (gmail === "error") {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
        Gmail connection failed{reason ? `: ${reason}` : "."}
      </p>
    );
  }

  return (
    <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      Connect your Gmail account to continue.
    </p>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = searchParams ? await searchParams : {};
  const gmail = params.gmail;
  const reason = params.reason;
  const userId = params.userId;

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-100 px-4 py-10 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="rounded-2xl border border-slate-200/80 bg-white/90 p-6 shadow-sm backdrop-blur sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">
                Semantic Email Search
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                Dashboard
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Retrieve broad Gmail candidates and let AI rank semantic relevance.
              </p>
            </div>
            <Link
              href="/"
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              Back to home
            </Link>
          </div>

          <div className="mt-6">{renderStatusMessage(gmail, reason)}</div>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900">Gmail Connection</p>
                <p className="text-xs text-slate-600">Authorize account access for search candidates.</p>
              </div>
              <a
                href="/api/auth/google"
                className="inline-flex items-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Connect Gmail
              </a>
            </div>
          </div>

          <EmailSearchForm userId={userId} />
        </div>
      </div>
    </main>
  );
}
