import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { App as CapApp } from '@capacitor/app';
import { isNative } from './lib/storage';
import type { OrderItem } from './lib/types';

export type Tab = 'home' | 'orders' | 'customers' | 'calc' | 'more';

export type Route =
  | { name: 'order'; id: string }
  | { name: 'orderEdit'; id?: string; customerId?: string; prefill?: OrderItem }
  | { name: 'customer'; id: string }
  | { name: 'customerEdit'; id?: string }
  | { name: 'box'; id?: string; customerId?: string }
  | { name: 'boxes' }
  | { name: 'backup' }
  | { name: 'business' }
  | { name: 'company' }
  | { name: 'webPrices' }
  | { name: 'cloud' }
  | { name: 'team' }
  | { name: 'inbox' }
  | { name: 'products' }
  | { name: 'product'; id?: string }
  | { name: 'help' };

interface Nav {
  tab: Tab;
  stack: Route[];
  setTab: (t: Tab) => void;
  push: (r: Route) => void;
  replace: (r: Route) => void;
  back: () => void;
  /** Register a handler that intercepts the back button (e.g. to close a sheet). Return true if handled. */
  onBack: (fn: () => boolean) => () => void;
}

const Ctx = createContext<Nav | null>(null);

/** The website can be opened straight on the help / privacy page (…/#help, …/#privacy), e.g. for a link on Google's consent screen. */
function initialStack(): Route[] {
  if (isNative || typeof location === 'undefined') return [];
  return /^#(help|privacy)$/i.test(location.hash) ? [{ name: 'help' }] : [];
}

export function NavProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<Tab>('home');
  const [stack, setStack] = useState<Route[]>(initialStack);
  const interceptors = useRef<(() => boolean)[]>([]);
  const state = useRef({ tab, stack });
  state.current = { tab, stack };

  const setTab = useCallback((t: Tab) => {
    setStack([]);
    setTabState(t);
    window.scrollTo(0, 0);
  }, []);
  const push = useCallback((r: Route) => {
    setStack((s) => [...s, r]);
    window.scrollTo(0, 0);
  }, []);
  const replace = useCallback((r: Route) => setStack((s) => [...s.slice(0, -1), r]), []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);

  const onBack = useCallback((fn: () => boolean) => {
    interceptors.current.push(fn);
    return () => {
      interceptors.current = interceptors.current.filter((f) => f !== fn);
    };
  }, []);

  useEffect(() => {
    if (!isNative) return;
    const h = CapApp.addListener('backButton', () => {
      const ic = interceptors.current;
      for (let i = ic.length - 1; i >= 0; i--) if (ic[i]()) return;
      const { tab, stack } = state.current;
      if (stack.length) back();
      else if (tab !== 'home') setTab('home');
      else CapApp.minimizeApp();
    });
    return () => {
      h.then((x) => x.remove());
    };
  }, [back, setTab]);

  return <Ctx.Provider value={{ tab, stack, setTab, push, replace, back, onBack }}>{children}</Ctx.Provider>;
}

export function useNav() {
  const n = useContext(Ctx);
  if (!n) throw new Error('NavProvider missing');
  return n;
}
