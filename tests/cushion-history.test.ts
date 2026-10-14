/** The savings cushion (safe maximum minus recommendation) and the evidence-based savings history. */
import { describe, expect, it } from 'vitest';
import { buildPersonaState } from '../src/data/personas';
import { addDays } from '../src/domain/dates';
import { computeRecommendation } from '../src/domain/engine';
import { emergencyHistory } from '../src/domain/history';
import { reducer } from '../src/state/reducer';
import { TODAY } from './helpers';

const student = () => ({ ...buildPersonaState('student', TODAY), onboarded: true, contributions: [], createdAt: `${TODAY}T08:00:00.000Z` });

describe('Cushion', () => {
  it('is the unsaved part of the safe maximum and is explained as not spare money', () => {
    const r = computeRecommendation(student(), TODAY);
    expect(r.recommendedCents).toBeGreaterThan(0);
    expect(r.cushionCents).toBe(r.maxSafeCents - r.recommendedCents);
    const step = r.explanation.find((e) => e.label === 'Kept as a cushion')!;
    expect(step.amountCents).toBe(r.cushionCents);
    expect(step.detail ?? '').toContain('Not spare money');
  });

  it('saving today records the cushion for the next check-in', () => {
    const s0 = student();
    const r = computeRecommendation(s0, TODAY);
    const s1 = reducer(s0, { type: 'RECORD_CONTRIBUTION', amountCents: r.recommendedCents, kind: 'deposit' }, TODAY);
    expect(s1.cushion).toEqual({ cents: r.maxSafeCents - r.recommendedCents, setOn: TODAY, reviewOn: r.nextReviewDate });
  });

  it('saving the cushion later clears it and never exceeds what is safe then', () => {
    const s0 = student();
    const r0 = computeRecommendation(s0, TODAY);
    let s = reducer(s0, { type: 'RECORD_CONTRIBUTION', amountCents: r0.recommendedCents, kind: 'deposit' }, TODAY);
    const later = s.cushion!.reviewOn;
    const r1 = computeRecommendation(s, later);
    const amount = Math.min(s.cushion!.cents, r1.maxSafeCents);
    s = reducer(s, { type: 'RECORD_CONTRIBUTION', amountCents: amount, kind: 'deposit', fromCushion: true }, later);
    expect(s.cushion).toBe(undefined);
    const after = computeRecommendation(s, later);
    expect(after.minProjectedCents).toBeGreaterThanOrEqual(after.floorCents);
    expect(reducer({ ...s, cushion: { cents: 1, setOn: TODAY, reviewOn: TODAY } }, { type: 'CLEAR_CUSHION' }, TODAY).cushion).toBe(undefined);
  });

  it('no cushion when nothing is recommended', () => {
    const s = { ...student(), settings: { ...student().settings, pauseUntil: addDays(TODAY, 5) } };
    expect(computeRecommendation(s, TODAY).cushionCents).toBe(0);
  });
});

describe('Savings history', () => {
  it('does not invent a past: without evidence it starts at setup', () => {
    const h = emergencyHistory(student(), TODAY);
    expect(h.basis).toBe('since-setup');
    expect(h.knownFrom).toBe(TODAY);
    expect(h.points.length).toBe(1);
  });

  it('works backwards from transfers found in imported transactions', () => {
    const base = student();
    const t = (daysAgo: number, cents: number, merchant: string) => ({
      id: `x${daysAgo}`,
      date: addDays(TODAY, -daysAgo),
      merchant,
      description: merchant,
      amountCents: cents,
      category: 'transfer' as const,
      subcategory: 'own-account',
      essentiality: 'review' as const,
      source: 'imported' as const,
      confidence: 'high' as const,
    });
    const first = { ...t(60, -1000, 'Coffee'), category: 'food' as const, subcategory: 'cafe', essentiality: 'discretionary' as const };
    const s = { ...base, transactions: [first, t(40, -14400, 'Transfer to GXS Saving Pocket'), t(10, -9600, 'Transfer to GXS Saving Pocket')] };
    const h = emergencyHistory(s, TODAY, 90, 1);
    expect(h.basis).toBe('transfers');
    expect(h.transfersFound).toBe(2);
    expect(h.knownFrom).toBe(addDays(TODAY, -60));
    expect(h.points[0].cents).toBe(0);
    expect(h.points.find((p) => p.date === addDays(TODAY, -20))!.cents).toBe(14400);
    expect(h.points[h.points.length - 1].cents).toBe(24000);
  });

  it('does not count a transfer twice when it was also recorded in the app', () => {
    const base = student();
    const s = {
      ...base,
      createdAt: `${addDays(TODAY, -10)}T08:00:00.000Z`,
      contributions: [{ id: 'c', date: addDays(TODAY, -5), amountCents: 5000, kind: 'deposit' as const, note: '', source: 'user' as const }],
      transactions: [{ id: 'y', date: addDays(TODAY, -5), merchant: 'Transfer to GXS Saving Pocket', description: '', amountCents: -5000, category: 'transfer' as const, subcategory: 'savings', essentiality: 'review' as const, source: 'imported' as const, confidence: 'high' as const }],
    };
    const h = emergencyHistory(s, TODAY, 90, 1);
    expect(h.points[h.points.length - 1].cents - h.points[0].cents).toBe(5000);
  });
});

describe('Recording savings', () => {
  it('undo puts the money back and restores the previous cushion', () => {
    const s0 = student();
    const r = computeRecommendation(s0, TODAY);
    const s1 = reducer(s0, { type: 'RECORD_CONTRIBUTION', amountCents: r.recommendedCents, kind: 'deposit' }, TODAY);
    const id = s1.contributions[s1.contributions.length - 1].id;
    const s2 = reducer(s1, { type: 'UNDO_CONTRIBUTION', id }, TODAY);
    expect(s2.accounts.map((a) => a.balanceCents)).toEqual(s0.accounts.map((a) => a.balanceCents));
    expect(s2.contributions.length).toBe(0);
    expect(s2.cushion).toBe(undefined);
    expect(s2.peakEmergencyCents).toBe(s0.peakEmergencyCents);
  });

  it('undo is refused when the saved money has already been spent from savings', () => {
    const s0 = student();
    const s1 = reducer(s0, { type: 'RECORD_CONTRIBUTION', amountCents: 5000, kind: 'deposit' }, TODAY);
    const id = s1.contributions[0].id;
    const spent = { ...s1, accounts: s1.accounts.map((a) => (a.role === 'emergency' ? { ...a, balanceCents: 1000 } : a)) };
    expect(reducer(spent, { type: 'UNDO_CONTRIBUTION', id }, TODAY)).toBe(spent);
  });

  it('a weekly target caps the suggestion without calling the rest a cushion', () => {
    const s = { ...student(), goal: { selected: 'auto' as const, customTargetCents: 0, weeklyTargetCents: 2000 } };
    const r = computeRecommendation(s, TODAY);
    expect(r.recommendedCents).toBe(2000);
    expect(r.cushionCents).toBe(0);
    expect(r.explanation.some((e) => e.label === 'You could save more')).toBe(true);
    const after = reducer(s, { type: 'RECORD_CONTRIBUTION', amountCents: 2000, kind: 'deposit' }, TODAY);
    expect(after.cushion).toBe(undefined);
  });

  it('start over replaces one country and leaves nothing behind', () => {
    const s = reducer(student(), { type: 'START_OVER', market: 'SG' }, TODAY);
    expect(s.onboarded).toBe(false);
    expect(s.transactions.length + s.accounts.length + s.history.length).toBe(0);
  });
});
