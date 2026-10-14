import { marketFor } from '../config/markets';
import type { ISODate } from '../domain/dates';
import type { AppState } from '../domain/types';
import { emptyState, type DemoMarket } from '../import/build';
import { loadSlot, saveSlot, type StorageLike } from './persistence';

export type { DemoMarket };

/**
 * Switch country: park the current state in its own country slot, then load
 * the target country's saved state, or an empty one that starts at setup.
 * Nothing is converted between currencies: each country's records stay in
 * their own currency.
 */
export function switchCountry(current: AppState, target: DemoMarket, storage: StorageLike | null, today: ISODate): AppState {
  if (current.marketCode === target) return current;
  if (current.onboarded || current.accounts.length > 0) saveSlot(storage, { ...current, onboarded: true });
  const next = loadSlot(storage, target) ?? emptyState(target, today);
  // Keep the person's language when the new country offers it; otherwise English.
  const offered = marketFor(target).languages.some((l) => l.code === current.settings.language);
  return offered ? { ...next, settings: { ...next.settings, language: current.settings.language } } : next;
}
