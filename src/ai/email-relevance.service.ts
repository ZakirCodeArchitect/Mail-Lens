import { openai } from "@/lib/openai";
import { SearchedEmail } from "@/services/gmail.service";

interface EmailRelevanceResult {
  isRelevant: boolean;
  relevanceScore: number;
  summary: string;
  reason: string;
}

interface ParsedModelResponse {
  isRelevant?: unknown;
  relevanceScore?: unknown;
  summary?: unknown;
  reason?: unknown;
}

const RELEVANCE_THRESHOLD = 70;
const POSSIBLE_MATCH_THRESHOLD = 50;
const MAX_BODY_CHARS = 4000;

function toSafeString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeScore(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseJsonObject(content: string): ParsedModelResponse {
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI response was not a JSON object");
  }
  return parsed as ParsedModelResponse;
}

export async function checkEmailRelevance(
  userQuery: string,
  topic: string | null,
  semanticIntent: string,
  email: Pick<SearchedEmail, "subject" | "from" | "to" | "cc" | "date" | "snippet" | "body">,
): Promise<EmailRelevanceResult> {
  const truncatedBody = email.body.slice(0, MAX_BODY_CHARS);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an AI assistant that evaluates whether an email is relevant to a user's query topic. Be strict and precise. " +
          "Return only valid JSON with this exact schema: " +
          '{"isRelevant": boolean, "relevanceScore": number, "summary": string, "reason": string}. ' +
          "Use semantic meaning, not exact keyword matching. Consider subject, snippet, and body most heavily. " +
          "Primary goal: decide whether email content semantically matches the requested topic. " +
          "Rules: only mark relevant if email semantically matches the topic and intent; weak relation should score 50-69; unrelated should be below 50. " +
          "Set isRelevant true only when relevanceScore >= 70.",
      },
      {
        role: "user",
        content: JSON.stringify({
          userQuery,
          topic,
          semanticIntent,
          email: {
            subject: email.subject,
            from: email.from,
            to: email.to,
            cc: email.cc,
            date: email.date,
            snippet: email.snippet,
            body: truncatedBody,
          },
        }),
      },
    ],
  });

  const modelContent = completion.choices[0]?.message?.content;
  if (!modelContent) {
    throw new Error("Empty AI response");
  }

  const parsed = parseJsonObject(modelContent);
  const relevanceScore = normalizeScore(parsed.relevanceScore);
  const scoredRelevant = relevanceScore >= RELEVANCE_THRESHOLD;

  return {
    isRelevant: scoredRelevant && parsed.isRelevant === true,
    relevanceScore,
    summary: toSafeString(parsed.summary, "No summary generated."),
    reason: toSafeString(
      parsed.reason,
      relevanceScore >= POSSIBLE_MATCH_THRESHOLD
        ? "Possible semantic match."
        : "No semantic match with requested intent.",
    ),
  };
}
