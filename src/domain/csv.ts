/**
 * CSV parsing and shared import helpers: a small hand-written parser (no
 * eval, no dynamic code), text sanitising and duplicate detection. The full
 * spreadsheet import (column detection, validation, categorisation) lives in
 * src/import/workbook.ts and handles CSV and .xlsx the same way.
 */
import { normaliseMerchant } from './classifier';
import type { Transaction } from './types';

/** RFC 4180-style parser supporting quotes, escaped quotes and CRLF. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Strip spreadsheet formula prefixes so imported text is always inert. */
export const sanitiseText = (v: string): string => v.replace(/^[=+@\t\r-]+(?=\D)/, '').trim().slice(0, 120);

export interface RowError {
  line: number;
  message: string;
}

export function dedupeKey(t: Pick<Transaction, 'date' | 'amountCents' | 'merchant'>): string {
  return `${t.date}|${t.amountCents}|${normaliseMerchant(t.merchant).slice(0, 14)}`;
}

/** Split incoming records into new and duplicate (vs existing data and within the file). */
export function findDuplicates(existing: Transaction[], incoming: Transaction[]): { fresh: Transaction[]; duplicates: Transaction[] } {
  const seen = new Set(existing.map(dedupeKey));
  const fresh: Transaction[] = [];
  const duplicates: Transaction[] = [];
  for (const t of incoming) {
    const k = dedupeKey(t);
    if (seen.has(k)) duplicates.push({ ...t, flags: [...(t.flags ?? []), 'duplicate'] });
    else {
      seen.add(k);
      fresh.push(t);
    }
  }
  return { fresh, duplicates };
}
