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
  email: Pick<SearchedEmail, "subject" | "from" | "date" | "snippet" | "body">,
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
          "You evaluate whether an email is relevant to a user's intent. Return only valid JSON with this exact schema: " +
          '{"isRelevant": boolean, "relevanceScore": number, "summary": string, "reason": string}. ' +
          "Use semantic meaning, not exact keyword matching. Consider subject, snippet, and body together. " +
          "Set isRelevant to true only when relevanceScore is 70 or above.",
      },
      {
        role: "user",
        content: JSON.stringify({
          userQuery,
          email: {
            subject: email.subject,
            from: email.from,
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
    reason: toSafeString(parsed.reason, "No reason generated."),
  };
}
