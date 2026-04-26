import { google } from "googleapis";

import { parseGmailMessage } from "@/lib/journal/gmail-message-parser";

export interface ParsedJournalEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  bodyText: string;
  attachmentFilenames: string[];
  gmailUrl: string;
}

const MAX_RESULTS_PER_PAGE = 100;

function buildGmailUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}`;
}

export async function searchGmailMessages(
  gmail: ReturnType<typeof google.gmail>,
  query: string,
  maxMessages: number,
): Promise<{ messageIds: string[]; fetchedCount: number }> {
  const ids: string[] = [];
  let fetchedCount = 0;
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: Math.min(MAX_RESULTS_PER_PAGE, maxMessages - ids.length),
      pageToken,
    });
    const messages = response.data.messages ?? [];
    fetchedCount += messages.length;
    for (const message of messages) {
      if (message.id) {
        ids.push(message.id);
      }
      if (ids.length >= maxMessages) {
        break;
      }
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken && ids.length < maxMessages);

  return { messageIds: ids, fetchedCount };
}

export async function fetchGmailMessageDetails(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
): Promise<ParsedJournalEmail | null> {
  try {
    const message = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const parsed = parseGmailMessage(message.data);
    const threadId = message.data.threadId ?? "";
    return {
      id: message.data.id ?? messageId,
      threadId,
      subject: parsed.subject,
      from: parsed.from,
      to: parsed.to,
      date: parsed.date,
      snippet: message.data.snippet ?? "",
      bodyText: parsed.bodyText,
      attachmentFilenames: parsed.attachmentFilenames,
      gmailUrl: threadId ? buildGmailUrl(threadId) : "",
    };
  } catch (error) {
    console.error("[journal/fetch] Failed to parse message", {
      messageId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}
