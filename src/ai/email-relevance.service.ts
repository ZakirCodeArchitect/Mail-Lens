import { openai } from "@/lib/openai";
import type { SearchedEmail } from "@/services/gmail.service";

interface EmailRelevanceResult {
  /** True when model JSON explicitly sets isRelevant: true (independent of score bands). */
  modelDeclaresRelevant: boolean;
  /** High confidence: strong score and model agrees. */
  isRelevant: boolean;
  aiScore: number;
  summary: string;
  reason: string;
}

interface ParsedModelResponse {
  isRelevant?: unknown;
  aiScore?: unknown;
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
  ruleScore: number,
  matchedSignals: string[],
  email: Pick<
    SearchedEmail,
    "subject" | "from" | "to" | "cc" | "date" | "snippet" | "body" | "attachmentFilenames"
  >,
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
          "You are an AI assistant that ranks semantic relevance for an email candidate. " +
          "Return only valid JSON with this exact schema: " +
          '{"aiScore": number, "isRelevant": boolean, "summary": string, "reason": string}. ' +
          "Use semantic meaning. Consider subject, snippet, body, sender, and attachments. " +
          "ruleScore and matchedSignals are retrieval hints only; they can be wrong (substring noise). " +
          "When the user asks about a specific organization, school, or acronym (e.g. QAU), set isRelevant to false for banking/security alerts, generic SaaS newsletters, unrelated vendor mail, and bulk notifications unless the message clearly discusses that organization. " +
          "Mere co-occurrence of generic product words is not relevance. " +
          "Use aiScore 0-100, where >=70 strong, 50-69 possible.",
      },
      {
        role: "user",
        content: JSON.stringify({
          userQuery,
          topic,
          semanticIntent,
          ruleScore,
          matchedSignals,
          email: {
            subject: email.subject,
            from: email.from,
            to: email.to,
            cc: email.cc,
            date: email.date,
            snippet: email.snippet,
            body: truncatedBody,
            attachmentFilenames: email.attachmentFilenames,
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
  const aiScore = normalizeScore(
    typeof parsed.aiScore === "number" ? parsed.aiScore : parsed.relevanceScore,
  );
  const scoredRelevant = aiScore >= RELEVANCE_THRESHOLD;
  const modelDeclaresRelevant = parsed.isRelevant === true;

  return {
    modelDeclaresRelevant,
    isRelevant: scoredRelevant && modelDeclaresRelevant,
    aiScore,
    summary: toSafeString(parsed.summary, "No summary generated."),
    reason: toSafeString(
      parsed.reason,
      aiScore >= POSSIBLE_MATCH_THRESHOLD
        ? "Possible semantic match."
        : "No semantic match with requested intent.",
    ),
  };
}
