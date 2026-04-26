function quote(value: string): string {
  const escaped = value.trim().replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function buildJournalDateRangeClause(startDate: string, endDate: string): string {
  const after = startDate.replace(/-/g, "/");
  const before = endDate.replace(/-/g, "/");
  return `after:${after} before:${before}`;
}

/** Gmail queries used to sanity-check that a sender line returns candidates (same shape as main journal retrieval). */
export function buildSenderVerifyQueries(
  base: string,
  senderEmails: string[],
  senderNames: string[],
): Array<{ display: string; queries: string[] }> {
  const rows: Array<{ display: string; queries: string[] }> = [];

  for (const senderEmail of senderEmails) {
    rows.push({
      display: senderEmail,
      queries: [`${base} from:${senderEmail}`],
    });
  }

  for (const senderName of senderNames) {
    const senderValue = senderName.includes(" ") ? quote(senderName) : senderName;
    rows.push({
      display: senderName,
      queries: [`${base} from:${senderValue}`, `${base} ${quote(senderName)}`],
    });
  }

  return rows;
}

/** Gmail queries used to sanity-check that a source/newsletter line returns candidates. */
export function buildSourceVerifyQueries(
  base: string,
  sources: string[],
  listedSenderFromClause?: string | null,
): Array<{ display: string; queries: string[] }> {
  const scope = listedSenderFromClause?.trim() ? `${listedSenderFromClause.trim()} ` : "";
  return sources.map((source) => ({
    display: source,
    queries: [`${base} ${scope}${quote(source)}`, `${base} ${scope}subject:${quote(source)}`],
  }));
}
