import { google } from "googleapis";

import { createOAuthClient } from "@/lib/google";
import { parseGmailMessage } from "@/lib/gmail/parsers";
import { prisma } from "@/lib/prisma";

export interface SearchedEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body: string;
}

function buildGmailSearchQuery(query: string, startDate: string, endDate: string): string {
  const after = startDate.replace(/-/g, "/");
  const before = endDate.replace(/-/g, "/");
  const normalizedQuery = query.replace(/\s+or\s+/gi, " OR ").trim();
  return `after:${after} before:${before} ${normalizedQuery}`.trim();
}

export async function searchEmails(
  userId: string,
  query: string,
  startDate: string,
  endDate: string,
): Promise<SearchedEmail[]> {
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
  const searchQuery = buildGmailSearchQuery(query, startDate, endDate);

  const listResponse = await gmail.users.messages.list({
    userId: "me",
    q: searchQuery,
    maxResults: 20,
  });

  const messages = listResponse.data.messages ?? [];

  if (messages.length === 0) {
    return [];
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
        date: parsed.date,
        snippet: fullMessage.data.snippet ?? "",
        body: parsed.body,
      };
    }),
  );

  return results.filter((email): email is SearchedEmail => email !== null);
}
