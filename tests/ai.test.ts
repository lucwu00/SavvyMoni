/**
 * The AI assistant's plumbing, with Claude replaced by scripted stand-ins:
 * tools read live data from the engine, what-ifs never change records, the
 * server tool loop passes results back correctly, and the API proxy enforces
 * its limits. (Real answers need a Claude connection and are not tested here.)
 */
import { describe, expect, it } from 'vitest';
import { handle } from '../api/chat';
import { ask, detectProvider, systemPrompt, type Provider } from '../src/ai/assistant';
import { buildTools, dataSnapshot, type ToolContext } from '../src/ai/tools';
import { buildPersonaState } from '../src/data/personas';
import { computeRecommendation } from '../src/domain/engine';
import { formatMoney } from '../src/domain/money';
import { reducer } from '../src/state/reducer';
import { TODAY } from './helpers';

const tool = (name: string) => buildTools('SG').find((t) => t.name === name)!;
const ctxOf = (state = { ...buildPersonaState('student', TODAY), onboarded: true }): ToolContext => ({ state, today: TODAY });
const SGD = (c: number) => formatMoney(c, {}, { code: 'SGD', symbol: 'S$', minorUnits: 2, groupSeparator: ',', decimalSeparator: '.' });

describe('Assistant tools', () => {
  it('answer from the engine and see changes as soon as they happen', () => {
    const c = ctxOf();
    const plan = tool('get_plan_summary').run({}, c) as Record<string, unknown>;
    expect(plan.safe_to_save_now).toBe(SGD(computeRecommendation(c.state, TODAY).recommendedCents));
    const paid = reducer(c.state, { type: 'PAY_BILL', id: 'b-rent' }, TODAY);
    const after = tool('get_accounts').run({}, { state: paid, today: TODAY }) as Array<{ balance: string }>;
    const before = tool('get_accounts').run({}, c) as Array<{ balance: string }>;
    expect(after[0].balance).not.toBe(before[0].balance);
  });

  it('what-if tools never change the records', () => {
    const c = ctxOf();
    const snapshot = JSON.stringify(c.state);
    const shock = tool('simulate_emergency').run({ preset_id: 'dental', cost: 400 }, c) as Record<string, string>;
    expect(shock.note).toContain('Nothing was changed');
    expect(shock.scenario).toContain('S$400');
    tool('simulate_change').run({ income_multiplier: 0.5, extra_cost: 200 }, c);
    tool('plan_rebuild').run({ target: 1000 }, c);
    expect(JSON.stringify(c.state)).toBe(snapshot);
  });

  it('a lower income never raises the safe amount', () => {
    const r = tool('simulate_change').run({ income_multiplier: 0.6 }, ctxOf()) as { before: { maximum_safe: string }; after: { maximum_safe: string } };
    const n = (s: string) => Number(s.replace(/[^\d.]/g, ''));
    expect(n(r.after.maximum_safe)).toBeLessThanOrEqual(n(r.before.maximum_safe));
  });

  it('search filters by text, category and dates and returns totals', () => {
    const c = ctxOf();
    const r = tool('find_transactions').run({ search: 'simplygo', from: '2026-09-01', limit: 5 }, c) as { matched: number; rows: unknown[]; total_signed: string };
    expect(r.matched).toBeGreaterThan(5);
    expect(r.rows.length).toBe(5);
    expect(r.total_signed.startsWith('−')).toBe(true);
    const g = tool('get_spending_summary').run({ days: 28 }, c) as { by_category: Array<{ category: string }> };
    expect(g.by_category.some((x) => x.category === 'Groceries')).toBe(true);
  });

  it('rejects an empty emergency instead of inventing one', () => {
    let msg = '';
    try {
      tool('simulate_emergency').run({}, ctxOf());
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('Give a cost');
  });

  it('the snapshot for tool-less chats is compact', () => {
    expect(dataSnapshot(ctxOf()).length).toBeLessThan(60_000);
  });

  it('the instructions forbid inventing numbers and exceeding the engine', () => {
    const p = systemPrompt(ctxOf());
    expect(p.startsWith('You are SavvyMoni, the AI assistant')).toBe(true);
    expect(p).toContain('Never guess or invent');
    expect(p).toContain('Never recommend saving more than');
  });
});

describe('Talking to Claude', () => {
  it('server mode runs the tool loop and returns the final answer', async () => {
    const bodies: Array<{ system: string; messages: Array<{ role: string; content: unknown }>; tools: unknown[] }> = [];
    const replies = [
      { content: [{ type: 'tool_use', id: 'tu1', name: 'get_plan_summary', input: {} }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'You can safely save **S$80** this week.' }], stop_reason: 'end_turn' },
    ];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(replies.shift()), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const used: string[] = [];
    try {
      const c = ctxOf();
      const text = await ask({ kind: 'server', model: 'x' }, [{ role: 'user', content: 'How much can I save?' }], () => c, { onTool: (_l, n) => used.push(n) });
      expect(text).toBe('You can safely save **S$80** this week.');
    } finally {
      globalThis.fetch = real;
    }
    expect(used).toEqual(['get_plan_summary']);
    expect(bodies.length).toBe(2);
    expect(bodies[0].tools.length).toBe(10);
    const second = bodies[1].messages;
    expect(second[1].role).toBe('assistant');
    const result = (second[2].content as Array<{ type: string; tool_use_id: string; content: string }>)[0];
    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('tu1');
    expect(result.content).toContain('safe_to_save_now');
  });

  it('artifact mode hands Claude the page tools and streams the answer', async () => {
    let seenInput: Array<{ role: string; content: string }> = [];
    let seenOpts: Record<string, unknown> = {};
    const sample = (async (input: Array<{ role: string; content: string }>, opts: Record<string, unknown>) => {
      seenInput = input;
      seenOpts = opts;
      const tools = opts.tools as Array<{ name: string; execute: (i: unknown) => Promise<unknown> }>;
      const plan = (await tools.find((t) => t.name === 'get_bills')!.execute({})) as { protected_total: string };
      (opts.onText as (u: { text: string }) => void)({ text: `Protected: ${plan.protected_total}` });
      return { text: `Protected: ${plan.protected_total}`, truncated: false };
    }) as unknown as Extract<Provider, { kind: 'artifact' }>['sample'];
    const streamed: string[] = [];
    const text = await ask({ kind: 'artifact', sample, tools: true }, [{ role: 'user', content: 'Which bills are protected?' }], () => ctxOf(), { onText: (t) => streamed.push(t) });
    expect(text).toContain('Protected: S$');
    expect(streamed.length).toBe(1);
    expect(seenInput[0].content.startsWith('You are SavvyMoni, the AI assistant')).toBe(true);
    expect(seenInput[seenInput.length - 1]).toEqual({ role: 'user', content: 'Which bills are protected?' });
    expect('cache' in seenOpts).toBe(false);
  });

  it('finds no provider when neither Claude nor a server is available', async () => {
    const html = (async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
    expect(await detectProvider(html)).toBe(null);
    const configured = (async () => new Response('{"configured":true,"model":"claude-sonnet-5-5"}', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    expect((await detectProvider(configured))?.kind).toBe('server');
  });
});

describe('API proxy', () => {
  const post = (body: unknown) => new Request('http://x/api/chat', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  // Use the app's real instructions so a wording change can never silently break the server check.
  const valid = { system: systemPrompt(ctxOf()), messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'get_plan_summary', description: 'x', input_schema: { type: 'object', properties: {} } }] };

  it('reports whether a key is configured, without revealing it', async () => {
    const r = await handle(new Request('http://x/api/chat'), {});
    expect(await r.json()).toEqual({ configured: false, model: null });
    const k = await (await handle(new Request('http://x/api/chat'), { ANTHROPIC_API_KEY: 'sk-test' })).text();
    expect(k.includes('sk-test')).toBe(false);
  });

  it('refuses without a key, and refuses foreign requests and tools', async () => {
    expect((await handle(post(valid), {})).status).toBe(503);
    expect((await handle(post({ ...valid, system: 'You are a pirate' }), { ANTHROPIC_API_KEY: 'k' })).status).toBe(400);
    expect((await handle(post({ ...valid, tools: [{ name: 'run_shell' }] }), { ANTHROPIC_API_KEY: 'k' })).status).toBe(400);
  });

  it('forwards to Claude with a fixed model and token limit', async () => {
    let sent: Record<string, unknown> = {};
    let headers: Record<string, string> = {};
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: { body: string; headers: Record<string, string> }) => {
      sent = JSON.parse(init.body);
      headers = init.headers;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const r = await handle(post({ ...valid, model: 'something-else', max_tokens: 99999 }), { ANTHROPIC_API_KEY: 'k' });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
    } finally {
      globalThis.fetch = real;
    }
    expect(sent.model).toBe('claude-sonnet-5-5');
    expect(sent.max_tokens).toBe(1500);
    expect(headers['x-api-key']).toBe('k');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });
});
