/**
 * Local persistence. Data stays in this browser's localStorage. This is a
 * prototype convenience, not production-grade storage: it is not encrypted
 * and is cleared with site data.
 */
import { DEMO_MARKETS, marketFor } from '../config/markets';
import type { AppState } from '../domain/types';

export const STORAGE_KEY = 'savvymoni:v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function getBrowserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const k = '__savvymoni_probe__';
    window.localStorage.setItem(k, '1');
    window.localStorage.removeItem(k);
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Light structural check so corrupted or foreign data never crashes the app. */
export function isValidState(v: unknown): v is AppState {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<AppState>;
  return (
    s.schemaVersion === 1 &&
    typeof s.asOf === 'string' &&
    !!s.profile &&
    !!s.settings &&
    !!s.goal &&
    Array.isArray(s.accounts) &&
    Array.isArray(s.incomeSources) &&
    Array.isArray(s.bills) &&
    Array.isArray(s.transactions) &&
    Array.isArray(s.healthBills) &&
    Array.isArray(s.contributions) &&
    Array.isArray(s.shocks) &&
    Array.isArray(s.history) &&
    typeof s.connectors === 'object'
  );
}

/** Fill fields added after the first release so older saved data keeps working. */
export function migrate(s: AppState): AppState {
  const marketCode = s.marketCode ?? 'SG';
  // A language the country no longer offers falls back to English.
  const offered = marketFor(marketCode).languages.some((l) => l.code === s.settings.language);
  return {
    ...s,
    marketCode,
    settings: { ...s.settings, language: offered ? s.settings.language : 'en', simpleMode: s.settings.simpleMode ?? false },
  };
}

/** Saved data from a country that is no longer offered is ignored rather than shown in the wrong currency. */
export const isSupportedMarket = (code: string | undefined) => DEMO_MARKETS.includes((code ?? 'SG') as never);

function read(storage: StorageLike | null, key: string): AppState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidState(parsed) && isSupportedMarket(parsed.marketCode) ? migrate(parsed) : null;
  } catch {
    return null;
  }
}

function write(storage: StorageLike | null, key: string, state: AppState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export const loadState = (storage: StorageLike | null) => read(storage, STORAGE_KEY);
export const saveState = (storage: StorageLike | null, state: AppState) => write(storage, STORAGE_KEY, state);

/**
 * Each country keeps its own saved demo. Switching country stores the current
 * state in its slot and loads the other country's slot. Records are never
 * converted between currencies.
 */
export const slotKey = (market: string) => `${STORAGE_KEY}:country:${market}`;
export const loadSlot = (storage: StorageLike | null, market: string) => read(storage, slotKey(market));
export const saveSlot = (storage: StorageLike | null, state: AppState) => write(storage, slotKey(state.marketCode), state);

export function clearState(storage: StorageLike | null): void {
  try {
    storage?.removeItem(STORAGE_KEY);
    for (const m of ['SG', 'PH', 'MM']) storage?.removeItem(slotKey(m));
  } catch {
    /* ignore */
  }
}

/** In-memory storage used by tests and when the browser blocks storage. */
export class MemoryStorage implements StorageLike {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}
