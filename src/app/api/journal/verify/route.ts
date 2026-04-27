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
  emails: VerifyEmailPreview[];
}

interface VerifyEmailPreview {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  gmailUrl: string;
}

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function listMessageIdsForQuery(
  gmail: ReturnType<typeof google.gmail>,
  query: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 100,
      pageToken,
    });
    const messages = response.data.messages ?? [];
    for (const message of messages) {
      if (message.id) {
        ids.add(message.id);
      }
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return ids;
}

function toHeader(
  headers: Array<{ name?: string | null; value?: string | null }> | undefined,
  name: string,
): string {
  const value = headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value;
  return value?.trim() ?? "";
}

function dateToMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function dedupeVerifyPreviewsByThread(previews: VerifyEmailPreview[]): VerifyEmailPreview[] {
  const byThread = new Map<string, VerifyEmailPreview>();
  for (const preview of previews) {
    const key = preview.threadId || preview.id;
    const existing = byThread.get(key);
    if (!existing || dateToMs(preview.date) > dateToMs(existing.date)) {
      byThread.set(key, preview);
    }
  }
  return Array.from(byThread.values());
}

async function fetchVerifyEmailPreview(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
): Promise<VerifyEmailPreview | null> {
  try {
    const response = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date"],
    });
    const payloadHeaders = response.data.payload?.headers ?? [];
    const threadId = response.data.threadId ?? "";
    return {
      id: response.data.id ?? messageId,
      threadId,
      subject: toHeader(payloadHeaders, "Subject"),
      from: toHeader(payloadHeaders, "From"),
      date: toHeader(payloadHeaders, "Date"),
      snippet: response.data.snippet ?? "",
      gmailUrl: threadId
        ? `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`
        : `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(response.data.id ?? messageId)}`,
    };
  } catch (error) {
    console.warn("[journal/verify] message preview fetch failed", {
      messageId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
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
      const uniqueIds = new Set<string>();
      const queriesChecked: string[] = [];

      for (const query of entry.queries) {
        queriesChecked.push(query);
        try {
          const queryIds = await listMessageIdsForQuery(gmail, query);
          for (const messageId of queryIds) {
            uniqueIds.add(messageId);
          }
        } catch (err) {
          console.warn("[journal/verify] list failed", {
            querySummary: query.slice(0, 120),
            error: err instanceof Error ? err.message : "unknown",
          });
        }
      }

      const resultSizeEstimate = uniqueIds.size;
      const previewsRaw = await runWithConcurrency(Array.from(uniqueIds), 8, async (messageId) =>
        fetchVerifyEmailPreview(gmail, messageId),
      );
      const emails = dedupeVerifyPreviewsByThread(
        previewsRaw.filter((item): item is VerifyEmailPreview => Boolean(item)),
      ).sort((a, b) => dateToMs(b.date) - dateToMs(a.date));
      items.push({
        display: entry.display,
        resultSizeEstimate: emails.length,
        queriesChecked,
        ok: emails.length > 0,
        emails,
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
