/**
 * POST /api/chat — server-side proxy to Claude for the SavvyMoni assistant.
 * GET  /api/chat — reports whether an API key is configured.
 *
 * The Anthropic API key stays on the server (ANTHROPIC_API_KEY). The browser
 * sends the conversation and the assistant's read-only tool definitions; the
 * browser runs the tools against the user's local data and sends results
 * back in the next request. This endpoint stores nothing.
 *
 * Guard rails for a prototype: fixed model and token limit, request size
 * caps, an allow-list of tool names, optional origin allow-list
 * (ALLOWED_ORIGINS, comma-separated) and a best-effort per-IP rate limit.
 */
type Env = Record<string, string | undefined>;

const TOOL_NAMES = new Set([
  'get_plan_summary',
  'get_accounts',
  'get_income',
  'get_bills',
  'find_transactions',
  'get_spending_summary',
  'get_cash_projection',
  'simulate_emergency',
  'simulate_change',
  'plan_rebuild',
]);
/** Requests must carry SavvyMoni's own instructions (keep in sync with systemPrompt in src/ai/assistant.ts). */
export const SYSTEM_PREFIXES = ['You are SavvyMoni, the AI assistant', 'You are the assistant inside SavvyMoni'];
const MAX_BODY = 400_000;
const WINDOW_MS = 5 * 60_000;
const MAX_PER_WINDOW = 60;
const hits = new Map<string, number[]>();

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

function limited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > MAX_PER_WINDOW;
}

interface Block {
  type: string;
  [k: string]: unknown;
}
interface Msg {
  role: 'user' | 'assistant';
  content: string | Block[];
}

function validMessages(v: unknown): v is Msg[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 40) return false;
  return v.every(
    (m) =>
      m &&
      (m.role === 'user' || m.role === 'assistant') &&
      (typeof m.content === 'string' ? m.content.length > 0 && m.content.length < 20_000 : Array.isArray(m.content) && m.content.length <= 30 && m.content.every((b: Block) => b && typeof b.type === 'string')),
  );
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const key = env.ANTHROPIC_API_KEY;
  const model = env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  if (request.method === 'GET') return json({ configured: !!key, model: key ? model : null });
  if (request.method !== 'POST') return fail(405, 'invalid_request', 'Use GET or POST.');
  if (!key) return fail(503, 'not_configured', 'ANTHROPIC_API_KEY is not set on the server.');

  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('origin');
  if (allowed.length && origin && !allowed.includes(origin)) return fail(403, 'forbidden', 'Origin not allowed.');
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (limited(ip)) return fail(429, 'rate_limited', 'Too many requests. Try again in a few minutes.');

  const raw = await request.text();
  if (raw.length > MAX_BODY) return fail(413, 'prompt_too_large', 'Request too large.');
  let body: { system?: unknown; messages?: unknown; tools?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'invalid_request', 'Body must be JSON.');
  }
  const system = typeof body.system === 'string' ? body.system.slice(0, 8000) : '';
  if (!SYSTEM_PREFIXES.some((p) => system.startsWith(p))) return fail(400, 'invalid_request', 'Unexpected request.');
  if (!validMessages(body.messages)) return fail(400, 'invalid_request', 'Bad messages.');
  const tools = Array.isArray(body.tools) ? body.tools : [];
  if (tools.length > 12 || !tools.every((t: { name?: unknown }) => typeof t?.name === 'string' && TOOL_NAMES.has(t.name))) return fail(400, 'invalid_request', 'Unknown tool.');

  let upstream: Response;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1500, system, messages: body.messages, ...(tools.length ? { tools } : {}) }),
    });
  } catch {
    return fail(502, 'upstream_error', 'Could not reach the Claude API.');
  }
  const data = (await upstream.json().catch(() => null)) as { content?: unknown; stop_reason?: string; error?: { type?: string; message?: string } } | null;
  if (!upstream.ok || !data) {
    const code = upstream.status === 429 || upstream.status === 529 ? 'rate_limited' : upstream.status === 401 || upstream.status === 403 ? 'not_configured' : 'upstream_error';
    return fail(upstream.status === 429 ? 429 : 502, code, data?.error?.message ?? `Claude API error ${upstream.status}`);
  }
  return json({ content: data.content, stop_reason: data.stop_reason });
}

export default {
  fetch(request: Request) {
    return handle(request, (globalThis as { process?: { env: Env } }).process?.env ?? {});
  },
};
