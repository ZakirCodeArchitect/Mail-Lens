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
  subject: string;
  from: string;
  date: string;
  snippet: string;
  summary: string;
  reason: string;
  relevanceScore: number;
}

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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
    console.info("[gmail/search] Gmail raw result count before AI", { count: emails.length });

    const results: SearchResponseResult[] = [];

    for (const email of emails) {
      try {
        const relevance = await checkEmailRelevance(query, intent.semanticIntent, email);
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
          subject: email.subject,
          from: email.from,
          date: email.date,
          snippet: email.snippet,
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

    console.info("[gmail/search] Returning relevant emails", {
      relevantCount: results.length,
      totalFetched: emails.length,
    });

    return NextResponse.json({
      gmailQueryUsed,
      intent,
      candidateCount: 50,
      fetchedCandidateCount: emails.length,
      results,
    });
  } catch (error) {
    console.error("Gmail search failed", error);
    return NextResponse.json({ error: "Failed to search Gmail emails" }, { status: 500 });
  }
}
