import { useState } from 'react';
import logo from '../assets/logo.png';
import { LuArrowLeft, LuBookOpen, LuFileSpreadsheet, LuShieldCheck } from 'react-icons/lu';
import { DEMO_MARKETS, MARKETS } from '../config/markets';
import type { Cents } from '../domain/money';
import type { ImportDraft } from '../import/workbook';
import { useNavigate, useStore } from '../state/store';
import type { DemoMarket } from '../state/country';
import { Card, CardHead, MoneyInput } from '../ui/components';
import { t } from '../ui/i18n';
import { LanguageSelect } from '../App';
import { AllTemplates, DraftReview, FilePicker, TemplateLinks } from './ImportFlow';

type Step = 'start' | 'import' | 'cash';

export function Onboarding() {
  const { state, setCountry, market, dispatch } = useStore();
  const lang = state.settings.language;
  const [step, setStep] = useState<Step>('start');
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [pending, setPending] = useState<Step | null>(null);
  const go = useNavigate();
  const hasPlan = state.accounts.length > 0;
  // Starting a new import or cash book replaces this country's records, so ask first.
  const begin = (next: Step) => (hasPlan ? setPending(next) : setStep(next));

  return (
    <div className="onboard">
      <div className="onboard-inner">
        <div className="row-between">
          <button type="button" className="brand-link" aria-label="SavvyMoni: start page" onClick={() => (setStep('start'), setDraft(null), setPending(null))}>
            <div className="brand">
              <img className="brand-logo" src={logo} alt="" width={36} height={36} />
              <div>
                <div className="brand-name">
                Savvy<span className="moni">Moni</span>
              </div>
                <div className="brand-tag">Save steadily for the known to stand strongly against the unknown.</div>
              </div>
            </div>
          </button>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {step !== 'start' ? (
              <button className="btn ghost sm" onClick={() => (setStep('start'), setDraft(null))}>
                <LuArrowLeft /> Back
              </button>
            ) : null}
            <LanguageSelect compact testId="onboard-language" />
          </div>
        </div>

        {step === 'start' ? (
          <>
            <div className="stack-sm">
              <h1>{t('onb.title', lang)}</h1>
              <p className="ink2" style={{ maxWidth: '64ch' }}>
                {t('onb.intro', lang)}
              </p>
            </div>
            <div className="stack-sm">
              <span className="eyebrow">{t('onb.where', lang)}</span>
              <div className="dir-toggle country-toggle" role="group" aria-label="Country">
                {DEMO_MARKETS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`dir ${state.marketCode === m ? 'on in' : ''}`}
                    aria-pressed={state.marketCode === m}
                    data-testid={`onboard-country-${m}`}
                    onClick={() => setCountry(m as DemoMarket)}
                  >
                    {MARKETS[m].name} · {MARKETS[m].currency.code}
                  </button>
                ))}
              </div>
            </div>
            {hasPlan ? (
              <div className="callout tone-good" data-testid="existing-plan">
                <div className="stack-sm" style={{ width: '100%' }}>
                  <div>
                    You already have a {market.name} plan{state.profile.displayName ? ` for ${state.profile.displayName}` : ''}: {state.transactions.length} transactions, {state.bills.length} bills and {state.incomeSources.length} income
                    sources.
                  </div>
                  <div>
                    <button className="btn sm primary" data-testid="back-to-plan" onClick={() => (dispatch({ type: 'COMPLETE_ONBOARDING' }), go('overview'))}>
                      Back to my plan
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {pending ? (
              <div className="callout tone-warning" data-testid="replace-confirm">
                <div className="stack-sm" style={{ width: '100%' }}>
                  <div>
                    <strong>Start over in {market.name}?</strong> This replaces your current {market.name} records ({state.transactions.length} transactions) with {pending === 'import' ? 'the file you import' : 'a new cash book'}. To add a
                    file to your existing records instead, go back to your plan and use Import &amp; integrations. Other countries are not affected.
                  </div>
                  <div className="row">
                    <button
                      className="btn sm danger"
                      data-testid="replace-yes"
                      onClick={() => {
                        dispatch({ type: 'START_OVER', market: state.marketCode });
                        setStep(pending);
                        setPending(null);
                      }}
                    >
                      Start over
                    </button>
                    <button className="btn sm ghost" onClick={() => setPending(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="grid grid-2">
              <button className="choice" onClick={() => begin('import')} data-testid="start-import">
                <LuFileSpreadsheet aria-hidden />
                <span className="who">{t('onb.import', lang)}</span>
                <span className="small ink2">{t('onb.importSub', lang)}</span>
              </button>
              <button className="choice" onClick={() => begin('cash')} data-testid="start-cash">
                <LuBookOpen aria-hidden />
                <span className="who">{t('onb.cash', lang)}</span>
                <span className="small ink2">{t('onb.cashSub', lang)}</span>
              </button>
            </div>
            <Card>
              <CardHead title="Blank templates" sub="Prefer to write things down first? Fill in a template in Excel, Google Sheets or Numbers, then choose Import a spreadsheet." />
              <AllTemplates compact />
            </Card>
            <div className="callout neutral">
              <LuShieldCheck aria-hidden />
              <div>
                {lang === 'en'
                  ? `Your records stay on this device. SavvyMoni never asks for bank passwords, ${market.code === 'SG' ? 'Singpass, NRIC' : 'national ID numbers'}, card numbers or health records, and it does not move money.`
                  : t('onb.privacy', lang)}
              </div>
            </div>
          </>
        ) : null}

        {step === 'import' ? (
          draft ? (
            <DraftReview draft={draft} mode="setup" onCancel={() => setDraft(null)} onDone={() => go('overview')} />
          ) : (
            <Card>
              <CardHead title={`Import your records (${market.name}, ${market.currency.code})`} sub="Bank and e-wallet exports usually work as they are. For cash or handwritten records, use the template." />
              <div className="stack">
                <FilePicker onDraft={setDraft} />
                <div className="stack-sm">
                  <span className="eyebrow">Templates</span>
                  <p className="xsmall muted">
                    The template has a Transactions sheet (Date, Description, Amount, Category, Account) and optional Income, Bills and Balances sheets. Amounts are in {market.currency.code}; money out is negative.
                  </p>
                  <TemplateLinks />
                </div>
              </div>
            </Card>
          )
        ) : null}

        {step === 'cash' ? <CashStart /> : null}
      </div>
    </div>
  );
}

function CashStart() {
  const { state, dispatch, notify, market } = useStore();
  const lang = state.settings.language;
  const go = useNavigate();
  const [name, setName] = useState('');
  const [cash, setCash] = useState<Cents>(0);
  const [savings, setSavings] = useState<Cents>(0);
  const [daily, setDaily] = useState<Cents>(0);
  const [touched, setTouched] = useState({ cash: false, daily: false });
  const ready = touched.cash && touched.daily && daily > 0;
  return (
    <Card>
      <CardHead title={t('onb.cash', lang)} sub={t('cs.sub', lang, { cur: market.currency.code })} />
      <div className="form-grid">
        <label className="field">
          <span>{t('cs.cash', lang)}</span>
          <MoneyInput value={cash} onChange={(c) => (setCash(c), setTouched((t) => ({ ...t, cash: true })))} ariaLabel="Cash you have now" testId="cash-start" />
          <small>{t('cs.cashHelp', lang)}</small>
        </label>
        <label className="field">
          <span>{t('cs.savings', lang)}</span>
          <MoneyInput value={savings} onChange={setSavings} ariaLabel="Emergency savings" testId="cash-savings" />
        </label>
        <label className="field">
          <span>{t('cs.daily', lang)}</span>
          <MoneyInput value={daily} onChange={(c) => (setDaily(c), setTouched((t) => ({ ...t, daily: true })))} ariaLabel="Daily spending" testId="cash-daily" />
          <small>{t('cs.dailyHelp', lang)}</small>
        </label>
        <label className="field">
          <span>{t('cs.name', lang)}</span>
          <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <button
          className="btn primary"
          disabled={!ready}
          data-testid="cash-confirm"
          onClick={() => {
            dispatch({ type: 'START_CASHBOOK', input: { displayName: name, cashCents: cash, savingsCents: savings, dailySpendCents: daily } });
            notify('Cash book started');
            go('cashbook');
          }}
        >
          {t('cs.open', lang)}
        </button>
        <span className="xsmall muted">{state.settings.simpleMode ? 'Simple mode is on.' : 'You can add income and bills later.'}</span>
      </div>
    </Card>
  );
}
