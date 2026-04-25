import { openai } from "@/lib/openai";

export interface SearchIntent {
  sender: string | null;
  includeForwarded: boolean;
  requiresLinks: boolean;
  topic: string | null;
  semanticIntent: string;
}

interface ParsedIntentResponse {
  sender?: unknown;
  includeForwarded?: unknown;
  requiresLinks?: unknown;
  topic?: unknown;
  semanticIntent?: unknown;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function parseModelJson(content: string): ParsedIntentResponse {
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Intent model response was not a JSON object");
  }
  return parsed as ParsedIntentResponse;
}

export async function analyzeSearchIntent(userQuery: string): Promise<SearchIntent> {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Extract Gmail search intent from natural language query. " +
          "Return only valid JSON with this exact schema: " +
          '{"sender": string | null, "includeForwarded": boolean, "requiresLinks": boolean, "topic": string | null, "semanticIntent": string}. ' +
          "sender should capture the person/source name when present (for example, Zia), even when query only contains a partial or short name. " +
          "includeForwarded should be true only when the query asks for forwarded content/sender context, but this does not exclude direct emails from sender. " +
          "requiresLinks should be true only when query asks for links/URLs/resources. " +
          "topic should be a short semantic topic phrase (for example, course). " +
          "semanticIntent should be one concise sentence capturing semantic meaning.",
      },
      {
        role: "user",
        content: JSON.stringify({ userQuery }),
      },
    ],
  });

  const modelContent = completion.choices[0]?.message?.content;
  if (!modelContent) {
    throw new Error("Empty AI response while analyzing search intent");
  }

  const parsed = parseModelJson(modelContent);
  const semanticIntent =
    typeof parsed.semanticIntent === "string" && parsed.semanticIntent.trim().length > 0
      ? parsed.semanticIntent.trim()
      : `Find emails relevant to: ${userQuery.trim()}`;
  const sender = toOptionalString(parsed.sender);
  const includeForwarded = toBoolean(parsed.includeForwarded, false);
  const requiresLinks = toBoolean(parsed.requiresLinks, false);
  const topic = toOptionalString(parsed.topic);

  return {
    sender,
    includeForwarded,
    requiresLinks,
    topic,
    semanticIntent,
  };
}
