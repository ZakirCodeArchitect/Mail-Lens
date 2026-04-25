import { google } from "googleapis";

import { SearchIntent } from "@/ai/search-intent.service";
import { createOAuthClient } from "@/lib/google";
import { parseGmailMessage } from "@/lib/gmail/parsers";
import { prisma } from "@/lib/prisma";

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
}

const MAX_BROAD_KEYWORDS = 8;
const CANDIDATE_EMAIL_LIMIT = 50;

function sanitizeKeyword(keyword: string): string {
  return keyword.replace(/[()"]/g, " ").trim().replace(/\s+/g, " ");
}

export function buildBroadGmailQuery(
  startDate: string,
  endDate: string,
  intent: Pick<SearchIntent, "keywords" | "fromHints">,
): string {
  const after = startDate.replace(/-/g, "/");
  const before = endDate.replace(/-/g, "/");
  const seen = new Set<string>();
  const broadKeywords: string[] = [];

  for (const keyword of [...intent.fromHints, ...intent.keywords]) {
    const sanitized = sanitizeKeyword(keyword);
    if (!sanitized) {
      continue;
    }

    const key = sanitized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    broadKeywords.push(sanitized);
    if (broadKeywords.length >= MAX_BROAD_KEYWORDS) {
      break;
    }
  }

  const baseQuery = `after:${after} before:${before}`;
  if (broadKeywords.length === 0) {
    return baseQuery;
  }

  return `${baseQuery} (${broadKeywords.join(" OR ")})`;
}

export async function searchEmails(
  userId: string,
  intent: Pick<SearchIntent, "keywords" | "fromHints">,
  startDate: string,
  endDate: string,
): Promise<{ emails: SearchedEmail[]; gmailQueryUsed: string }> {
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
  const searchQuery = buildBroadGmailQuery(startDate, endDate, intent);
  console.log("[gmail/search] gmailQueryUsed:", searchQuery);

  const listResponse = await gmail.users.messages.list({
    userId: "me",
    q: searchQuery,
    maxResults: CANDIDATE_EMAIL_LIMIT,
  });

  const messages = listResponse.data.messages ?? [];

  if (messages.length === 0) {
    return { emails: [], gmailQueryUsed: searchQuery };
  }

  const results = await Promise.all(
    messages.map(async (message) => {
      if (!message.id) {
        return null;
      }

      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id: message.id,
        format: "full",
      });

      const parsed = parseGmailMessage(fullMessage.data);

      return {
        id: fullMessage.data.id ?? message.id,
        threadId: fullMessage.data.threadId ?? "",
        subject: parsed.subject,
        from: parsed.from,
        to: parsed.to,
        cc: parsed.cc,
        date: parsed.date,
        snippet: fullMessage.data.snippet ?? "",
        body: parsed.body,
      };
    }),
  );

  return {
    emails: results.filter((email): email is SearchedEmail => email !== null),
    gmailQueryUsed: searchQuery,
  };
}
