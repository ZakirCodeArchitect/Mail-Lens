import { NextRequest, NextResponse } from "next/server";

import { analyzeSearchIntent } from "@/ai/search-intent.service";
import { checkEmailRelevance } from "@/ai/email-relevance.service";
import { prisma } from "@/lib/prisma";
import { searchEmails, searchEmailsCollectionMode } from "@/services/gmail.service";
import {
  detectSearchMode,
  detectQueryType,
  extractDeterministicMatchTerms,
  hasExactTopicMatch,
  hasHighPrecisionTopicHit,
  scoreEmailCandidate,
  sortByRuleScoreAndDate,
  topicTermMatches,
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
  gmailUrl: string;
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

function buildGmailUrl(threadId: string, messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId || messageId)}`;
}

function deterministicMatchSignals(
  email: {
    subject: string;
    snippet: string;
    body: string;
    from: string;
    attachmentFilenames: string[];
  },
  terms: string[],
): { isDeterministicMatch: boolean; isExactMatch: boolean; signals: string[] } {
  const usableTerms = terms.map((term) => term.trim()).filter((term) => term.length >= 2);
  if (usableTerms.length === 0) {
    return { isDeterministicMatch: false, isExactMatch: false, signals: [] };
  }

  const signals = new Set<string>();
  let isExactMatch = false;

  for (const term of usableTerms) {
    const checks: Array<{ text: string; signal: string; highPrecision: boolean }> = [
      { text: email.subject, signal: "subject-contains-term", highPrecision: true },
      { text: email.snippet, signal: "snippet-contains-term", highPrecision: false },
      { text: email.body, signal: "body-contains-term", highPrecision: false },
      { text: email.from, signal: "from-contains-term", highPrecision: true },
      { text: email.attachmentFilenames.join(" "), signal: "attachment-name-contains-term", highPrecision: true },
    ];

    for (const check of checks) {
      if (topicTermMatches(check.text, term)) {
        signals.add(check.signal);
        if (check.highPrecision) {
          isExactMatch = true;
        }
      }
    }
  }

  return {
    isDeterministicMatch: signals.size > 0,
    isExactMatch,
    signals: Array.from(signals),
  };
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
    const modeDetection = detectSearchMode(query);
    const queryTypes = detectQueryType(query, intent);

    if (modeDetection.mode === "search") {
      const { emails, queriesUsed, candidateCountBeforeDedup } = await searchEmails(
        userId,
        intent,
        startDate,
        endDate,
        queryTypes,
      );
      const uniqueCandidateCount = emails.length;
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
      const SEARCH_MODE_AI_TOP_N = 60;
      const aiInputCandidates = rankedCandidates
        .slice(0, SEARCH_MODE_AI_TOP_N)
        .map((entry) => candidateById.get(entry.email.id))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      const aiAnalyzedCount = aiInputCandidates.length;

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
          const hasTopicProtection =
            queryTypes.includes("topic") && hasExactTopicMatch(email, intent, query) && ruleScore >= 40;
          const include =
            hasTopicProtection || (relevance.modelDeclaresRelevant && aiScore >= 55);
          const finalScore = relevance.modelDeclaresRelevant ? Math.max(ruleScore, aiScore) : aiScore;

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
            gmailUrl: buildGmailUrl(email.threadId, email.id),
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
      return NextResponse.json({
        mode: "search",
        reason: modeDetection.reason,
        queryTypes,
        queriesUsed,
        intent,
        candidateCountBeforeDedup,
        uniqueCandidateCount,
        aiAnalyzedCount,
        finalCount,
        results,
      });
    }

    const { emails, queriesUsed, totalFetched, uniqueCandidateCount } = await searchEmailsCollectionMode(
      userId,
      intent,
      startDate,
      endDate,
    );
    const deterministicTerms = extractDeterministicMatchTerms(query, intent);
    const scoredCandidates = emails.map((email) => {
      const scored = scoreEmailCandidate(email, intent, queryTypes, query);
      const deterministic = deterministicMatchSignals(email, deterministicTerms);
      const exactTopicMatch = hasExactTopicMatch(email, intent, query);
      const highPrecisionHit = hasHighPrecisionTopicHit(email, deterministicTerms);
      const isAutoMatch = highPrecisionHit || exactTopicMatch;
      const isExactStyleMatch = deterministic.isExactMatch || highPrecisionHit;
      return {
        email,
        ...scored,
        deterministicSignals: deterministic.signals,
        isDeterministicMatch: deterministic.isDeterministicMatch,
        isAutoMatch,
        isExactStyleMatch,
        exactTopicMatch,
        highPrecisionHit,
      };
    });

    const autoMatchedCandidates = scoredCandidates.filter((candidate) => candidate.isAutoMatch);
    const autoMatchedIds = new Set(autoMatchedCandidates.map((candidate) => candidate.email.id));
    const uncertainCandidates = scoredCandidates
      .filter((candidate) => !autoMatchedIds.has(candidate.email.id))
      .sort((a, b) => b.ruleScore - a.ruleScore)
      .slice(0, 100);

    const aiReviewedResults: SearchResponseResult[] = [];
    for (const candidate of uncertainCandidates) {
      const mergedSignals = Array.from(new Set([...candidate.matchedSignals, ...candidate.deterministicSignals]));
      try {
        const relevance = await checkEmailRelevance(
          query,
          intent.topic,
          intent.semanticIntent,
          candidate.ruleScore,
          mergedSignals,
          candidate.email,
        );
        const aiScore = relevance.aiScore;
        if (!relevance.modelDeclaresRelevant || aiScore < 55) {
          continue;
        }

        const finalScore = Math.max(candidate.ruleScore, aiScore);

        aiReviewedResults.push({
          id: candidate.email.id,
          threadId: candidate.email.threadId,
          subject: candidate.email.subject,
          from: candidate.email.from,
          date: candidate.email.date,
          snippet: candidate.email.snippet,
          gmailUrl: buildGmailUrl(candidate.email.threadId, candidate.email.id),
          summary: relevance.summary,
          reason: relevance.reason,
          ruleScore: candidate.ruleScore,
          aiScore,
          finalScore,
          matchedSignals: mergedSignals,
          label: toLabel(finalScore),
        });
      } catch (aiError) {
        console.error("[gmail/search] AI relevance check failed in collection mode.", {
          emailId: candidate.email.id,
          error: aiError instanceof Error ? aiError.message : aiError,
        });
      }
    }

    const autoMatchedResults: SearchResponseResult[] = autoMatchedCandidates.map((candidate) => {
      const mergedSignals = Array.from(new Set([...candidate.matchedSignals, ...candidate.deterministicSignals]));
      const finalScore = Math.max(75, candidate.ruleScore);
      return {
        id: candidate.email.id,
        threadId: candidate.email.threadId,
        subject: candidate.email.subject,
        from: candidate.email.from,
        date: candidate.email.date,
        snippet: candidate.email.snippet,
        gmailUrl: buildGmailUrl(candidate.email.threadId, candidate.email.id),
        summary: candidate.highPrecisionHit
          ? "Auto-matched: topic/entity token in subject, snippet, sender, or attachment name."
          : "Auto-matched: topic/entity token in message content (word-level match).",
        reason: candidate.isExactStyleMatch
          ? "Deterministic token match in high-trust fields (subject/from/attachments) or verified body match."
          : "Deterministic token match in message content.",
        ruleScore: candidate.ruleScore,
        aiScore: 0,
        finalScore,
        matchedSignals: mergedSignals,
        label: toLabel(finalScore),
      };
    });

    const finalById = new Map<string, SearchResponseResult>();
    for (const result of [...autoMatchedResults, ...aiReviewedResults]) {
      const existing = finalById.get(result.id);
      if (!existing || result.finalScore > existing.finalScore) {
        finalById.set(result.id, result);
      }
    }
    const results = Array.from(finalById.values()).sort((a, b) => b.finalScore - a.finalScore);

    return NextResponse.json({
      mode: "collection",
      reason: modeDetection.reason,
      queryTypes,
      queriesUsed,
      totalFetched,
      uniqueCandidateCount,
      autoMatchedCount: autoMatchedResults.length,
      aiReviewedCount: uncertainCandidates.length,
      finalCount: results.length,
      pageSize: 25,
      resultCount: results.length,
      results,
    });
  } catch (error) {
    console.error("Gmail search failed", error);
    return NextResponse.json({ error: "Failed to search Gmail emails" }, { status: 500 });
  }
}
