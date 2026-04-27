import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";

import { classifyJournalRelevance } from "@/lib/journal/journal-ai-classifier";
import { normalizeJournalInputs } from "@/lib/journal/input-normalizer";
import { buildJournalKeywordSet } from "@/lib/journal/journal-keywords";
import { buildJournalGmailQueries } from "@/lib/journal/journal-query-builder";
import {
  scoreJournalEmail,
} from "@/lib/journal/journal-rule-scorer";
import {
  emailMatchesListedSenders,
  hasListedSenders,
  looksLikeSapAutomatedNotification,
} from "@/lib/journal/journal-sender-gate";
import { createOAuthClient } from "@/lib/google";
import { prisma } from "@/lib/prisma";
import {
  fetchGmailMessageDetails,
  type ParsedJournalEmail,
  searchGmailMessages,
} from "@/services/journal-gmail.service";

interface JournalSearchRequestBody {
  startDate?: string;
  endDate?: string;
  senders?: string[] | string;
  sources?: string[] | string;
  intent?: string;
}

type ResultLabel = "Highly Relevant" | "Relevant" | "Possible Match";

interface JournalSearchResult {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  gmailUrl: string;
  label: ResultLabel;
  ruleScore: number;
  aiScore: number;
  finalScore: number;
  summary: string;
  reason: string;
  matchedSignals: string[];
}

const MAX_UNIQUE_EMAILS = 20000;
const MAX_PER_QUERY = MAX_UNIQUE_EMAILS;
const AI_CONCURRENCY = 3;

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toLabel(score: number): ResultLabel | "Irrelevant" {
  if (score >= 85) {
    return "Highly Relevant";
  }
  if (score >= 70) {
    return "Relevant";
  }
  if (score >= 50) {
    return "Possible Match";
  }
  return "Irrelevant";
}

function containsAnyTerm(text: string, terms: string[]): boolean {
  const lowerText = text.toLowerCase();
  return terms.some((term) => lowerText.includes(term.toLowerCase()));
}

function emailMatchesSources(
  email: Pick<ParsedJournalEmail, "subject" | "snippet" | "bodyText" | "from" | "to" | "attachmentFilenames">,
  sources: string[],
): boolean {
  if (sources.length === 0) {
    return true;
  }
  const corpus = [
    email.subject,
    email.snippet,
    email.bodyText,
    email.from,
    email.to,
    email.attachmentFilenames.join(" "),
  ].join("\n");
  return containsAnyTerm(corpus, sources);
}

function dateToMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
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

    const body = (await request.json()) as JournalSearchRequestBody;
    const startDate = body.startDate?.trim() ?? "";
    const endDate = body.endDate?.trim() ?? "";
    if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
      return NextResponse.json({ error: "startDate and endDate must be YYYY-MM-DD" }, { status: 400 });
    }

    const normalizedInputs = normalizeJournalInputs({
      senders: body.senders ?? [],
      sources: body.sources ?? [],
      intent:
        body.intent?.trim() ||
        "Find emails related to student achievements, college achievements, awards, projects, seminars, webinars, talks, discussions, conferences, participation, recognition, and success stories.",
    });
    const intentTerms = buildJournalKeywordSet(normalizedInputs.intent);
    const queriesUsed = buildJournalGmailQueries(startDate, endDate, normalizedInputs);

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

    const uniqueMessageIds = new Set<string>();
    let totalFetched = 0;

    for (const query of queriesUsed) {
      if (uniqueMessageIds.size >= MAX_UNIQUE_EMAILS) {
        break;
      }
      const remaining = MAX_UNIQUE_EMAILS - uniqueMessageIds.size;
      const { messageIds, fetchedCount } = await searchGmailMessages(
        gmail,
        query,
        Math.min(MAX_PER_QUERY, remaining),
      );
      totalFetched += fetchedCount;
      for (const messageId of messageIds) {
        uniqueMessageIds.add(messageId);
      }
    }

    const uniqueIds = Array.from(uniqueMessageIds).slice(0, MAX_UNIQUE_EMAILS);
    const parsedEmailsRaw = await runWithConcurrency(uniqueIds, 8, async (messageId) =>
      fetchGmailMessageDetails(gmail, messageId),
    );
    const parsedEmails = parsedEmailsRaw.filter((item): item is ParsedJournalEmail => Boolean(item));
    const parsedCount = parsedEmails.length;

    let pipelineEmails = parsedEmails;
    if (hasListedSenders(normalizedInputs)) {
      pipelineEmails = parsedEmails.filter((email) => emailMatchesListedSenders(email, normalizedInputs));
      pipelineEmails = pipelineEmails.filter((email) => !looksLikeSapAutomatedNotification(email.from));
    }
    if (normalizedInputs.sources.length > 0) {
      pipelineEmails = pipelineEmails.filter((email) => emailMatchesSources(email, normalizedInputs.sources));
    }

    const uniqueCandidates = parsedCount;
    const afterListedSenderGate = pipelineEmails.length;

    const candidatesForAi: Array<{
      email: ParsedJournalEmail;
      ruleScore: number;
      matchedSignals: string[];
    }> = [];

    for (const email of pipelineEmails) {
      const score = scoreJournalEmail(email, normalizedInputs, intentTerms);
      candidatesForAi.push({
        email,
        ruleScore: score.ruleScore,
        matchedSignals: score.matchedSignals,
      });
    }

    const aiInput = [...candidatesForAi].sort((a, b) => b.ruleScore - a.ruleScore);
    const aiChecked = aiInput.length;
    const aiResultsRaw = await runWithConcurrency(aiInput, AI_CONCURRENCY, async (candidate) => {
      try {
        const classification = await classifyJournalRelevance(
          candidate.email,
          normalizedInputs.intent,
          candidate.matchedSignals,
          candidate.ruleScore,
        );
        return { candidate, classification };
      } catch (error) {
        console.error("[journal/ai] classification failed", {
          messageId: candidate.email.id,
          error: error instanceof Error ? error.message : "unknown",
        });
        return null;
      }
    });

    const aiIncluded: JournalSearchResult[] = [];
    for (const item of aiResultsRaw) {
      if (!item) {
        continue;
      }
      const { candidate, classification } = item;
      const finalScore = classification.aiScore;
      const aiSaysRelevant = classification.isRelevant || classification.label === "Highly Relevant" || classification.label === "Relevant";
      if (!aiSaysRelevant) {
        continue;
      }
      const label = toLabel(finalScore);
      if (label === "Irrelevant") {
        continue;
      }
      aiIncluded.push({
        id: candidate.email.id,
        threadId: candidate.email.threadId,
        subject: candidate.email.subject,
        from: candidate.email.from,
        date: candidate.email.date,
        snippet: candidate.email.snippet,
        gmailUrl: candidate.email.gmailUrl,
        label,
        ruleScore: candidate.ruleScore,
        aiScore: classification.aiScore,
        finalScore,
        summary: classification.summary,
        reason: classification.reason,
        matchedSignals: candidate.matchedSignals,
      });
    }

    const finalById = new Map<string, JournalSearchResult>();
    for (const result of aiIncluded) {
      const dedupeKey = result.threadId || result.id;
      const existing = finalById.get(dedupeKey);
      if (!existing) {
        finalById.set(dedupeKey, result);
        continue;
      }
      if (result.finalScore > existing.finalScore) {
        finalById.set(dedupeKey, result);
        continue;
      }
      if (result.finalScore === existing.finalScore && dateToMs(result.date) > dateToMs(existing.date)) {
        finalById.set(dedupeKey, result);
      }
    }

    const results = Array.from(finalById.values()).sort((a, b) => {
      if (b.finalScore !== a.finalScore) {
        return b.finalScore - a.finalScore;
      }
      if (b.aiScore !== a.aiScore) {
        return b.aiScore - a.aiScore;
      }
      if (b.ruleScore !== a.ruleScore) {
        return b.ruleScore - a.ruleScore;
      }
      return dateToMs(b.date) - dateToMs(a.date);
    });

    return NextResponse.json({
      summary: {
        totalFetched,
        uniqueCandidates,
        afterListedSenderGate,
        afterKeywordFilter: candidatesForAi.length,
        autoIncluded: 0,
        aiChecked,
        finalCount: results.length,
      },
      queriesUsed,
      results,
    });
  } catch (error) {
    console.error("[journal/search] failed", error);
    return NextResponse.json({ error: "Failed to run journal email filtering." }, { status: 500 });
  }
}
