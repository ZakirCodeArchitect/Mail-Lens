import type { NormalizedJournalInputs } from "@/lib/journal/input-normalizer";
import { buildJournalKeywordGroups } from "@/lib/journal/journal-keywords";
import { looksLikeSapAutomatedNotification } from "@/lib/journal/journal-sender-gate";
import type { ParsedJournalEmail } from "@/services/journal-gmail.service";

interface ScoreJournalEmailResult {
  ruleScore: number;
  matchedSignals: string[];
}

function hasTerm(text: string, term: string): boolean {
  const normalizedText = ` ${text.toLowerCase()} `;
  const normalizedTerm = term.toLowerCase().trim();
  if (!normalizedTerm) {
    return false;
  }
  if (normalizedTerm.includes(" ")) {
    return normalizedText.includes(normalizedTerm);
  }
  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(normalizedText);
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => hasTerm(text, term));
}

function safeText(...parts: string[]): string {
  return parts.join(" ").trim();
}

/** Training / product links from a listed person (not generic SAP account mail). */
const SENDER_EDU_LINK_PATTERN =
  /https?:\/\/[\w.-]*(learning\.sap\.com|pages\.community\.sap\.com|community\.sap\.com|help\.sap\.com)[^\s]*/i;

function hasSenderEducationalSapLink(email: ParsedJournalEmail, senderTerms: string[]): boolean {
  if (senderTerms.length === 0) {
    return false;
  }
  if (!hasAnyTerm(email.from, senderTerms)) {
    return false;
  }
  const corpus = `${email.snippet} ${email.bodyText}`.slice(0, 12000);
  return SENDER_EDU_LINK_PATTERN.test(corpus);
}

export function scoreJournalEmail(
  email: ParsedJournalEmail,
  normalizedInputs: NormalizedJournalInputs,
  intentTerms: string[],
): ScoreJournalEmailResult {
  const subject = email.subject.toLowerCase();
  const snippet = email.snippet.toLowerCase();
  const body = email.bodyText.toLowerCase();
  const from = email.from.toLowerCase();
  const attachments = email.attachmentFilenames.join(" ").toLowerCase();
  const mergedKeywords = intentTerms.map((item) => item.toLowerCase());
  const keywordGroups = buildJournalKeywordGroups(mergedKeywords);
  const sourceTerms = normalizedInputs.sources.map((item) => item.toLowerCase());
  const senderTerms = [...normalizedInputs.senderEmails, ...normalizedInputs.senderNames].map((item) =>
    item.toLowerCase(),
  );
  const matchedSignals = new Set<string>();
  let score = 0;

  if (hasAnyTerm(subject, sourceTerms)) {
    score += 40;
    matchedSignals.add("subject-source");
  }
  if (hasAnyTerm(subject, mergedKeywords)) {
    score += 35;
    matchedSignals.add("subject-keyword");
  }
  if (hasAnyTerm(snippet, sourceTerms)) {
    score += 30;
    matchedSignals.add("snippet-source");
  }
  if (hasAnyTerm(body, sourceTerms)) {
    score += 30;
    matchedSignals.add("body-source");
  }
  if (hasAnyTerm(from, senderTerms)) {
    score += 25;
    matchedSignals.add("from-sender");
  }
  if (hasSenderEducationalSapLink(email, senderTerms)) {
    score += 28;
    matchedSignals.add("sender-edu-link");
  }

  const combinedText = safeText(subject, snippet, body);
  if (hasAnyTerm(combinedText, keywordGroups.achievementKeywords)) {
    score += 25;
    matchedSignals.add("achievement-signal");
  }
  if (hasAnyTerm(combinedText, keywordGroups.projectKeywords)) {
    score += 25;
    matchedSignals.add("project-signal");
  }
  if (hasAnyTerm(combinedText, keywordGroups.eventKeywords)) {
    score += 25;
    matchedSignals.add("event-signal");
  }
  if (hasAnyTerm(attachments, [...sourceTerms, ...mergedKeywords])) {
    score += 20;
    matchedSignals.add("attachment-signal");
  }

  if (/(https?:\/\/|www\.)/i.test(body) && hasAnyTerm(body, ["event", "project", "course", "seminar"])) {
    score += 15;
    matchedSignals.add("body-url-event");
  }

  return {
    ruleScore: Math.max(0, Math.min(100, Math.round(score))),
    matchedSignals: Array.from(matchedSignals),
  };
}

/** Rule signals that indicate journal intent beyond a bare source/newsletter name match. */
const JOURNAL_RELEVANCE_SIGNALS = new Set([
  "from-sender",
  "sender-edu-link",
  "subject-keyword",
  "achievement-signal",
  "project-signal",
  "event-signal",
  "body-url-event",
]);

export function hasJournalRelevanceSignals(matchedSignals: string[]): boolean {
  return matchedSignals.some((signal) => JOURNAL_RELEVANCE_SIGNALS.has(signal));
}

/**
 * Routine vendor/account mail that often contains a brand name (e.g. SAP) but is not journal evidence.
 * Kept intentionally narrow to avoid catching legitimate "registration" for events/courses.
 */
export function looksLikeRoutineTransactionalEmail(email: ParsedJournalEmail): boolean {
  const corpus = `${email.subject}\n${email.snippet}\n${email.bodyText.slice(0, 4000)}`.toLowerCase();
  const patterns = [
    /\bactivate your sap id\b/i,
    /\bactivate your\b/,
    /\bactivation (link|required|code)\b/,
    /\bverify your email\b/,
    /\bconfirm your (email|account)\b/,
    /\bpassword reset\b/,
    /\breset your password\b/,
    /\b(one[- ]time|otp)\b.*\bcode\b/,
    /\bthank you for registering\b.*\bactivate\b/,
    /\buser registration\b.*\b(onboarding|activate)\b/,
    /\bauthentication, you need to activate\b/,
    /\bfor authentication, you need to activate\b/,
    /\bsuccessful login\b/,
    /\bnew sign[- ]in\b/,
    /\bsecurity alert\b.*\b(sign[- ]in|login)\b/,
    /\bwelcome to the sap learning site\b/i,
    /\bwelcome aboard\b.*\bsap learning\b/i,
    /\blearning onboarding\b/i,
    /\bwe are excited to have you join the sap learning site\b/i,
    /\bto help you get started, watch these onboarding videos\b/i,
  ];
  return patterns.some((re) => re.test(corpus));
}

/**
 * Auto-include only when the score is high AND we see real journal/sender/intent signals,
 * not merely the source string repeated in subject/snippet/body (which matches account emails).
 */
export function shouldAutoInclude(
  ruleScore: number,
  matchedSignals: string[],
  email: ParsedJournalEmail,
): boolean {
  if (ruleScore < 70) {
    return false;
  }
  if (looksLikeSapAutomatedNotification(email.from)) {
    return false;
  }
  if (looksLikeRoutineTransactionalEmail(email)) {
    return false;
  }
  if (!hasJournalRelevanceSignals(matchedSignals)) {
    return false;
  }
  return true;
}

export function isAiUncertain(ruleScore: number): boolean {
  return ruleScore >= 25 && ruleScore <= 69;
}

export function isVerifiedSourceNewsletter(email: ParsedJournalEmail, sources: string[]): boolean {
  const from = email.from.toLowerCase();
  const subject = email.subject.toLowerCase();
  return sources.some((source) => {
    const term = source.toLowerCase();
    return from.includes(term) || subject.includes(term);
  });
}
