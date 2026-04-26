import { google } from "googleapis";

import { SearchIntent } from "@/ai/search-intent.service";
import { createOAuthClient } from "@/lib/google";
import { parseGmailMessage } from "@/lib/gmail/parsers";
import { prisma } from "@/lib/prisma";
import type { QueryType } from "@/services/search-pipeline.service";

export interface SearchedEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  snippet: string;
  body: string;
  attachmentFilenames: string[];
}

const MAX_GMAIL_QUERIES = 6;
/** Gmail allows up to 500; 100 balances recall vs payload for search mode. */
const SEARCH_MODE_MAX_RESULTS_PER_QUERY = 100;
/** After dedupe; keyword queries are listed first so this pool stays on-topic. */
const SEARCH_MODE_MAX_UNIQUE_CANDIDATES = 150;
const COLLECTION_MODE_MAX_RESULTS_PER_PAGE = 100;
const COLLECTION_MODE_MAX_UNIQUE_CANDIDATES = 1000;
const FETCH_DETAILS_BATCH_SIZE = 25;

function sanitizeToken(value: string): string {
  return value.replace(/[()"]/g, " ").trim().replace(/\s+/g, " ");
}

function buildSenderFromClause(sender: string | null): string | null {
  if (!sender) {
    return null;
  }

  const cleaned = sanitizeToken(sender);
  if (!cleaned) {
    return null;
  }

  const terms = new Set<string>();
  terms.add(`from:${cleaned}`);
  terms.add(`from:"${cleaned}"`);

  const firstToken = cleaned.split(" ")[0]?.trim();
  if (firstToken && firstToken.toLowerCase() !== cleaned.toLowerCase()) {
    terms.add(`from:${firstToken}`);
    terms.add(`from:"${firstToken}"`);
  }

  return `(${Array.from(terms).join(" OR ")})`;
}

function buildTopicClause(topic: string | null): string | null {
  if (!topic) {
    return null;
  }

  const cleaned = sanitizeToken(topic);
  if (!cleaned) {
    return null;
  }

  const terms = new Set<string>();
  terms.add(`"${cleaned}"`);

  const parts = cleaned.split(" ").filter((part) => part.length >= 2);
  for (const part of parts) {
    terms.add(part);
  }

  return `(${Array.from(terms).join(" OR ")})`;
}

function deriveKeywords(intent: Pick<SearchIntent, "topic" | "semanticIntent">): string[] {
  const seed = [intent.topic ?? "", intent.semanticIntent]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);

  return Array.from(new Set(seed)).slice(0, 6);
}

function pushUniqueQuery(queries: string[], query: string) {
  const normalized = query.trim();
  if (!normalized) {
    return;
  }
  if (!queries.some((existing) => existing.toLowerCase() === normalized.toLowerCase())) {
    queries.push(normalized);
  }
}

export function buildCandidateGmailQueries(
  startDate: string,
  endDate: string,
  intent: Pick<SearchIntent, "sender" | "topic" | "semanticIntent">,
  queryTypes: QueryType[],
): string[] {
  const after = startDate.replace(/-/g, "/");
  const before = endDate.replace(/-/g, "/");
  const base = `after:${after} before:${before}`;
  const queries: string[] = [];
  const keywords = deriveKeywords(intent);
  const mainKeyword = intent.topic ?? keywords[0] ?? "";
  const sender = intent.sender ? sanitizeToken(intent.sender) : "";
  const senderEmail = sender.includes("@") ? sender : "";

  if (queryTypes.includes("topic") && mainKeyword) {
    pushUniqueQuery(queries, `${base} ${mainKeyword}`);
    pushUniqueQuery(queries, `${base} subject:${mainKeyword}`);
    if (intent.topic && intent.topic.includes(" ")) {
      pushUniqueQuery(queries, `${base} "${intent.topic}"`);
    }
  }

  if (queryTypes.includes("sender") && sender) {
    pushUniqueQuery(queries, `${base} from:${sender}`);
    pushUniqueQuery(queries, `${base} "${sender}"`);
    if (senderEmail) {
      pushUniqueQuery(queries, `${base} from:${senderEmail}`);
    }
  }

  if (queryTypes.includes("forwarded")) {
    if (sender) {
      pushUniqueQuery(queries, `${base} "${sender}"`);
      pushUniqueQuery(queries, `${base} "From: ${sender}"`);
    }
    pushUniqueQuery(queries, `${base} "Forwarded"`);
  }

  if (queryTypes.includes("attachment")) {
    const fileKeyword = mainKeyword || "attachment";
    pushUniqueQuery(queries, `${base} has:attachment ${fileKeyword}`);
    pushUniqueQuery(queries, `${base} filename:pdf ${fileKeyword}`);
    pushUniqueQuery(queries, `${base} filename:doc ${fileKeyword}`);
  }

  if (queryTypes.includes("link")) {
    const linkKeyword = mainKeyword || "link";
    pushUniqueQuery(queries, `${base} http ${linkKeyword}`);
    pushUniqueQuery(queries, `${base} www ${linkKeyword}`);
    pushUniqueQuery(queries, `${base} link ${linkKeyword}`);
  }

  if (queryTypes.includes("intent")) {
    const topKeywords = keywords.slice(0, 3);
    if (topKeywords.length > 0) {
      pushUniqueQuery(queries, `${base} (${topKeywords.join(" OR ")})`);
    }
    if (keywords.length > 3) {
      pushUniqueQuery(queries, `${base} ${keywords.slice(0, 5).join(" ")}`);
    }
  }

  // Date-only query returns arbitrary recent mail and was previously pushed first,
  // consuming the unique-id budget before keyword hits. Add it last as filler only.
  if (queries.length === 0) {
    pushUniqueQuery(queries, base);
  } else if (!(queryTypes.includes("topic") && mainKeyword)) {
    pushUniqueQuery(queries, base);
  }

  return queries.slice(0, MAX_GMAIL_QUERIES);
}

export function buildCollectionGmailQueries(
  startDate: string,
  endDate: string,
  intent: Pick<SearchIntent, "sender" | "topic" | "semanticIntent">,
): string[] {
  const after = startDate.replace(/-/g, "/");
  const before = endDate.replace(/-/g, "/");
  const base = `after:${after} before:${before}`;
  const queries: string[] = [];
  const keywords = deriveKeywords(intent);
  const topic = sanitizeToken(intent.topic ?? "");

  if (topic) {
    pushUniqueQuery(queries, `${base} ${topic}`);
    pushUniqueQuery(queries, `${base} "${topic}"`);
    pushUniqueQuery(queries, `${base} subject:${topic}`);
    pushUniqueQuery(queries, `${base} from:${topic}`);
  }

  for (const keyword of keywords.slice(0, 4)) {
    pushUniqueQuery(queries, `${base} ${keyword}`);
    pushUniqueQuery(queries, `${base} subject:${keyword}`);
    pushUniqueQuery(queries, `${base} from:${keyword}`);
  }

  const sender = sanitizeToken(intent.sender ?? "");
  if (sender) {
    pushUniqueQuery(queries, `${base} from:${sender}`);
    pushUniqueQuery(queries, `${base} "${sender}"`);
  }

  // Same as search mode: avoid filling the 1000-id cap with date-only results before topic queries run.
  if (queries.length === 0) {
    pushUniqueQuery(queries, base);
  } else if (!topic) {
    pushUniqueQuery(queries, base);
  }

  return queries.slice(0, MAX_GMAIL_QUERIES);
}

export function buildStructuredGmailQuery(
  startDate: string,
  endDate: string,
  intent: Pick<SearchIntent, "sender" | "topic">,
): string {
  const after = startDate.replace(/-/g, "/");
  const before = endDate.replace(/-/g, "/");
  const queryParts = [`after:${after}`, `before:${before}`];
  const senderClause = buildSenderFromClause(intent.sender);
  if (senderClause) {
    queryParts.push(senderClause);
  }
  const topicClause = buildTopicClause(intent.topic);
  if (topicClause) {
    queryParts.push(topicClause);
  }

  return queryParts.join(" ");
}

export async function searchEmails(
  userId: string,
  intent: Pick<SearchIntent, "sender" | "topic" | "semanticIntent">,
  startDate: string,
  endDate: string,
  queryTypes: QueryType[],
): Promise<{ emails: SearchedEmail[]; queriesUsed: string[]; candidateCountBeforeDedup: number }> {
  const googleAccount = await prisma.googleAccount.findUnique({
    where: { userId },
    select: { accessToken: true },
  });

  if (!googleAccount?.accessToken) {
    throw new Error("Google account not connected for this user");
  }

  const oauthClient = createOAuthClient();
  oauthClient.setCredentials({ access_token: googleAccount.accessToken });

  const gmail = google.gmail({ version: "v1", auth: oauthClient });
  const queriesUsed = buildCandidateGmailQueries(startDate, endDate, intent, queryTypes);
  const messageIds: string[] = [];

  for (const query of queriesUsed) {
    console.log("[gmail/search] gmailQueryUsed:", query);
    const listResponse = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: SEARCH_MODE_MAX_RESULTS_PER_QUERY,
    });
    const messages = listResponse.data.messages ?? [];
    for (const message of messages) {
      if (message.id) {
        messageIds.push(message.id);
      }
    }
  }

  const candidateCountBeforeDedup = messageIds.length;
  const uniqueIds = Array.from(new Set(messageIds)).slice(0, SEARCH_MODE_MAX_UNIQUE_CANDIDATES);
  if (uniqueIds.length === 0) {
    return { emails: [], queriesUsed, candidateCountBeforeDedup };
  }

  const results = await Promise.all(
    uniqueIds.map(async (messageId) => {
      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
      });

      const parsed = parseGmailMessage(fullMessage.data);
      return {
        id: fullMessage.data.id ?? messageId,
        threadId: fullMessage.data.threadId ?? "",
        subject: parsed.subject,
        from: parsed.from,
        to: parsed.to,
        cc: parsed.cc,
        date: parsed.date,
        snippet: fullMessage.data.snippet ?? "",
        body: parsed.body,
        attachmentFilenames: parsed.attachmentFilenames,
      };
    }),
  );

  return { emails: results, queriesUsed, candidateCountBeforeDedup };
}

interface CollectionSearchResult {
  emails: SearchedEmail[];
  queriesUsed: string[];
  totalFetched: number;
  uniqueCandidateCount: number;
}

async function listMessageIdsForQuery(
  gmail: ReturnType<typeof google.gmail>,
  query: string,
  maxUniqueLimit: number,
  seenMessageIds: Set<string>,
): Promise<{ fetchedCount: number }> {
  let pageToken: string | undefined;
  let fetchedCount = 0;

  do {
    const listResponse = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: COLLECTION_MODE_MAX_RESULTS_PER_PAGE,
      pageToken,
    });

    const messages = listResponse.data.messages ?? [];
    fetchedCount += messages.length;

    for (const message of messages) {
      if (!message.id) {
        continue;
      }
      seenMessageIds.add(message.id);
      if (seenMessageIds.size >= maxUniqueLimit) {
        return { fetchedCount };
      }
    }

    pageToken = listResponse.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { fetchedCount };
}

async function fetchEmailDetailsInBatches(
  gmail: ReturnType<typeof google.gmail>,
  messageIds: string[],
): Promise<SearchedEmail[]> {
  const results: SearchedEmail[] = [];

  for (let index = 0; index < messageIds.length; index += FETCH_DETAILS_BATCH_SIZE) {
    const batch = messageIds.slice(index, index + FETCH_DETAILS_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (messageId) => {
        const fullMessage = await gmail.users.messages.get({
          userId: "me",
          id: messageId,
          format: "full",
        });

        const parsed = parseGmailMessage(fullMessage.data);
        return {
          id: fullMessage.data.id ?? messageId,
          threadId: fullMessage.data.threadId ?? "",
          subject: parsed.subject,
          from: parsed.from,
          to: parsed.to,
          cc: parsed.cc,
          date: parsed.date,
          snippet: fullMessage.data.snippet ?? "",
          body: parsed.body,
          attachmentFilenames: parsed.attachmentFilenames,
        };
      }),
    );
    results.push(...batchResults);
  }

  return results;
}

export async function searchEmailsCollectionMode(
  userId: string,
  intent: Pick<SearchIntent, "sender" | "topic" | "semanticIntent">,
  startDate: string,
  endDate: string,
): Promise<CollectionSearchResult> {
  const googleAccount = await prisma.googleAccount.findUnique({
    where: { userId },
    select: { accessToken: true },
  });

  if (!googleAccount?.accessToken) {
    throw new Error("Google account not connected for this user");
  }

  const oauthClient = createOAuthClient();
  oauthClient.setCredentials({ access_token: googleAccount.accessToken });
  const gmail = google.gmail({ version: "v1", auth: oauthClient });

  const queriesUsed = buildCollectionGmailQueries(startDate, endDate, intent);
  const seenMessageIds = new Set<string>();
  let totalFetched = 0;

  for (const query of queriesUsed) {
    if (seenMessageIds.size >= COLLECTION_MODE_MAX_UNIQUE_CANDIDATES) {
      break;
    }
    const queryResult = await listMessageIdsForQuery(
      gmail,
      query,
      COLLECTION_MODE_MAX_UNIQUE_CANDIDATES,
      seenMessageIds,
    );
    totalFetched += queryResult.fetchedCount;
  }

  const uniqueIds = Array.from(seenMessageIds).slice(0, COLLECTION_MODE_MAX_UNIQUE_CANDIDATES);
  if (uniqueIds.length === 0) {
    return {
      emails: [],
      queriesUsed,
      totalFetched,
      uniqueCandidateCount: 0,
    };
  }

  const emails = await fetchEmailDetailsInBatches(gmail, uniqueIds);
  return {
    emails,
    queriesUsed,
    totalFetched,
    uniqueCandidateCount: emails.length,
  };
}
