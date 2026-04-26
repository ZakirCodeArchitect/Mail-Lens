const DEFAULT_JOURNAL_KEYWORDS = [
  "achievement",
  "achievements",
  "achieved",
  "award",
  "awards",
  "won",
  "winner",
  "selected",
  "selection",
  "scored",
  "secured",
  "position",
  "rank",
  "recognition",
  "recognized",
  "project",
  "projects",
  "research",
  "collaboration",
  "funded",
  "grant",
  "seminar",
  "webinar",
  "conference",
  "workshop",
  "talk",
  "discussion",
  "panel",
  "session",
  "participation",
  "participated",
  "event",
  "student",
  "students",
  "college",
  "department",
  "success",
  "milestone",
] as const;

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function dedupe(items: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function getDefaultJournalKeywords(): string[] {
  return [...DEFAULT_JOURNAL_KEYWORDS];
}

export function extractIntentTerms(intent: string): string[] {
  return dedupe(tokenize(intent));
}

/** Add common singular/plural variants so "courses" in intent still matches "Course" in subjects. */
function expandMatchVariants(terms: string[]): string[] {
  const extras: string[] = [];
  for (const term of terms) {
    const lower = term.toLowerCase();
    if (lower === "courses") {
      extras.push("course");
    }
    if (lower === "course") {
      extras.push("courses");
    }
    if (lower === "links") {
      extras.push("link");
    }
    if (lower === "link") {
      extras.push("links");
    }
    if (lower === "forwards") {
      extras.push("forward");
    }
    if (lower === "forward") {
      extras.push("forwarded");
    }
  }
  return dedupe([...terms, ...extras]);
}

export function buildJournalKeywordSet(intent: string): string[] {
  return expandMatchVariants(dedupe([...DEFAULT_JOURNAL_KEYWORDS, ...extractIntentTerms(intent)]));
}

export function buildJournalKeywordGroups(intentKeywords: string[]): {
  achievementKeywords: string[];
  projectKeywords: string[];
  eventKeywords: string[];
} {
  const normalized = intentKeywords.map((item) => item.toLowerCase());
  return {
    achievementKeywords: normalized.filter((keyword) =>
      ["achievement", "award", "winner", "recognition", "success", "rank", "selected"].some((seed) =>
        keyword.includes(seed),
      ),
    ),
    projectKeywords: normalized.filter((keyword) =>
      ["project", "research", "collaboration", "grant", "funded"].some((seed) => keyword.includes(seed)),
    ),
    eventKeywords: normalized.filter((keyword) =>
      ["seminar", "webinar", "talk", "discussion", "conference", "workshop", "panel", "session"].some((seed) =>
        keyword.includes(seed),
      ),
    ),
  };
}
