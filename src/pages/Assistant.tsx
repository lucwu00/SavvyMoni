import { useEffect, useRef, useState } from 'react';
import { LuCircleStop, LuSend, LuShieldCheck, LuSparkles, LuWifiOff } from 'react-icons/lu';
import { ask, detectProvider, errorCopy, type AssistantError, type ChatTurn, type Provider } from '../ai/assistant';
import type { ToolContext } from '../ai/tools';
import { useConnectivity, useNavigate, useStore } from '../state/store';
import { Callout, Card, CardHead, PageHead, Pill } from '../ui/components';
import { Markdown } from '../ui/markdown';

interface Msg extends ChatTurn {
  /** Labels of the data the assistant looked at for this answer. */
  used?: string[];
  error?: string;
  pending?: boolean;
}

// The conversation lasts for this browser session (it is not saved to storage).
let SESSION: Msg[] = [];
let PROVIDER: Provider | null | undefined;

const STARTERS = [
  'How much can I safely save this week, and why?',
  'What is limiting my safe-to-save amount?',
  'Where did my money go in the last 4 weeks?',
  'What happens if I face a big unexpected bill next week?',
  'Which bills are coming up before my next income?',
  'How long would it take to rebuild my emergency savings?',
];

export function Assistant() {
  const { state, today, dispatch } = useStore();
  const { online } = useConnectivity();
  const go = useNavigate();
  const [provider, setProvider] = useState<Provider | null | undefined>(PROVIDER);
  const [msgs, setMsgs] = useState<Msg[]>(SESSION);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const live = useRef<ToolContext>({ state, today });
  live.current = { state, today };
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    SESSION = msgs;
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [msgs]);

  useEffect(() => {
    if (PROVIDER !== undefined) return;
    let alive = true;
    detectProvider().then((p) => {
      PROVIDER = p;
      if (alive) setProvider(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => ctl.current?.abort(), []);

  const consented = !!state.settings.aiConsentAt;
  const ready = !!provider && consented && online;

  const send = async (text: string) => {
    const question = text.trim().slice(0, 1000);
    if (!question || !provider || busy) return;
    const history: ChatTurn[] = [...msgs.filter((m) => !m.error && !m.pending && m.content).map((m): ChatTurn => ({ role: m.role, content: m.content })), { role: 'user', content: question }];
    const used: string[] = [];
    setMsgs((m) => [...m, { role: 'user', content: question }, { role: 'assistant', content: '', pending: true, used }]);
    setQ('');
    setBusy('Thinking…');
    const c = new AbortController();
    ctl.current = c;
    const update = (patch: Partial<Msg>) =>
      setMsgs((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
        return copy;
      });
    try {
      const answer = await ask(provider, history, () => live.current, {
        signal: c.signal,
        onText: (t) => {
          setBusy(null);
          update({ content: t });
        },
        onTool: (label) => {
          if (!used.includes(label)) used.push(label);
          setBusy(`${label}…`);
          update({ used: [...used] });
        },
      });
      update({ content: answer, pending: false, used: [...used] });
    } catch (e) {
      const err = e as AssistantError;
      const code = err?.code ?? 'upstream_error';
      if (code === 'not_granted' || code === 'sampling_disabled') {
        PROVIDER = null;
        setProvider(null);
      }
      update({ content: code === 'refused' ? '' : err?.text ?? '', pending: false, error: errorCopy(code), used: [...used] });
    } finally {
      setBusy(null);
      ctl.current = null;
    }
  };

  const status =
    provider === undefined ? (
      <Pill tone="neutral">Checking…</Pill>
    ) : provider ? (
      <Pill tone="good" icon={<LuSparkles aria-hidden />}>
        {provider.kind === 'artifact' ? 'SavvyMoni AI · via your Claude account' : 'SavvyMoni AI · connected'}
      </Pill>
    ) : (
      <Pill tone="neutral">Not connected</Pill>
    );

  return (
    <div className="page">
      <PageHead title="Ask SavvyMoni" sub="SavvyMoni, your AI assistant, reads your records as they are right now and explains your plan using the app’s own calculations." right={status} />

      {!online ? (
        <Callout tone="warning" icon={<LuWifiOff aria-hidden />}>
          You are offline. The assistant needs an internet connection; the rest of SavvyMoni keeps working on this device.
        </Callout>
      ) : null}

      {provider === null ? (
        <Card data-testid="ai-unavailable">
          <CardHead title="The assistant is not connected here" />
          <div className="stack small ink2">
            <p>SavvyMoni’s AI is powered by Claude, an AI model by Anthropic. There are no pre-written answers, so without that connection it stays off. It can be connected in two ways:</p>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
              <li>
                <b>Opened as a Claude artifact:</b> it runs on your own Claude account after you allow this page to use it.
              </li>
              <li>
                <b>Deployed app:</b> the server needs an <code>ANTHROPIC_API_KEY</code> (see README). The key stays on the server.
              </li>
            </ul>
            <p>Everything else, including the safe-to-save calculation and its explanation on the Planner page, works without it.</p>
            <div>
              <button className="btn sm" onClick={() => go('planner')}>
                See how your amount is calculated
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {provider && !consented ? (
        <Card data-testid="ai-consent">
          <CardHead title="Before you switch it on" />
          <div className="stack small ink2">
            <p>SavvyMoni’s AI is powered by Claude from Anthropic. When you ask a question, these are sent to Anthropic{provider.kind === 'artifact' ? ' through your Claude account' : ''} so SavvyMoni can answer:</p>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
              <li>your question and the earlier messages in this chat;</li>
              <li>the parts of your records it looks up: amounts, dates, descriptions, categories, account names and balances, and SavvyMoni’s calculations.</li>
            </ul>
            <p>Your records are not sent in bulk, nothing is sent until you ask, and the assistant cannot change your records. Do not type ID, card or account numbers into the chat.</p>
            <label className="check">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="ai-agree" /> I understand and want to use the assistant
            </label>
            <div>
              <button className="btn primary" disabled={!agree} data-testid="ai-enable" onClick={() => dispatch({ type: 'UPDATE_SETTINGS', patch: { aiConsentAt: new Date().toISOString() } })}>
                <LuShieldCheck /> Switch on the assistant
              </button>
            </div>
          </div>
        </Card>
      ) : null}

      {ready || msgs.length ? (
        <Card>
          <div className="chat" aria-live="polite" data-testid="chat">
            {msgs.length === 0 ? (
              <div className="bubble bot">
                <div>Hi{state.profile.displayName ? ` ${state.profile.displayName.split(' ')[0]}` : ''}. Ask me anything about your money and your savings plan. I look things up in your records each time you ask.</div>
              </div>
            ) : null}
            {msgs.map((m, i) => (
              <div key={i} className={`bubble ${m.role === 'user' ? 'me' : 'bot'}`} data-testid={m.role === 'assistant' ? 'bot-msg' : undefined}>
                {m.role === 'user' ? (
                  <div>{m.content}</div>
                ) : (
                  <>
                    {m.content ? <Markdown text={m.content} /> : m.pending ? <span className="muted">{busy ?? 'Thinking…'}</span> : null}
                    {m.error ? <p className="small" style={{ color: 'var(--warning)', marginTop: m.content ? 8 : 0 }}>{m.error}</p> : null}
                    {m.used?.length ? (
                      <div className="used" aria-label="Data looked at">
                        {m.used.map((u) => (
                          <span key={u} className="chip static">
                            {u}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            ))}
            <div ref={end} />
          </div>
        </Card>
      ) : null}

      {ready ? (
        <>
          {msgs.length === 0 ? (
            <div className="chips">
              {STARTERS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)} disabled={!!busy}>
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              send(q);
            }}
          >
            <input className="input" style={{ flex: 1, minWidth: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your money or your plan" aria-label="Your question" data-testid="chat-input" maxLength={1000} />
            {busy ? (
              <button className="btn" type="button" onClick={() => ctl.current?.abort()} data-testid="chat-stop">
                <LuCircleStop /> Stop
              </button>
            ) : (
              <button className="btn primary" type="submit" disabled={!q.trim()} data-testid="chat-send">
                <LuSend /> Ask
              </button>
            )}
          </form>
          <p className="xsmall muted">
            Answers are written by an AI from your records and SavvyMoni’s calculations. They can still be wrong: check important numbers on the Planner page. Not financial advice.
            {msgs.length ? (
              <>
                {' '}
                <button className="link-btn xsmall" onClick={() => setMsgs([])}>
                  Clear chat
                </button>
              </>
            ) : null}
          </p>
        </>
      ) : null}
    </div>
  );
}
