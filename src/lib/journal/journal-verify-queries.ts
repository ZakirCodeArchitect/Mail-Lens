function quote(value: string): string {
  const escaped = value.trim().replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function buildSenderAnywhereClause(sender: string): string {
  const trimmed = sender.trim();
  if (!trimmed) {
    return "";
  }
  const token = trimmed.includes(" ") ? quote(trimmed) : trimmed;
  const rawToken = trimmed.includes(" ") ? null : trimmed;
  const variants = [
    `from:${token}`,
    `to:${token}`,
    `cc:${token}`,
    quote(trimmed),
    ...(rawToken ? [rawToken] : []),
  ];
  return `(${variants.join(" OR ")})`;
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
    const clause = buildSenderAnywhereClause(senderEmail);
    rows.push({
      display: senderEmail,
      queries: clause ? [`${base} ${clause}`] : [],
    });
  }

  for (const senderName of senderNames) {
    const clause = buildSenderAnywhereClause(senderName);
    rows.push({
      display: senderName,
      queries: clause ? [`${base} ${clause}`] : [],
    });
  }

  return rows.filter((row) => row.queries.length > 0);
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
