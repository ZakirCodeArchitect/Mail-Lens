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
          "You are filtering emails for a university/college journal article.\n" +
          "The user only wants emails useful as evidence for student or college achievements, awards, projects, seminars, webinars, talks, discussions, conferences, participation, recognition, or success stories.\n" +
          "Return JSON only in this schema:\n" +
          '{"isRelevant": true, "aiScore": 0, "label": "Highly Relevant | Relevant | Possible Match | Irrelevant", "summary": "short summary", "reason": "why relevant or not"}\n' +
          "Rules: be precise, reject routine admin emails/login notifications/generic reminders/unrelated promotions, include newsletter entries only if at least one relevant highlight is present, do not hallucinate.\n" +
          "If the user intent asks for course/training/resource links from a specific person, treat substantive learning URLs (e.g. official course or learning-journey links) from that sender as relevant unless the message is clearly unrelated or pure account/security spam.\n" +
          "Always set isRelevant to false for automated vendor mail (e.g. no-reply, notification@, onboarding/welcome-to-platform, activate/verify account, password reset) even if it mentions a product name or contains a generic learning portal link, unless the message is clearly substantive course content shared in context.",
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
  return {
    isRelevant: parsed.isRelevant === true,
    aiScore: parseScore(parsed.aiScore),
    label: parseLabel(parsed.label),
    summary: parseString(parsed.summary, "No summary generated."),
    reason: parseString(parsed.reason, "No reason provided."),
  };
}
