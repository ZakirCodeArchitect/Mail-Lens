import { openai } from "@/lib/openai";

export interface SearchIntent {
  people: string[];
  organizations: string[];
  topics: string[];
  keywords: string[];
  fromHints: string[];
  semanticIntent: string;
}

interface ParsedIntentResponse {
  people?: unknown;
  organizations?: unknown;
  topics?: unknown;
  keywords?: unknown;
  fromHints?: unknown;
  semanticIntent?: unknown;
}

function toUniqueStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const cleaned = item.trim();
    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(cleaned);
  }

  return normalized;
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
          '{"people": string[], "organizations": string[], "topics": string[], "keywords": string[], "fromHints": string[], "semanticIntent": string}. ' +
          "keywords should be broad retrieval hints with useful variants/synonyms, lowercase where natural, and include at least 5 when possible. " +
          "fromHints should include sender/source names if user asks sent by, from, authored by, or forwarded from. " +
          "semanticIntent should be one concise sentence capturing meaning.",
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

  const people = toUniqueStringArray(parsed.people);
  const organizations = toUniqueStringArray(parsed.organizations);
  const topics = toUniqueStringArray(parsed.topics);
  const keywords = toUniqueStringArray(parsed.keywords);
  const fromHints = toUniqueStringArray(parsed.fromHints);

  if (keywords.length === 0) {
    keywords.push(...toUniqueStringArray(userQuery.split(/\s+/)));
  }

  return {
    people,
    organizations,
    topics,
    keywords,
    fromHints,
    semanticIntent,
  };
}
