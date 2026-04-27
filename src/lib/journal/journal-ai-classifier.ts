import { openai } from "@/lib/openai";
import type { ParsedJournalEmail } from "@/services/journal-gmail.service";

interface JournalModelOutput {
  isRelevant?: unknown;
  aiScore?: unknown;
  label?: unknown;
  summary?: unknown;
  reason?: unknown;
}

export interface JournalAiClassification {
  isRelevant: boolean;
  aiScore: number;
  label: "Highly Relevant" | "Relevant" | "Possible Match" | "Irrelevant";
  summary: string;
  reason: string;
}

const MAX_BODY_CHARS = 6000;

function parseScore(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseLabel(value: unknown): JournalAiClassification["label"] {
  if (value === "Highly Relevant" || value === "Relevant" || value === "Possible Match" || value === "Irrelevant") {
    return value;
  }
  return "Irrelevant";
}

function labelToScore(label: JournalAiClassification["label"]): number {
  if (label === "Highly Relevant") {
    return 90;
  }
  if (label === "Relevant") {
    return 75;
  }
  if (label === "Possible Match") {
    return 55;
  }
  return 20;
}

function parseString(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

export async function classifyJournalRelevance(
  email: ParsedJournalEmail,
  intent: string,
  matchedSignals: string[],
  ruleScore: number,
): Promise<JournalAiClassification> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are filtering emails using ONLY the user's intent.\n" +
          "Primary rule: decide relevance based on whether the email content semantically matches or answers the provided intent text.\n" +
          "Do not apply any fixed domain assumptions (no hardcoded preference for achievements, jobs, courses, etc.).\n" +
          "Do not auto-reject purely because of sender style (e.g. no-reply/notification); evaluate actual content against intent.\n" +
          "Reject emails only when content is clearly unrelated to the intent (for example generic promotions, account-security notices, password reset/verification) and the intent does not ask for those.\n" +
          "If intent and content align even with different wording/paraphrases, mark relevant.\n" +
          "Return JSON only in this exact schema:\n" +
          '{"isRelevant": true, "aiScore": 0, "label": "Highly Relevant | Relevant | Possible Match | Irrelevant", "summary": "short summary", "reason": "why relevant or not"}\n' +
          "Be strict about truthfulness and do not hallucinate details.",
      },
      {
        role: "user",
        content: JSON.stringify({
          intent,
          email: {
            subject: email.subject,
            from: email.from,
            date: email.date,
            snippet: email.snippet,
            bodyText: email.bodyText.slice(0, MAX_BODY_CHARS),
            attachmentFilenames: email.attachmentFilenames,
          },
          ruleScore,
          matchedSignals,
        }),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Empty AI classification response");
  }

  const parsed = JSON.parse(content) as JournalModelOutput;
  const label = parseLabel(parsed.label);
  const rawScore = parseScore(parsed.aiScore);
  const aiScore = rawScore > 0 ? rawScore : labelToScore(label);
  return {
    isRelevant: parsed.isRelevant === true,
    aiScore,
    label,
    summary: parseString(parsed.summary, "No summary generated."),
    reason: parseString(parsed.reason, "No reason provided."),
  };
}
