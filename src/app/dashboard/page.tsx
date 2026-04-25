import Link from "next/link";

interface DashboardPageProps {
  searchParams?: Promise<{
    gmail?: string;
    reason?: string;
  }>;
}

function renderStatusMessage(gmail?: string, reason?: string) {
  if (gmail === "connected") {
    return (
      <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        Gmail connected successfully.
      </p>
    );
  }

  if (gmail === "error") {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        Gmail connection failed{reason ? `: ${reason}` : "."}
      </p>
    );
  }

  return (
    <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      Connect your Gmail account to continue.
    </p>
  );
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const params = searchParams ? await searchParams : {};
  const gmail = params.gmail;
  const reason = params.reason;

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16 text-slate-900">
      <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-3xl font-semibold">Dashboard</h1>
          <Link href="/" className="text-sm text-slate-600 underline hover:text-slate-900">
            Back to home
          </Link>
        </div>

        <div className="mt-6">{renderStatusMessage(gmail, reason)}</div>

        <div className="mt-8">
          <a
            href="/api/auth/google"
            className="inline-flex items-center rounded-md bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            Connect Gmail
          </a>
        </div>
      </div>
    </main>
  );
}
