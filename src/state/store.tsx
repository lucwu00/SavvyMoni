import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { marketFor, type MarketConfig } from '../config/markets';
import { todayIn, type ISODate } from '../domain/dates';
import { computeRecommendation, type Recommendation } from '../domain/engine';
import { setActiveCurrency } from '../domain/money';
import type { AppState } from '../domain/types';
import { switchCountry, type DemoMarket } from './country';
import { clearState, getBrowserStorage, loadState, saveState } from './persistence';
import { initialState, reducer, type Action } from './reducer';

interface Store {
  state: AppState;
  rec: Recommendation;
  market: MarketConfig;
  today: ISODate;
  dispatch: (a: Action) => void;
  notify: (message: string) => void;
  setCountry: (m: DemoMarket) => void;
  toast: string | null;
  persistent: boolean;
}

const Ctx = createContext<Store | null>(null);

const todayFor = (s: AppState) => todayIn(marketFor(s.marketCode).timeZone);

export function StoreProvider({ children }: { children: ReactNode }) {
  const storage = useMemo(getBrowserStorage, []);
  const [state, setState] = useState<AppState>(() => loadState(storage) ?? initialState());
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const market = marketFor(state.marketCode);
  // Components format money in the active country's currency.
  setActiveCurrency(market.currency);
  const today = todayFor(state);

  const dispatch = useCallback(
    (a: Action) => {
      if (a.type === 'RESET') clearState(storage);
      setState((s) => reducer(s, a, todayFor(s)));
    },
    [storage],
  );
  const setCountry = useCallback((m: DemoMarket) => setState((s) => switchCountry(s, m, storage, todayIn(marketFor(m).timeZone))), [storage]);
  const notify = useCallback((message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    saveState(storage, state);
  }, [storage, state]);

  const rec = useMemo(() => computeRecommendation(state, today), [state, today]);
  const value = useMemo(
    () => ({ state, rec, market, today, dispatch, notify, setCountry, toast, persistent: !!storage }),
    [state, rec, market, today, dispatch, notify, setCountry, toast, storage],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside StoreProvider');
  return v;
}

/** Network and offline-readiness status for the connectivity indicator. */
export function useConnectivity(): { online: boolean; offlineReady: boolean } {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [offlineReady, setReady] = useState(() => typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const sw = navigator.serviceWorker;
    const ready = () => setReady(!!sw?.controller);
    sw?.addEventListener?.('controllerchange', ready);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      sw?.removeEventListener?.('controllerchange', ready);
    };
  }, []);
  return { online, offlineReady };
}

/* Hash router: #planner etc. Bare tokens so deep links work everywhere. */
export type Route =
  | 'overview'
  | 'cashbook'
  | 'finances'
  | 'planner'
  | 'simulator'
  | 'recovery'
  | 'insights'
  | 'integrations'
  | 'benchmark'
  | 'asean'
  | 'assistant'
  | 'settings';

export const ROUTES: Route[] = ['overview', 'cashbook', 'finances', 'planner', 'simulator', 'recovery', 'insights', 'integrations', 'benchmark', 'asean', 'assistant', 'settings'];

function readRoute(): Route {
  const h = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#\/?/, '').split(/[?/]/)[0];
  return (ROUTES as string[]).includes(h) ? (h as Route) : 'overview';
}

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((r: Route) => {
    if (readRoute() !== r) window.location.hash = r;
    setRoute(r);
    try {
      window.scrollTo({ top: 0 });
    } catch {
      /* ignore */
    }
  }, []);
  return [route, go];
}

export const NavContext = createContext<(r: Route) => void>(() => {});
export const useNavigate = () => useContext(NavContext);
