import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-900">
      <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold">AI Gmail Search Agent</h1>
        <p className="mt-3 text-slate-600">
          Phase 1 is ready: connect your Gmail account to enable secure
          read-only access.
        </p>
        <div className="mt-8">
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-md bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            Open Dashboard
          </Link>
          <Link
            href="/journal"
            className="ml-3 inline-flex items-center rounded-md border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-900"
          >
            Open Journal Filter
          </Link>
        </div>
      </div>
    </main>
  );
}
