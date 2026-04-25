import type { gmail_v1 } from "googleapis";

interface ParsedEmail {
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  body: string;
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

  const match = headers.find((header) => header.name?.toLowerCase() === name.toLowerCase());
  return match?.value ?? "";
}

function collectPartsByMimeType(
  part: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string,
): gmail_v1.Schema$MessagePart[] {
  if (!part) {
    return [];
  }

  const matchedParts: gmail_v1.Schema$MessagePart[] = [];
  const stack: gmail_v1.Schema$MessagePart[] = [part];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (current.mimeType === mimeType && current.body?.data) {
      matchedParts.push(current);
    }

    if (current.parts && current.parts.length > 0) {
      stack.push(...current.parts);
    }
  }

  return matchedParts;
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) {
    return "";
  }

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  const plainParts = collectPartsByMimeType(payload, "text/plain");
  if (plainParts.length > 0) {
    return decodeBase64Url(plainParts[0]?.body?.data);
  }

  const htmlParts = collectPartsByMimeType(payload, "text/html");
  if (htmlParts.length > 0) {
    const html = decodeBase64Url(htmlParts[0]?.body?.data);
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  return payload.body?.data ? decodeBase64Url(payload.body.data) : "";
}

function extractAttachmentFilenames(payload: gmail_v1.Schema$MessagePart | undefined): string[] {
  if (!payload) {
    return [];
  }

  const filenames: string[] = [];
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
        filenames.push(filename);
      }
    }

    if (current.parts && current.parts.length > 0) {
      stack.push(...current.parts);
    }
  }

  return filenames;
}

export function parseGmailMessage(message: gmail_v1.Schema$Message): ParsedEmail {
  const payload = message.payload;
  const headers = payload?.headers;

  return {
    subject: getHeaderValue(headers, "subject"),
    from: getHeaderValue(headers, "from"),
    to: getHeaderValue(headers, "to"),
    cc: getHeaderValue(headers, "cc"),
    date: getHeaderValue(headers, "date"),
    body: extractBody(payload),
    attachmentFilenames: extractAttachmentFilenames(payload),
  };
}
