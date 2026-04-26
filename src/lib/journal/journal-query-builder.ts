import type { NormalizedJournalInputs } from "@/lib/journal/input-normalizer";
import { hasListedSenders } from "@/lib/journal/journal-sender-gate";

const MAX_TOTAL_QUERIES = 12;

function quote(value: string): string {
  const escaped = value.trim().replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function pushUnique(queries: string[], query: string): void {
  const trimmed = query.trim();
  if (!trimmed) {
    return;
  }
  const key = trimmed.toLowerCase();
  if (!queries.some((existing) => existing.toLowerCase() === key)) {
    queries.push(trimmed);
  }
}

export function buildJournalGmailQueries(
  startDate: string,
  endDate: string,
  normalizedInputs: NormalizedJournalInputs,
): string[] {
  if (hasListedSenders(normalizedInputs)) {
    return buildJournalGmailQueriesScoped(startDate, endDate, normalizedInputs);
  }

  const after = startDate.replace(/-/g, "/");
  const before = endDate.replace(/-/g, "/");
  const base = `after:${after} before:${before}`;
  const queries: string[] = [];

  for (const senderEmail of normalizedInputs.senderEmails) {
    pushUnique(queries, `${base} from:${senderEmail}`);
  }

  for (const senderName of normalizedInputs.senderNames) {
    const senderValue = senderName.includes(" ") ? quote(senderName) : senderName;
    pushUnique(queries, `${base} from:${senderValue}`);
    pushUnique(queries, `${base} ${quote(senderName)}`);
  }

  for (const source of normalizedInputs.sources) {
    pushUnique(queries, `${base} ${quote(source)}`);
    pushUnique(queries, `${base} subject:${quote(source)}`);
  }

  if (normalizedInputs.sources.length > 0 || normalizedInputs.senderNames.length > 0) {
    const broadTerms = [
      ...normalizedInputs.sources.map((value) => quote(value)),
      ...normalizedInputs.senderNames.map((value) => quote(value)),
    ].slice(0, 8);
    if (broadTerms.length > 0) {
      pushUnique(queries, `${base} (${broadTerms.join(" OR ")})`);
    }
  }

  if (queries.length === 0) {
    pushUnique(queries, base);
  }

  return queries.slice(0, MAX_TOTAL_QUERIES);
}

/** Gmail `from:` OR group so source/keyword queries do not pull unrelated accounts. */
export function buildListedSenderFromClause(normalizedInputs: NormalizedJournalInputs): string | null {
  const parts: string[] = [];
  for (const senderEmail of normalizedInputs.senderEmails) {
    const cleaned = senderEmail.trim();
    if (cleaned) {
      parts.push(`from:${cleaned}`);
    }
  }
  for (const senderName of normalizedInputs.senderNames) {
    const senderValue = senderName.includes(" ") ? quote(senderName) : senderName.trim();
    if (senderValue) {
      parts.push(`from:${senderValue}`);
    }
  }
  if (parts.length === 0) {
    return null;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return `(${parts.join(" OR ")})`;
}

/**
 * When the user listed specific people, scope source and broad queries to those senders only.
 * Otherwise global `after before "sap"` returns SAP system mail from anyone.
 */
export function buildJournalGmailQueriesScoped(
  startDate: string,
  endDate: string,
  normalizedInputs: NormalizedJournalInputs,
): string[] {
  if (!hasListedSenders(normalizedInputs)) {
    return buildJournalGmailQueries(startDate, endDate, normalizedInputs);
  }

  const after = startDate.replace(/-/g, "/");
  const before = endDate.replace(/-/g, "/");
  const base = `after:${after} before:${before}`;
  const fromClause = buildListedSenderFromClause(normalizedInputs);
  if (!fromClause) {
    return buildJournalGmailQueries(startDate, endDate, normalizedInputs);
  }

  const queries: string[] = [];

  for (const senderEmail of normalizedInputs.senderEmails) {
    pushUnique(queries, `${base} from:${senderEmail}`);
  }

  for (const senderName of normalizedInputs.senderNames) {
    const senderValue = senderName.includes(" ") ? quote(senderName) : senderName;
    pushUnique(queries, `${base} from:${senderValue}`);
    pushUnique(queries, `${base} ${quote(senderName)}`);
  }

  for (const source of normalizedInputs.sources) {
    pushUnique(queries, `${base} ${fromClause} ${quote(source)}`);
    pushUnique(queries, `${base} ${fromClause} subject:${quote(source)}`);
  }

  if (normalizedInputs.sources.length > 0 || normalizedInputs.senderNames.length > 0) {
    const broadTerms = [
      ...normalizedInputs.sources.map((value) => quote(value)),
      ...normalizedInputs.senderNames.map((value) => quote(value)),
    ].slice(0, 8);
    if (broadTerms.length > 0) {
      pushUnique(queries, `${base} ${fromClause} (${broadTerms.join(" OR ")})`);
    }
  }

  if (queries.length === 0) {
    pushUnique(queries, `${base} ${fromClause}`);
  }

  return queries.slice(0, MAX_TOTAL_QUERIES);
}
