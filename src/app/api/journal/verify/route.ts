import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";

import { normalizeJournalInputs } from "@/lib/journal/input-normalizer";
import { buildListedSenderFromClause } from "@/lib/journal/journal-query-builder";
import {
  buildJournalDateRangeClause,
  buildSenderVerifyQueries,
  buildSourceVerifyQueries,
} from "@/lib/journal/journal-verify-queries";
import { hasListedSenders } from "@/lib/journal/journal-sender-gate";
import { createOAuthClient } from "@/lib/google";
import { prisma } from "@/lib/prisma";

interface VerifyRequestBody {
  startDate?: string;
  endDate?: string;
  scope?: "senders" | "sources";
  senders?: string[] | string;
  sources?: string[] | string;
}

interface VerifyLineResult {
  display: string;
  resultSizeEstimate: number | null;
  queriesChecked: string[];
  ok: boolean;
}

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function estimateForQuery(
  gmail: ReturnType<typeof google.gmail>,
  query: string,
): Promise<number | null> {
  const response = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 1,
  });
  const estimate = response.data.resultSizeEstimate;
  if (typeof estimate === "number" && !Number.isNaN(estimate)) {
    return estimate;
  }
  const messages = response.data.messages ?? [];
  return messages.length > 0 ? 1 : 0;
}

export async function POST(request: NextRequest) {
  try {
    const providedUserId = request.nextUrl.searchParams.get("userId");
    const fallbackAccount = providedUserId
      ? null
      : await prisma.googleAccount.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { userId: true },
        });
    const userId = providedUserId ?? fallbackAccount?.userId;
    if (!userId) {
      return NextResponse.json(
        { error: "No connected Gmail account found. Connect Gmail first." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as VerifyRequestBody;
    const startDate = body.startDate?.trim() ?? "";
    const endDate = body.endDate?.trim() ?? "";
    const scope = body.scope;

    if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
      return NextResponse.json({ error: "startDate and endDate must be YYYY-MM-DD" }, { status: 400 });
    }
    if (scope !== "senders" && scope !== "sources") {
      return NextResponse.json({ error: 'scope must be "senders" or "sources"' }, { status: 400 });
    }

    const normalized = normalizeJournalInputs({
      senders: body.senders ?? [],
      sources: body.sources ?? [],
      intent: "",
    });

    const base = buildJournalDateRangeClause(startDate, endDate);
    const fromClause = hasListedSenders(normalized) ? buildListedSenderFromClause(normalized) : null;
    const entries =
      scope === "senders"
        ? buildSenderVerifyQueries(base, normalized.senderEmails, normalized.senderNames)
        : buildSourceVerifyQueries(base, normalized.sources, fromClause);

    if (entries.length === 0) {
      return NextResponse.json({
        scope,
        items: [] as VerifyLineResult[],
        message: scope === "senders" ? "Add at least one sender line to verify." : "Add at least one source line to verify.",
      });
    }

    const googleAccount = await prisma.googleAccount.findUnique({
      where: { userId },
      select: { accessToken: true },
    });
    if (!googleAccount?.accessToken) {
      return NextResponse.json({ error: "Google account not connected for this user." }, { status: 400 });
    }

    const oauthClient = createOAuthClient();
    oauthClient.setCredentials({ access_token: googleAccount.accessToken });
    const gmail = google.gmail({ version: "v1", auth: oauthClient });

    const items: VerifyLineResult[] = [];

    for (const entry of entries) {
      let maxEstimate = 0;
      let sawEstimate = false;
      const queriesChecked: string[] = [];

      for (const query of entry.queries) {
        queriesChecked.push(query);
        try {
          const est = await estimateForQuery(gmail, query);
          if (est !== null) {
            sawEstimate = true;
            maxEstimate = Math.max(maxEstimate, est);
          }
        } catch (err) {
          console.warn("[journal/verify] list failed", {
            querySummary: query.slice(0, 120),
            error: err instanceof Error ? err.message : "unknown",
          });
        }
      }

      const resultSizeEstimate = sawEstimate ? maxEstimate : null;
      items.push({
        display: entry.display,
        resultSizeEstimate,
        queriesChecked,
        ok: resultSizeEstimate !== null && resultSizeEstimate > 0,
      });
    }

    console.info("[journal/verify] completed", {
      scope,
      lineCount: items.length,
      okCount: items.filter((i) => i.ok).length,
    });

    return NextResponse.json({ scope, items });
  } catch (error) {
    console.error("[journal/verify] failed", error);
    return NextResponse.json({ error: "Failed to verify Gmail search for journal inputs." }, { status: 500 });
  }
}
