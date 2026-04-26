import type { gmail_v1 } from "googleapis";

export interface ParsedGmailMessageFields {
  subject: string;
  from: string;
  to: string;
  date: string;
  bodyText: string;
  attachmentFilenames: string[];
}

function decodeBase64Url(value?: string): string {
  if (!value) {
    return "";
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(paddingLength);
  return Buffer.from(padded, "base64").toString("utf-8");
}

function getHeaderValue(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  if (!headers) {
    return "";
  }
  return headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function collectParts(part: gmail_v1.Schema$MessagePart | undefined, mimeType: string): gmail_v1.Schema$MessagePart[] {
  if (!part) {
    return [];
  }
  const result: gmail_v1.Schema$MessagePart[] = [];
  const stack: gmail_v1.Schema$MessagePart[] = [part];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (current.mimeType === mimeType && current.body?.data) {
      result.push(current);
    }
    if (current.parts?.length) {
      stack.push(...current.parts);
    }
  }
  return result;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) {
    return "";
  }
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  const plainParts = collectParts(payload, "text/plain");
  if (plainParts.length > 0) {
    return decodeBase64Url(plainParts[0]?.body?.data);
  }
  const htmlParts = collectParts(payload, "text/html");
  if (htmlParts.length > 0) {
    return htmlToText(decodeBase64Url(htmlParts[0]?.body?.data));
  }
  return payload.body?.data ? decodeBase64Url(payload.body.data) : "";
}

function extractAttachmentFilenames(payload: gmail_v1.Schema$MessagePart | undefined): string[] {
  if (!payload) {
    return [];
  }
  const output: string[] = [];
  const seen = new Set<string>();
  const stack: gmail_v1.Schema$MessagePart[] = [payload];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const filename = current.filename?.trim();
    if (filename) {
      const key = filename.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        output.push(filename);
      }
    }
    if (current.parts?.length) {
      stack.push(...current.parts);
    }
  }
  return output;
}

export function parseGmailMessage(message: gmail_v1.Schema$Message): ParsedGmailMessageFields {
  const payload = message.payload;
  const headers = payload?.headers;
  return {
    subject: getHeaderValue(headers, "subject"),
    from: getHeaderValue(headers, "from"),
    to: getHeaderValue(headers, "to"),
    date: getHeaderValue(headers, "date"),
    bodyText: extractBodyText(payload),
    attachmentFilenames: extractAttachmentFilenames(payload),
  };
}
