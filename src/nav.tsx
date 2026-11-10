import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { App as CapApp } from '@capacitor/app';
import { ChevronLeft } from 'lucide-react';
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
  | { name: 'settings'; section?: string }
  | { name: 'stock' }
  | { name: 'boxStock' }
  | { name: 'boxStockItem'; id: string }
  | { name: 'reel'; id: string }
  | { name: 'reelEdit'; id?: string; width?: number; bf?: number; gsm?: number }
  | { name: 'webPrices' }
  | { name: 'cloud' }
  | { name: 'team' }
  | { name: 'member'; id: string }
  | { name: 'invite' }
  | { name: 'inbox' }
  | { name: 'enquiry'; id: string }
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
  /** Same as the phone's back button: closes an open sheet first, else goes back one page. False when there is nowhere to go. */
  goBack: () => boolean;
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

  const goBack = useCallback(() => {
    const ic = interceptors.current;
    for (let i = ic.length - 1; i >= 0; i--) if (ic[i]()) return true;
    if (state.current.stack.length) {
      back();
      return true;
    }
    return false;
  }, [back]);

  useEffect(() => {
    if (!isNative) return;
    const h = CapApp.addListener('backButton', () => {
      if (goBack()) return;
      if (state.current.tab !== 'home') setTab('home');
      else CapApp.minimizeApp();
    });
    return () => {
      h.then((x) => x.remove());
    };
  }, [goBack, setTab]);

  // Swipe in from the left edge to go back (phones and touch screens; Android's own back gesture is handled above).
  const hint = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let start: { x: number; y: number; t: number } | null = null;
    const show = (p: number) => {
      const el = hint.current;
      if (!el) return;
      el.style.opacity = p > 0 ? String(Math.min(1, p * 1.4)) : '0';
      el.style.transform = `translate(${Math.round(Math.min(1, p) * 44) - 40}px, -50%) scale(${0.8 + Math.min(1, p) * 0.2})`;
    };
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      const tag = (e.target as HTMLElement | null)?.tagName;
      start = e.touches.length === 1 && t.clientX <= 24 && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && state.current.stack.length > 0 ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      if (dy > 60 && dy > dx) {
        start = null;
        show(0);
        return;
      }
      show(dx / 90);
    };
    const onEnd = (e: TouchEvent) => {
      const s0 = start;
      start = null;
      show(0);
      if (!s0) return;
      const t = e.changedTouches[0];
      if (t.clientX - s0.x >= 80 && Math.abs(t.clientY - s0.y) <= 60 && Date.now() - s0.t < 900) goBack();
    };
    const onCancel = () => {
      start = null;
      show(0);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onCancel);
    };
  }, [goBack]);

  return (
    <Ctx.Provider value={{ tab, stack, setTab, push, replace, back, goBack, onBack }}>
      {children}
      <div
        ref={hint}
        aria-hidden
        className="pointer-events-none fixed left-0 top-1/2 z-[60] grid h-11 w-11 place-items-center rounded-full bg-foreground/80 text-background shadow-lift"
        style={{ opacity: 0, transform: 'translate(-40px, -50%)' }}
      >
        <ChevronLeft size={22} />
      </div>
    </Ctx.Provider>
  );
}

export function useNav() {
  const n = useContext(Ctx);
  if (!n) throw new Error('NavProvider missing');
  return n;
}
