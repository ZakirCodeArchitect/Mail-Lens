export interface NormalizeJournalInputArgs {
  senders: string[] | string;
  sources: string[] | string;
  intent: string;
}

export interface NormalizedJournalInputs {
  senderEmails: string[];
  senderNames: string[];
  sources: string[];
  intent: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function cleanSenderToken(value: string): string {
  let cleaned = value.trim();
  if (cleaned.startsWith("<") && cleaned.endsWith(">")) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  if (cleaned.toLowerCase().startsWith("mailto:")) {
    cleaned = cleaned.slice("mailto:".length).trim();
  }
  return cleaned;
}

function toLines(input: string[] | string): string[] {
  if (Array.isArray(input)) {
    return input;
  }
  return input.split(/\r?\n/g);
}

function dedupePreserveCase(values: string[], lowerCase: boolean): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of values) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = lowerCase ? trimmed.toLowerCase() : trimmed;
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

export function normalizeJournalInputs({
  senders,
  sources,
  intent,
}: NormalizeJournalInputArgs): NormalizedJournalInputs {
  const senderValues = dedupePreserveCase(toLines(senders), false);
  const sourceValues = dedupePreserveCase(toLines(sources), false);

  const senderEmails: string[] = [];
  const senderNames: string[] = [];

  for (const sender of senderValues) {
    const cleanedSender = cleanSenderToken(sender);
    if (!cleanedSender) {
      continue;
    }
    if (EMAIL_REGEX.test(cleanedSender)) {
      senderEmails.push(cleanedSender.toLowerCase());
    } else {
      senderNames.push(cleanedSender);
    }
  }

  return {
    senderEmails,
    senderNames,
    sources: sourceValues,
    intent: intent.trim(),
  };
}
