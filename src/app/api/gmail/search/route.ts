import { NextRequest, NextResponse } from "next/server";

import { analyzeSearchIntent } from "@/ai/search-intent.service";
import { checkEmailRelevance } from "@/ai/email-relevance.service";
import { prisma } from "@/lib/prisma";
import { searchEmails } from "@/services/gmail.service";

interface SearchRequestBody {
  query?: string;
  startDate?: string;
  endDate?: string;
}

interface SearchResponseResult {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body: string;
  summary: string;
  reason: string;
  relevanceScore: number;
}

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function isSenderMatch(sender: string | null, text: string): boolean {
  if (!sender) {
    return false;
  }

  const senderTokens = tokenize(sender);
  if (senderTokens.length === 0) {
    return false;
  }

  const haystack = normalizeText(text);
  return senderTokens.some((token) => haystack.includes(token));
}

function passesLightweightFilters(
  emailFrom: string,
  emailBody: string,
  includeForwarded: boolean,
  requiresLinks: boolean,
  sender: string | null,
): boolean {
  const body = normalizeText(emailBody);
  const isDirectSenderMatch = isSenderMatch(sender, emailFrom);
  const hasForwardedMarker = body.includes("forwarded");
  const hasFromMarker = body.includes("from:");
  const isForwardedSenderMatch = sender
    ? (hasForwardedMarker || hasFromMarker) && isSenderMatch(sender, emailBody)
    : hasForwardedMarker || hasFromMarker;

  if (includeForwarded) {
    if (!isDirectSenderMatch && !isForwardedSenderMatch) {
      return false;
    }
  } else if (sender && !isDirectSenderMatch) {
    return false;
  }

  if (requiresLinks) {
    const hasLink = body.includes("http") || body.includes("www");
    if (!hasLink) {
      return false;
    }
  }

  return true;
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

    const body = (await request.json()) as SearchRequestBody;
    const query = body.query?.trim() ?? "";
    const startDate = body.startDate?.trim() ?? "";
    const endDate = body.endDate?.trim() ?? "";

    if (!query || !startDate || !endDate) {
      return NextResponse.json(
        { error: "query, startDate, and endDate are required" },
        { status: 400 },
      );
    }

    if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
      return NextResponse.json(
        { error: "Date format must be YYYY-MM-DD" },
        { status: 400 },
      );
    }

    console.info("[gmail/search] Starting Gmail search", {
      userId,
      startDate,
      endDate,
      queryLength: query.length,
    });

    const intent = await analyzeSearchIntent(query);
    const { emails, gmailQueryUsed } = await searchEmails(userId, intent, startDate, endDate);
    const candidateCount = emails.length;
    console.info("[gmail/search] Stage 2 complete (gmail fetch)", { candidateCount, gmailQueryUsed });

    const filteredEmails = emails.filter((email) =>
      passesLightweightFilters(
        email.from,
        email.body,
        intent.includeForwarded,
        intent.requiresLinks,
        intent.sender,
      ),
    );
    const afterFilterCount = filteredEmails.length;
    console.info("[gmail/search] Stage 3 complete (code filtering)", {
      afterFilterCount,
      includeForwarded: intent.includeForwarded,
      requiresLinks: intent.requiresLinks,
    });

    const results: SearchResponseResult[] = [];

    for (const email of filteredEmails) {
      try {
        const relevance = await checkEmailRelevance(query, intent.topic, intent.semanticIntent, email);
        console.info("[gmail/search] AI relevance evaluation", {
          emailId: email.id,
          relevanceScore: relevance.relevanceScore,
          isRelevant: relevance.isRelevant,
          reason: relevance.reason,
        });

        if (relevance.relevanceScore < 50) {
          continue;
        }

        results.push({
          id: email.id,
          threadId: email.threadId,
          subject: email.subject,
          from: email.from,
          date: email.date,
          snippet: email.snippet,
          body: email.body,
          summary: relevance.summary,
          reason: relevance.reason,
          relevanceScore: relevance.relevanceScore,
        });
      } catch (aiError) {
        console.error("[gmail/search] AI relevance check failed. Skipping email.", {
          emailId: email.id,
          error: aiError instanceof Error ? aiError.message : aiError,
        });
      }
    }
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const finalCount = results.length;

    console.info("[gmail/search] Stage 4 complete (AI filtering)", {
      candidateCount,
      afterFilterCount,
      finalCount,
    });

    return NextResponse.json({
      gmailQueryUsed,
      intent,
      candidateCount,
      afterFilterCount,
      finalCount,
      results,
    });
  } catch (error) {
    console.error("Gmail search failed", error);
    return NextResponse.json({ error: "Failed to search Gmail emails" }, { status: 500 });
  }
}
