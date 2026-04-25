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

const CANDIDATE_EMAIL_LIMIT = 50;

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

export function buildStructuredGmailQuery(
  startDate: string,
  endDate: string,
  intent: Pick<SearchIntent, "sender">,
): string {
  const after = startDate.replace(/-/g, "/");
  const before = endDate.replace(/-/g, "/");
  const queryParts = [`after:${after}`, `before:${before}`];
  const senderClause = buildSenderFromClause(intent.sender);
  if (senderClause) {
    queryParts.push(senderClause);
  }

  return queryParts.join(" ");
}

export async function searchEmails(
  userId: string,
  intent: Pick<SearchIntent, "sender">,
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
  const searchQuery = buildStructuredGmailQuery(startDate, endDate, intent);
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
