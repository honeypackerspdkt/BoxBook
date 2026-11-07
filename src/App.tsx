import { useEffect } from 'react';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Calculator as CalcIcon, ClipboardList, Home as HomeIcon, Menu, Users } from 'lucide-react';
import { toast } from 'sonner';
import { BottomNav, BrandProvider, Toaster, type BottomNavItem } from '@rajesh-hub/ui';
import { StoreProvider, usePerms, useStore } from './store';
import { tabsFor } from './lib/roles';
import { NavProvider, useNav, type Route, type Tab } from './nav';
import { isNative } from './lib/storage';
import { Home } from './screens/Home';
import { OrderDetail, OrderEdit, OrdersList } from './screens/Orders';
import { CustomerDetail, CustomerEdit, CustomersList } from './screens/Customers';
import { Calculator } from './screens/Calculator';
import { BoxesList, Business, More } from './screens/More';
import { Company } from './screens/Company';
import { WebPrices } from './screens/WebPrices';
import { CloudSync } from './screens/Cloud';
import { Team } from './screens/Team';
import { Inbox } from './screens/Inbox';
import { ProductEdit, ProductsList } from './screens/Products';
import { Help } from './screens/Help';
import { Backup } from './screens/Backup';
import { DesktopNav } from './DesktopNav';

const TABS: (BottomNavItem & { key: Tab })[] = [
  { key: 'home', label: 'Home', icon: HomeIcon },
  { key: 'orders', label: 'Orders', icon: ClipboardList },
  { key: 'customers', label: 'Customers', icon: Users },
  { key: 'calc', label: 'Calculator', icon: CalcIcon },
  { key: 'more', label: 'More', icon: Menu },
];

function useTheme(theme: 'system' | 'light' | 'dark') {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
      // Status-bar colour follows the hub background token rather than a hard-coded hex.
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getComputedStyle(document.body).backgroundColor);
      if (isNative) StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function renderRoute(r: Route) {
  switch (r.name) {
    case 'order':
      return <OrderDetail id={r.id} />;
    case 'orderEdit':
      return <OrderEdit id={r.id} customerId={r.customerId} prefill={r.prefill} />;
    case 'customer':
      return <CustomerDetail id={r.id} />;
    case 'customerEdit':
      return <CustomerEdit id={r.id} />;
    case 'box':
      return <Calculator boxId={r.id} customerId={r.customerId} />;
    case 'boxes':
      return <BoxesList />;
    case 'backup':
      return <Backup />;
    case 'business':
      return <Business />;
    case 'company':
      return <Company />;
    case 'webPrices':
      return <WebPrices />;
    case 'cloud':
      return <CloudSync />;
    case 'team':
      return <Team />;
    case 'inbox':
      return <Inbox />;
    case 'products':
      return <ProductsList />;
    case 'product':
      return <ProductEdit id={r.id} />;
    case 'help':
      return <Help />;
  }
}

function renderTab(t: Tab) {
  switch (t) {
    case 'home':
      return <Home />;
    case 'orders':
      return <OrdersList />;
    case 'customers':
      return <CustomersList />;
    case 'calc':
      return <Calculator />;
    case 'more':
      return <More />;
  }
}

function Shell() {
  const { ready, data, toastMsg } = useStore();
  const { role } = usePerms();
  const allowed = tabsFor(role);
  useEffect(() => {
    if (toastMsg) toast(toastMsg);
  }, [toastMsg]);
  const nav = useNav();
  useTheme(data.settings.theme);
  // A staff role without this tab (e.g. Production has no Home): go to its first tab.
  useEffect(() => {
    if (ready && !allowed.includes(nav.tab)) nav.setTab(allowed[0]);
  }, [ready, allowed, nav]);

  if (!ready) {
    return (
      <div className="grid h-full place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-border border-t-primary" role="status" aria-label="Loading" />
      </div>
    );
  }

  const top = nav.stack[nav.stack.length - 1];
  const routeKey = top ? `${nav.stack.length}-${top.name}-${'id' in top ? top.id ?? '' : ''}` : nav.tab;

  return (
    <>
      <DesktopNav />
      <div key={routeKey} className={`lg:pl-64 ${top ? 'anim-page' : 'anim-fade'}`}>
        {top ? renderRoute(top) : renderTab(nav.tab)}
      </div>

      <BottomNav className="lg:hidden" items={TABS.filter((t) => allowed.includes(t.key))} active={nav.tab} onSelect={(k) => nav.setTab(k as Tab)} />
      <Toaster position="top-center" theme={data.settings.theme} />
    </>
  );
}

function BrandBoundary() {
  const { data } = useStore();
  return (
    <BrandProvider value={{ companyName: data.settings.businessName || 'BoxBook', companyLogo: null }}>
      <Shell />
    </BrandProvider>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <NavProvider>
        <BrandBoundary />
      </NavProvider>
    </StoreProvider>
  );
}
