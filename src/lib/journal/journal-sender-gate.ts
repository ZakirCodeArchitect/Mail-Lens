import type { NormalizedJournalInputs } from "@/lib/journal/input-normalizer";
import type { ParsedJournalEmail } from "@/services/journal-gmail.service";

/** True when the user configured at least one sender filter (email or name). */
export function hasListedSenders(normalized: NormalizedJournalInputs): boolean {
  return normalized.senderEmails.length > 0 || normalized.senderNames.length > 0;
}

function normalizeAddr(value: string): string {
  return value.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract likely mailbox addresses from a Gmail From header. */
export function extractEmailsFromFromHeader(from: string): string[] {
  const out: string[] = [];
  const angle = from.matchAll(/<([^>]+)>/gi);
  for (const match of angle) {
    const inner = match[1]?.trim();
    if (inner && inner.includes("@")) {
      out.push(normalizeAddr(inner));
    }
  }
  if (out.length === 0) {
    const bare = from.match(/\b[^\s<>]+@[^\s<>]+\b/i);
    if (bare) {
      out.push(normalizeAddr(bare[0]));
    }
  }
  return [...new Set(out)];
}

/**
 * Message is from one of the listed senders (strict address match, or name substring if names were listed).
 */
export function fromMatchesListedSenders(from: string, normalized: NormalizedJournalInputs): boolean {
  const wantEmails = normalized.senderEmails.map(normalizeAddr);
  const wantNames = normalized.senderNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (wantEmails.length === 0 && wantNames.length === 0) {
    return true;
  }

  const extracted = extractEmailsFromFromHeader(from);
  if (wantEmails.some((wanted) => extracted.includes(wanted))) {
    return true;
  }
  const fromLower = from.toLowerCase();
  if (wantNames.some((name) => fromLower.includes(name))) {
    return true;
  }
  return false;
}

function containsExactEmail(haystack: string, email: string): boolean {
  const bounded = new RegExp(`(^|[^a-z0-9._%+-])${escapeRegExp(email)}([^a-z0-9._%+-]|$)`, "i");
  return bounded.test(haystack);
}

/**
 * True when listed sender email/name appears anywhere meaningful in message context
 * (from/to/subject/snippet/body), not just in the From header.
 */
export function emailMatchesListedSenders(
  email: Pick<ParsedJournalEmail, "from" | "to" | "subject" | "snippet" | "bodyText">,
  normalized: NormalizedJournalInputs,
): boolean {
  const wantEmails = normalized.senderEmails.map(normalizeAddr);
  const wantNames = normalized.senderNames.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (wantEmails.length === 0 && wantNames.length === 0) {
    return true;
  }

  const corpus = `${email.from}\n${email.to}\n${email.subject}\n${email.snippet}\n${email.bodyText}`.toLowerCase();
  if (wantEmails.some((wanted) => containsExactEmail(corpus, wanted))) {
    return true;
  }
  if (wantNames.some((name) => corpus.includes(name))) {
    return true;
  }
  return false;
}

/** SAP (and similar) automated addresses — never treat as a user-defined person. */
export function looksLikeSapAutomatedNotification(from: string): boolean {
  const f = from.toLowerCase();
  return (
    f.includes("notification@sap.com") ||
    f.includes("learning-notification@sap.com") ||
    f.includes("no-reply@sap.com") ||
    f.includes("no_reply@sap.com") ||
    f.includes("donotreply@sap.com") ||
    f.includes("do-not-reply@sap.com")
  );
}
