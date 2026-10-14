/**
 * Connector abstraction. Every data source goes through this interface so
 * provenance, validation, duplicate detection and deletion behave the same
 * way. The prototype has two working connectors, both user-controlled:
 * spreadsheet import (.xlsx / .csv, read on the device) and manual entry.
 * Live provider connectors would implement the same interface server-side
 * under a provider agreement and explicit consent (see
 * INTEGRATION_ROADMAP.md); none exist in this prototype.
 */
import { marketFor } from '../config/markets';
import { findDuplicates } from '../domain/csv';
import { isISODate, type ISODate } from '../domain/dates';
import type { AppState, ConnectionStatus, Transaction } from '../domain/types';
import { draftFromSheets, type ImportDraft } from '../import/workbook';
import type { Sheets } from '../import/xlsx';
import { PROVIDER_MAP, type ProviderMeta } from './providers';

export interface ValidationResult {
  valid: Transaction[];
  rejected: Array<{ record: Partial<Transaction>; reason: string }>;
}

export interface ImportResult {
  added: Transaction[];
  duplicates: Transaction[];
  errors: string[];
}

export interface ConnectionInfo {
  status: ConnectionStatus;
  connected: boolean;
  consentGiven: boolean;
  lastSync?: string;
  recordCount: number;
}

export interface FinancialDataConnector {
  getMetadata(): ProviderMeta;
  getConnectionStatus(state: AppState): ConnectionInfo;
  importTransactions(state: AppState, input: unknown, today: ISODate): ImportResult;
  validateRecords(records: Transaction[], today: ISODate): ValidationResult;
  /** Returns a new state with this source's data removed. */
  disconnect(state: AppState): AppState;
}

export function validateTransactions(records: Transaction[], today: ISODate): ValidationResult {
  const valid: Transaction[] = [];
  const rejected: ValidationResult['rejected'] = [];
  for (const r of records) {
    if (!isISODate(r.date)) rejected.push({ record: r, reason: 'Invalid date' });
    else if (r.date > today) rejected.push({ record: r, reason: 'Date is in the future' });
    else if (!Number.isSafeInteger(r.amountCents) || r.amountCents === 0) rejected.push({ record: r, reason: 'Invalid amount' });
    else if (!r.merchant || r.merchant.length > 120) rejected.push({ record: r, reason: 'Missing or overlong description' });
    else valid.push(r);
  }
  return { valid, rejected };
}

function statusOf(meta: ProviderMeta, state: AppState): ConnectionInfo {
  const c = state.connectors[meta.id];
  return { status: meta.status, connected: !!c?.connected, consentGiven: !!c?.consentGiven, lastSync: c?.lastSync, recordCount: c?.recordCount ?? 0 };
}

export function removeProviderData(state: AppState, providerId: string): AppState {
  const connectors = { ...state.connectors };
  delete connectors[providerId];
  return {
    ...state,
    transactions: state.transactions.filter((t) => t.providerId !== providerId),
    healthBills: state.healthBills.filter((h) => h.providerId !== providerId),
    connectors,
    consents: state.consents.filter((c) => c.id !== `consent-${providerId}`),
  };
}

const SPREADSHEET_META: ProviderMeta = {
  id: 'spreadsheet',
  name: 'Spreadsheet import',
  category: 'bank',
  status: 'user-import',
  formats: ['xlsx', 'csv'],
  contributes: 'Transactions, income, bills and balances from your own workbook or bank export',
  note: 'Read on this device. Nothing is uploaded.',
};

/** User-authorised spreadsheet import. The file is read locally. */
export class SpreadsheetConnector implements FinancialDataConnector {
  getMetadata() {
    return SPREADSHEET_META;
  }
  getConnectionStatus(state: AppState) {
    return statusOf(SPREADSHEET_META, state);
  }
  /** Build a reviewable draft from sheets already read from the file. */
  draft(state: AppState, sheets: Sheets, fileName: string, format: 'xlsx' | 'csv', today: ISODate): ImportDraft {
    return draftFromSheets(sheets, fileName, format, { market: marketFor(state.marketCode), today, rules: state.rules, existing: state.transactions });
  }
  validateRecords(records: Transaction[], today: ISODate) {
    return validateTransactions(records, today);
  }
  importTransactions(state: AppState, input: unknown, today: ISODate): ImportResult {
    const d = this.draft(state, input as Sheets, 'import', 'xlsx', today);
    const { valid, rejected } = this.validateRecords(d.transactions, today);
    return { added: valid, duplicates: [], errors: [...d.errors.map((e) => `${e.sheet} row ${e.line}: ${e.message}`), ...rejected.map((r) => r.reason)] };
  }
  disconnect(state: AppState) {
    return removeProviderData(state, 'spreadsheet');
  }
}

/** Manual entry: the user types records in. */
export class ManualEntryConnector implements FinancialDataConnector {
  getMetadata(): ProviderMeta {
    return { id: 'manual', name: 'Manual entry', category: 'bank', status: 'user-import', formats: ['manual'], contributes: 'Anything you type in', note: 'Stored only on this device.' };
  }
  getConnectionStatus(state: AppState) {
    return statusOf(this.getMetadata(), state);
  }
  validateRecords(records: Transaction[], today: ISODate) {
    return validateTransactions(records, today);
  }
  importTransactions(state: AppState, input: unknown, today: ISODate): ImportResult {
    const records = (input as Transaction[]).map((t) => ({ ...t, source: 'user' as const, providerId: 'manual' }));
    const { valid, rejected } = this.validateRecords(records, today);
    const { fresh, duplicates } = findDuplicates(state.transactions, valid);
    return { added: fresh, duplicates, errors: rejected.map((r) => r.reason) };
  }
  disconnect(state: AppState) {
    return removeProviderData(state, 'manual');
  }
}

export function connectorFor(providerId: string): FinancialDataConnector {
  if (providerId === 'manual') return new ManualEntryConnector();
  return new SpreadsheetConnector();
}

export { PROVIDER_MAP };
