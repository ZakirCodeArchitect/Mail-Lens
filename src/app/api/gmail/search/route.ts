import { NextRequest, NextResponse } from "next/server";

import { analyzeSearchIntent } from "@/ai/search-intent.service";
import { checkEmailRelevance } from "@/ai/email-relevance.service";
import { prisma } from "@/lib/prisma";
import { searchEmails } from "@/services/gmail.service";
import {
  detectQueryType,
  hasExactTopicMatch,
  scoreEmailCandidate,
  sortByRuleScoreAndDate,
} from "@/services/search-pipeline.service";

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
  ruleScore: number;
  aiScore: number;
  finalScore: number;
  matchedSignals: string[];
  label: "Highly Relevant" | "Possible Match";
}

function isValidDateInput(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toLabel(score: number): "Highly Relevant" | "Possible Match" {
  return score >= 75 ? "Highly Relevant" : "Possible Match";
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
    const queryTypes = detectQueryType(query, intent);
    const { emails, queriesUsed, candidateCountBeforeDedup } = await searchEmails(
      userId,
      intent,
      startDate,
      endDate,
      queryTypes,
    );
    const uniqueCandidateCount = emails.length;
    console.info("[gmail/search] Stage 2 complete (hybrid retrieval)", {
      queryTypes,
      queriesUsed,
      candidateCountBeforeDedup,
      uniqueCandidateCount,
    });

    const scoredCandidates = emails.map((email) => ({
      email,
      ...scoreEmailCandidate(email, intent, queryTypes, query),
    }));

    const rankedCandidates = sortByRuleScoreAndDate(
      scoredCandidates.map((candidate) => ({
        email: candidate.email,
        ruleScore: candidate.ruleScore,
      })),
    );
    const candidateById = new Map(scoredCandidates.map((item) => [item.email.id, item]));
    const aiInputCandidates = rankedCandidates
      .slice(0, 30)
      .map((entry) => candidateById.get(entry.email.id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const aiAnalyzedCount = aiInputCandidates.length;
    console.info("[gmail/search] Stage 3 complete (rule scoring)", {
      scoredCandidateCount: scoredCandidates.length,
      aiAnalyzedCount,
    });

    const results: SearchResponseResult[] = [];

    for (const candidate of aiInputCandidates) {
      const { email, ruleScore, matchedSignals } = candidate;
      try {
        const relevance = await checkEmailRelevance(
          query,
          intent.topic,
          intent.semanticIntent,
          ruleScore,
          matchedSignals,
          email,
        );
        const aiScore = relevance.aiScore;
        const finalScore = Math.max(ruleScore, aiScore);
        const hasTopicProtection =
          queryTypes.includes("topic") && hasExactTopicMatch(email, intent, query) && ruleScore >= 40;
        const include =
          finalScore >= 50 || hasTopicProtection || (ruleScore >= 40 && queryTypes.includes("topic"));

        console.info("[gmail/search] AI relevance evaluation", {
          emailId: email.id,
          ruleScore,
          aiScore,
          finalScore,
          isRelevant: relevance.isRelevant,
          reason: relevance.reason,
          matchedSignals,
        });

        if (!include) {
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
          ruleScore,
          aiScore,
          finalScore,
          matchedSignals,
          label: toLabel(finalScore),
        });
      } catch (aiError) {
        console.error("[gmail/search] AI relevance check failed. Skipping email.", {
          emailId: email.id,
          error: aiError instanceof Error ? aiError.message : aiError,
        });
      }
    }
    results.sort((a, b) => b.finalScore - a.finalScore);
    const finalCount = results.length;

    console.info("[gmail/search] Stage 4 complete (AI ranking + final filtering)", {
      queryTypes,
      queriesUsed,
      candidateCountBeforeDedup,
      uniqueCandidateCount,
      aiAnalyzedCount,
      finalCount,
    });

    return NextResponse.json({
      queryTypes,
      queriesUsed,
      intent,
      candidateCountBeforeDedup,
      uniqueCandidateCount,
      aiAnalyzedCount,
      finalCount,
      results,
    });
  } catch (error) {
    console.error("Gmail search failed", error);
    return NextResponse.json({ error: "Failed to search Gmail emails" }, { status: 500 });
  }
}
