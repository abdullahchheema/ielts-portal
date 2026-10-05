/**
 * CSV for analytics exports. Three guarantees:
 *  - RFC 4180 quoting, so commas, quotes and newlines in names cannot break the columns.
 *  - Spreadsheet formula injection is blocked: a cell starting with = + - @ or a control character
 *    is prefixed with an apostrophe, so Excel shows it as text instead of running it.
 *  - A UTF-8 byte-order mark, so Excel reads non-ASCII names (Urdu, accents) correctly.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: Array<keyof T & string>): string {
  const header = columns.map(csvCell).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(','));
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}

/** Above this, an export is refused rather than timing out the database pooler. */
export const CSV_MAX_ROWS = 5000;
