// src/utils/csv.ts
// Mirrored in backend/samlServer.ts (csvCell) — keep the two in sync.

/**
 * Formats one CSV cell. Quotes values containing a comma, quote or newline,
 * and neutralizes spreadsheet formulas (CSV injection): a text cell starting
 * with = + - @ (or tab/CR) is evaluated by Excel/Sheets on open, so it gets a
 * leading apostrophe. Stop names and emails in exports are rider-supplied.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',');
}
