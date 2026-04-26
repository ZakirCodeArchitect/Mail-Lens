import { SearchIntent } from "@/ai/search-intent.service";
import type { SearchedEmail } from "@/services/gmail.service";

export type QueryType = "topic" | "sender" | "forwarded" | "attachment" | "link" | "intent";
export type SearchMode = "search" | "collection";

interface SearchModeDetection {
  mode: SearchMode;
  reason: string;
}

interface CandidateScore {
  ruleScore: number;
  matchedSignals: string[];
}

const STOPWORDS = new Set([
  "emails",
  "email",
  "related",
  "about",
  "with",
  "where",
  "that",
  "from",
  "sent",
  "forwarded",
  "links",
  "link",
  "the",
  "and",
  "for",
  "or",
  "to",
  "by",
  "in",
  "of",
  "on",
  "a",
  "an",
  "find",
  "all",
  "every",
  "each",
  "list",
  "complete",
  "fetch",
  "retrieve",
  "collect",
  "export",
  "download",
]);

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Lowercase text with punctuation collapsed to spaces so short acronyms
 * are matched as whole tokens (avoids "qau" matching inside unrelated IDs/URLs).
 */
export function normalizeForTopicMatch(value: string): string {
  return collapseWhitespace(normalizeText(value).replace(/[^a-z0-9]+/g, " "));
}

function requiresWordBoundary(term: string): boolean {
  const trimmed = term.trim().toLowerCase();
  if (trimmed.length === 0) {
    return true;
  }
  if (/\s/.test(trimmed)) {
    return false;
  }
  return trimmed.length <= 5;
}

/**
 * True if `term` appears in `haystack` as a real token/phrase match.
 * Short tokens (<=5 chars, no spaces) use word boundaries; longer tokens use substring on normalized haystack.
 */
export function topicTermMatches(haystackRaw: string, termRaw: string): boolean {
  const term = termRaw.trim().toLowerCase();
  if (term.length < 2) {
    return false;
  }

  if (/\s/.test(term)) {
    const parts = collapseWhitespace(term)
      .split(/\s+/)
      .map((part) => escapeRegExp(part))
      .filter(Boolean);
    if (parts.length === 0) {
      return false;
    }
    const pattern = parts.join("[\\s\\-]*");
    return new RegExp(pattern, "i").test(normalizeText(haystackRaw));
  }

  const haystack = normalizeForTopicMatch(haystackRaw);
  const needle = normalizeForTopicMatch(term);
  if (!requiresWordBoundary(term)) {
    return haystack.includes(needle);
  }

  const bounded = new RegExp(`(^|\\s)${escapeRegExp(needle)}(\\s|$)`, "i");
  return bounded.test(` ${haystack} `);
}

export function hasHighPrecisionTopicHit(
  email: Pick<SearchedEmail, "subject" | "snippet" | "from" | "attachmentFilenames">,
  terms: string[],
): boolean {
  const fields = [
    email.subject,
    email.snippet,
    email.from,
    email.attachmentFilenames.join(" "),
  ];
  return terms.some((term) => fields.some((field) => topicTermMatches(field, term)));
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

export function extractDeterministicMatchTerms(userQuery: string, intent: SearchIntent): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const term of collectTopicTerms(userQuery, intent)) {
    uniquePush(terms, seen, term);
  }

  if (intent.sender) {
    uniquePush(terms, seen, intent.sender);
    for (const token of tokenize(intent.sender)) {
      uniquePush(terms, seen, token);
    }
  }

  for (const token of tokenize(userQuery)) {
    uniquePush(terms, seen, token);
  }

  return terms.filter((term) => term.length >= 2);
}

export function detectSearchMode(userQuery: string): SearchModeDetection {
  const normalized = normalizeText(userQuery);

  const collectionSignals: Array<{ regex: RegExp; reason: string }> = [
    { regex: /\b(all emails|all matching emails|all related emails)\b/i, reason: "Query asks for all emails." },
    { regex: /\b(every email|each email|complete list)\b/i, reason: "Query requests a complete email list." },
    { regex: /\b(fetch all|collect all|retrieve all)\b/i, reason: "Query asks to fetch all matching emails." },
    { regex: /\b(export|download)\b/i, reason: "Query implies bulk export or collection." },
    {
      regex: /\b(year[-\s]?wide|whole year|entire year|throughout \d{4}|in \d{4})\b/i,
      reason: "Query suggests year-wide collection.",
    },
  ];

  for (const signal of collectionSignals) {
    if (signal.regex.test(normalized)) {
      return { mode: "collection", reason: signal.reason };
    }
  }

  return { mode: "search", reason: "Default semantic search mode for ranked top matches." };
}

function includesAnyToken(text: string, tokens: string[]): boolean {
  return tokens.some((token) => topicTermMatches(text, token));
}

function uniquePush(items: string[], seen: Set<string>, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }
  const key = trimmed.toLowerCase();
  if (!seen.has(key)) {
    seen.add(key);
    items.push(trimmed);
  }
}

function normalizeDateToMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function collectTopicTerms(userQuery: string, intent: SearchIntent): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  if (intent.topic) {
    uniquePush(terms, seen, intent.topic);
  }

  for (const token of tokenize(intent.semanticIntent)) {
    uniquePush(terms, seen, token);
    if (terms.length >= 6) {
      break;
    }
  }

  for (const token of tokenize(userQuery)) {
    uniquePush(terms, seen, token);
    if (terms.length >= 8) {
      break;
    }
  }

  return terms;
}

export function detectQueryType(userQuery: string, intent: SearchIntent): QueryType[] {
  const query = normalizeText(userQuery);
  const types: QueryType[] = [];

  if (intent.topic || /\b(related to|about|topic|regarding)\b/i.test(query)) {
    types.push("topic");
  }

  if (intent.sender || /\b(from|sent by|by|sender|authored by)\b/i.test(query)) {
    types.push("sender");
  }

  if (intent.includeForwarded || /\bforward(ed|ing)?\b/i.test(query)) {
    types.push("forwarded");
  }

  if (/\b(attachment|attached|cv|resume|transcript|pdf|doc|docx)\b/i.test(query)) {
    types.push("attachment");
  }

  if (intent.requiresLinks || /\b(link|links|url|urls|http|www|website)\b/i.test(query)) {
    types.push("link");
  }

  if (types.length === 0 || /\b(complain|issue|problem|delay|intent|why|follow up)\b/i.test(query)) {
    types.push("intent");
  }

  return Array.from(new Set(types));
}

export function scoreEmailCandidate(
  email: SearchedEmail,
  intent: SearchIntent,
  queryTypes: QueryType[],
  userQuery: string,
): CandidateScore {
  const matchedSignals: string[] = [];
  const seenSignals = new Set<string>();
  let score = 0;

  const topicTerms = collectTopicTerms(userQuery, intent);
  const senderTerms = intent.sender ? tokenize(intent.sender) : [];
  const textSubject = normalizeText(email.subject);
  const textSnippet = normalizeText(email.snippet);
  const textBody = normalizeText(email.body);
  const attachmentText = normalizeText(email.attachmentFilenames.join(" "));

  const hasTopicInSubject = includesAnyToken(textSubject, topicTerms);
  const hasTopicInSnippet = includesAnyToken(textSnippet, topicTerms);
  const hasTopicInBody = includesAnyToken(textBody, topicTerms);
  const hasTopicInAttachment = includesAnyToken(attachmentText, topicTerms);

  if (hasTopicInSubject) {
    score += 40;
    uniquePush(matchedSignals, seenSignals, "subject-topic-match");
  }
  if (hasTopicInSnippet) {
    score += 30;
    uniquePush(matchedSignals, seenSignals, "snippet-topic-match");
  }
  if (hasTopicInBody) {
    score += 30;
    uniquePush(matchedSignals, seenSignals, "body-topic-match");
  }

  if (queryTypes.includes("sender") && senderTerms.length > 0 && includesAnyToken(email.from, senderTerms)) {
    score += 25;
    uniquePush(matchedSignals, seenSignals, "from-sender-match");
  }

  if (
    queryTypes.includes("forwarded") &&
    senderTerms.length > 0 &&
    (includesAnyToken(email.snippet, senderTerms) || includesAnyToken(email.body, senderTerms))
  ) {
    score += 25;
    uniquePush(matchedSignals, seenSignals, "forwarded-sender-match");
  }

  if (intent.requiresLinks && /(http|www)/i.test(`${email.snippet} ${email.body}`)) {
    score += 20;
    uniquePush(matchedSignals, seenSignals, "contains-link");
  }

  if (queryTypes.includes("attachment") && hasTopicInAttachment) {
    score += 20;
    uniquePush(matchedSignals, seenSignals, "attachment-keyword-match");
  }

  if (queryTypes.includes("topic") && hasTopicInSubject) {
    score += 15;
    uniquePush(matchedSignals, seenSignals, "subject-topic-keyword");
  }

  if (queryTypes.includes("topic") && hasTopicInBody) {
    score += 10;
    uniquePush(matchedSignals, seenSignals, "body-topic-keyword");
  }

  const ruleScore = Math.max(0, Math.min(100, Math.round(score)));
  return { ruleScore, matchedSignals };
}

export function hasExactTopicMatch(
  email: SearchedEmail,
  intent: SearchIntent,
  userQuery: string,
): boolean {
  const exactTerms = collectTopicTerms(userQuery, intent).filter((term) => term.length >= 3);
  if (exactTerms.length === 0) {
    return false;
  }

  const corpus = [email.subject, email.snippet, email.body, email.attachmentFilenames.join(" ")]
    .filter(Boolean)
    .join("\n");

  return exactTerms.some((term) => topicTermMatches(corpus, term));
}

export function sortByRuleScoreAndDate(
  items: Array<{ email: SearchedEmail; ruleScore: number }>,
): Array<{ email: SearchedEmail; ruleScore: number }> {
  return [...items].sort((a, b) => {
    if (b.ruleScore !== a.ruleScore) {
      return b.ruleScore - a.ruleScore;
    }
    return normalizeDateToMs(b.email.date) - normalizeDateToMs(a.email.date);
  });
}
