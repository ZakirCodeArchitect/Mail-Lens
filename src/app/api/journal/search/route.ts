import { google } from "googleapis";
import { NextRequest, NextResponse } from "next/server";

import { classifyJournalRelevance } from "@/lib/journal/journal-ai-classifier";
import { normalizeJournalInputs } from "@/lib/journal/input-normalizer";
import { buildJournalKeywordSet } from "@/lib/journal/journal-keywords";
import { buildJournalGmailQueries } from "@/lib/journal/journal-query-builder";
import {
  isAiUncertain,
  isVerifiedSourceNewsletter,
  looksLikeRoutineTransactionalEmail,
  scoreJournalEmail,
  shouldAutoInclude,
} from "@/lib/journal/journal-rule-scorer";
import {
  fromMatchesListedSenders,
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

const MAX_UNIQUE_EMAILS = 1500;
const MAX_PER_QUERY = 100;
const MAX_AI_UNCERTAIN = 150;
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
      const { messageIds, fetchedCount } = await searchGmailMessages(gmail, query, Math.min(MAX_PER_QUERY, remaining));
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
      pipelineEmails = parsedEmails.filter((email) => fromMatchesListedSenders(email.from, normalizedInputs));
      pipelineEmails = pipelineEmails.filter((email) => !looksLikeSapAutomatedNotification(email.from));
    }

    const uniqueCandidates = parsedCount;
    const afterListedSenderGate = pipelineEmails.length;

    const candidatesAfterKeywordFilter: Array<{
      email: ParsedJournalEmail;
      ruleScore: number;
      matchedSignals: string[];
    }> = [];

    for (const email of pipelineEmails) {
      if (looksLikeRoutineTransactionalEmail(email)) {
        continue;
      }
      const score = scoreJournalEmail(email, normalizedInputs, intentTerms);
      const hasStrongSenderOrSource =
        containsAnyTerm(email.from, [...normalizedInputs.senderEmails, ...normalizedInputs.senderNames]) ||
        containsAnyTerm(email.subject, normalizedInputs.sources) ||
        containsAnyTerm(email.snippet, normalizedInputs.sources);
      const hasKeyword = containsAnyTerm(
        `${email.subject} ${email.snippet} ${email.bodyText}`,
        intentTerms,
      );
      const hasSource = containsAnyTerm(`${email.subject} ${email.snippet} ${email.bodyText}`, normalizedInputs.sources);
      const keep = hasStrongSenderOrSource || hasKeyword || hasSource;

      if (keep) {
        candidatesAfterKeywordFilter.push({
          email,
          ruleScore: score.ruleScore,
          matchedSignals: score.matchedSignals,
        });
      }
    }

    const autoIncluded: JournalSearchResult[] = [];
    const uncertainCandidates: Array<{
      email: ParsedJournalEmail;
      ruleScore: number;
      matchedSignals: string[];
    }> = [];

    for (const candidate of candidatesAfterKeywordFilter) {
      if (looksLikeRoutineTransactionalEmail(candidate.email)) {
        continue;
      }
      if (looksLikeSapAutomatedNotification(candidate.email.from)) {
        continue;
      }
      if (shouldAutoInclude(candidate.ruleScore, candidate.matchedSignals, candidate.email)) {
        const label = toLabel(candidate.ruleScore);
        if (label !== "Irrelevant") {
          autoIncluded.push({
            id: candidate.email.id,
            threadId: candidate.email.threadId,
            subject: candidate.email.subject,
            from: candidate.email.from,
            date: candidate.email.date,
            snippet: candidate.email.snippet,
            gmailUrl: candidate.email.gmailUrl,
            label,
            ruleScore: candidate.ruleScore,
            aiScore: 0,
            finalScore: candidate.ruleScore,
            summary: "Auto-included by strong rule-based journal signals.",
            reason: "High confidence keyword/source/sender match from rule scoring.",
            matchedSignals: candidate.matchedSignals,
          });
        }
        continue;
      }

      if (looksLikeRoutineTransactionalEmail(candidate.email)) {
        continue;
      }
      if (looksLikeSapAutomatedNotification(candidate.email.from)) {
        continue;
      }

      if (isAiUncertain(candidate.ruleScore)) {
        uncertainCandidates.push(candidate);
        continue;
      }

      if (candidate.ruleScore >= 70) {
        uncertainCandidates.push(candidate);
        continue;
      }

      if (isVerifiedSourceNewsletter(candidate.email, normalizedInputs.sources)) {
        uncertainCandidates.push(candidate);
      }
    }

    const aiInput = uncertainCandidates
      .sort((a, b) => b.ruleScore - a.ruleScore)
      .slice(0, MAX_AI_UNCERTAIN);
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
      const finalScore = Math.max(candidate.ruleScore, classification.aiScore);
      if (!classification.isRelevant || finalScore < 50) {
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
    for (const result of [...autoIncluded, ...aiIncluded]) {
      const existing = finalById.get(result.id);
      if (!existing || result.finalScore > existing.finalScore) {
        finalById.set(result.id, result);
      }
    }

    const results = Array.from(finalById.values()).sort((a, b) => {
      if (b.finalScore !== a.finalScore) {
        return b.finalScore - a.finalScore;
      }
      return dateToMs(b.date) - dateToMs(a.date);
    });

    return NextResponse.json({
      summary: {
        totalFetched,
        uniqueCandidates,
        afterListedSenderGate,
        afterKeywordFilter: candidatesAfterKeywordFilter.length,
        autoIncluded: autoIncluded.length,
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
