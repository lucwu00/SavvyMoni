import { useEffect, useState, type ReactNode } from 'react';
import logo from './assets/logo.png';
import {
  LuBookOpen,
  LuChartPie,
  LuCircleCheck,
  LuEllipsis,
  LuFlaskConical,
  LuGlobe,
  LuLayoutDashboard,
  LuLifeBuoy,
  LuMessageCircle,
  LuPiggyBank,
  LuPlug,
  LuSettings,
  LuWallet,
  LuWifi,
  LuWifiOff,
  LuZap,
} from 'react-icons/lu';
import { DEMO_MARKETS, MARKETS, type MarketCode } from './config/markets';
import { Overview } from './pages/Overview';
import { CashBook } from './pages/CashBook';
import { Finances } from './pages/Finances';
import { Planner } from './pages/Planner';
import { Simulator } from './pages/Simulator';
import { Recovery } from './pages/Recovery';
import { Insights } from './pages/Insights';
import { Integrations } from './pages/Integrations';
import { Benchmark } from './pages/Benchmark';
import { AseanDemo } from './pages/AseanDemo';
import { Assistant } from './pages/Assistant';
import { SettingsPage } from './pages/Settings';
import { Onboarding } from './pages/Onboarding';
import type { DemoMarket } from './state/country';
import { NavContext, StoreProvider, useConnectivity, useRoute, useStore, type Route } from './state/store';
import { LANGUAGE_INFO, t, type StringKey } from './ui/i18n';

const NAV: Array<{ route: Route; icon: ReactNode; simple: boolean }> = [
  { route: 'overview', icon: <LuLayoutDashboard aria-hidden />, simple: true },
  { route: 'cashbook', icon: <LuBookOpen aria-hidden />, simple: true },
  { route: 'planner', icon: <LuPiggyBank aria-hidden />, simple: true },
  { route: 'simulator', icon: <LuZap aria-hidden />, simple: true },
  { route: 'recovery', icon: <LuLifeBuoy aria-hidden />, simple: true },
  { route: 'finances', icon: <LuWallet aria-hidden />, simple: false },
  { route: 'insights', icon: <LuChartPie aria-hidden />, simple: false },
  { route: 'integrations', icon: <LuPlug aria-hidden />, simple: false },
  { route: 'benchmark', icon: <LuFlaskConical aria-hidden />, simple: false },
  { route: 'asean', icon: <LuGlobe aria-hidden />, simple: true },
  { route: 'assistant', icon: <LuMessageCircle aria-hidden />, simple: true },
  { route: 'settings', icon: <LuSettings aria-hidden />, simple: true },
];

const TABS: Array<{ route: Route; key: StringKey }> = [
  { route: 'overview', key: 'tab.home' },
  { route: 'cashbook', key: 'tab.cash' },
  { route: 'planner', key: 'tab.plan' },
  { route: 'simulator', key: 'tab.simulate' },
];

function Brand() {
  const { dispatch } = useStore();
  return (
    <button
      type="button"
      className="brand-link"
      title="Back to the start page"
      aria-label="SavvyMoni: back to the start page"
      data-testid="brand-home"
      onClick={() => {
        dispatch({ type: 'RESTART_ONBOARDING' });
        window.location.hash = '';
      }}
    >
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
  );
}

export function CountrySelect({ compact = false, testId }: { compact?: boolean; testId?: string }) {
  const { state, setCountry, notify } = useStore();
  return (
    <label className={compact ? 'country-select compact' : 'country-select'}>
      <span className={compact ? 'sr-only' : 'eyebrow'}>{t('common.country', state.settings.language)}</span>
      <select
        className="input"
        value={state.marketCode}
        data-testid={testId ?? (compact ? 'country-select-mobile' : 'country-select')}
        onChange={(e) => {
          const m = e.target.value as DemoMarket;
          setCountry(m);
          notify(`Switched to ${MARKETS[m].name}. Each country keeps its own records; nothing was converted.`);
        }}
      >
        {DEMO_MARKETS.map((m: MarketCode) => (
          <option key={m} value={m}>
            {compact ? `${m} · ${MARKETS[m].currency.code}` : `${MARKETS[m].name} (${MARKETS[m].currency.code})`}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The languages offered in the current country, as a small drop-down. */
export function LanguageSelect({ compact = false, short = false, testId }: { compact?: boolean; short?: boolean; testId?: string }) {
  const { state, market, dispatch } = useStore();
  const lang = state.settings.language;
  return (
    <label className={compact ? 'country-select lang-select compact' : 'country-select lang-select'}>
      <span className={compact ? 'sr-only' : 'eyebrow'}>{t('common.language', lang)}</span>
      <select
        className="input"
        value={lang}
        aria-label={t('common.language', lang)}
        data-testid={testId ?? (compact ? 'language-select-mobile' : 'language-select-corner')}
        onChange={(e) => dispatch({ type: 'UPDATE_SETTINGS', patch: { language: e.target.value as typeof lang } })}
      >
        {market.languages.map((l) => (
          <option key={l.code} value={l.code} lang={LANGUAGE_INFO[l.code].html}>
            {short ? LANGUAGE_INFO[l.code].short : l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ConnectivityBadge() {
  const { online, offlineReady } = useConnectivity();
  const { state } = useStore();
  const lang = state.settings.language;
  return (
    <span
      className={`badge ${online ? '' : 'estimated'}`}
      data-testid="connectivity"
      title={offlineReady ? 'This app is saved on this device and works without internet.' : 'Calculations run on this device. Reopening the app without internet needs the installed version.'}
    >
      {online ? <LuWifi aria-hidden /> : <LuWifiOff aria-hidden />}
      <span className="conn-label">
        {online ? t('common.online', lang) : t('common.offline', lang)}
        {offlineReady ? ' · offline-ready' : ''}
      </span>
    </span>
  );
}

function Page({ route }: { route: Route }) {
  switch (route) {
    case 'cashbook':
      return <CashBook />;
    case 'finances':
      return <Finances />;
    case 'planner':
      return <Planner />;
    case 'simulator':
      return <Simulator />;
    case 'recovery':
      return <Recovery />;
    case 'insights':
      return <Insights />;
    case 'integrations':
      return <Integrations />;
    case 'benchmark':
      return <Benchmark />;
    case 'asean':
      return <AseanDemo />;
    case 'assistant':
      return <Assistant />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <Overview />;
  }
}

function Shell() {
  const { state, toast } = useStore();
  const [route, go] = useRoute();
  const [more, setMore] = useState(false);
  const lang = state.settings.language;
  useEffect(() => {
    document.documentElement.lang = LANGUAGE_INFO[lang]?.html ?? 'en';
  }, [lang]);
  const simple = state.settings.simpleMode;
  const nav = NAV.filter((n) => !simple || n.simple);

  if (!state.onboarded) {
    return (
      <NavContext.Provider value={go}>
        <Onboarding />
        {toast ? <div className="toast" role="status">{toast}</div> : null}
      </NavContext.Provider>
    );
  }

  return (
    <NavContext.Provider value={go}>
      <div className={`shell ${simple ? 'simple' : ''}`} lang={LANGUAGE_INFO[lang]?.html ?? 'en'}>
        <aside className="sidebar" aria-label="Main navigation">
          <Brand />
          <div className="locale-pair">
            <CountrySelect />
            <LanguageSelect />
          </div>
          <nav className="nav">
            {nav.map((n) => (
              <a key={n.route} href={`#${n.route}`} className="nav-link" aria-current={route === n.route ? 'page' : undefined} onClick={(e) => (e.preventDefault(), go(n.route))}>
                {n.icon}
                {t(`nav.${n.route}` as StringKey, lang)}
              </a>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="card flat" style={{ padding: 12 }}>
              <div className="eyebrow">Your records</div>
              <div style={{ fontWeight: 650 }}>{state.profile.displayName || 'On this device'}</div>
              <div className="xsmall muted" data-testid="records-summary">
                {state.transactions.length} transactions · {state.bills.length} bills · {state.incomeSources.length} income
              </div>
              <button className="link-btn small" style={{ marginTop: 6 }} onClick={() => go('integrations')}>
                Import a spreadsheet
              </button>
            </div>
            <ConnectivityBadge />
            <p className="xsmall muted">Prototype: SavvyMoni does not move money or connect to live accounts.</p>
          </div>
        </aside>
        <div style={{ minWidth: 0 }}>
          <header className="topbar">
            <Brand />
            <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
              <ConnectivityBadge />
              <CountrySelect compact />
              <LanguageSelect compact short />
            </div>
          </header>
          <main className="main" id="main">
            <Page route={route} />
          </main>
        </div>
      </div>
      <nav className="tabbar" aria-label="Primary">
        {TABS.map((tab) => {
          const n = NAV.find((x) => x.route === tab.route)!;
          return (
            <button key={tab.route} className="tab" aria-current={route === tab.route ? 'page' : undefined} onClick={() => go(tab.route)}>
              {n.icon}
              {t(tab.key, lang)}
            </button>
          );
        })}
        <button className="tab" aria-current={!TABS.some((x) => x.route === route) ? 'page' : undefined} onClick={() => setMore(true)} aria-haspopup="dialog">
          <LuEllipsis aria-hidden />
          {t('tab.more', lang)}
        </button>
      </nav>
      {more ? (
        <>
          <div className="backdrop" onClick={() => setMore(false)} />
          <div className="sheet" role="dialog" aria-label="All pages">
            <nav className="nav">
              {nav.map((n) => (
                <button
                  key={n.route}
                  className="nav-link"
                  aria-current={route === n.route ? 'page' : undefined}
                  onClick={() => {
                    setMore(false);
                    go(n.route);
                  }}
                >
                  {n.icon}
                  {t(`nav.${n.route}` as StringKey, lang)}
                </button>
              ))}
            </nav>
          </div>
        </>
      ) : null}
      {toast ? (
        <div className="toast" role="status">
          <LuCircleCheck aria-hidden />
          {toast}
        </div>
      ) : null}
    </NavContext.Provider>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
