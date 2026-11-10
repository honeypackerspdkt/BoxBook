import type { ComponentType } from 'react';
import { Boxes, Calculator, Container, CircleHelp, ClipboardList, Cloud, DatabaseBackup, Globe, Home, Inbox as InboxIcon, Layers, Package, Settings as SettingsIcon, UserCog, Users } from 'lucide-react';
import { usePerms, useStore } from './store';
import { tabsFor, type Perms } from './lib/roles';
import { useNav, type Route, type Tab } from './nav';

type Item = { key: string; label: string; icon: ComponentType<{ className?: string }>; go: (nav: ReturnType<typeof useNav>) => void; show?: (p: Perms, cloudOn: boolean) => boolean };

const MAIN: Item[] = [
  { key: 'home', label: 'Home', icon: Home, go: (n) => n.setTab('home') },
  { key: 'orders', label: 'Orders', icon: ClipboardList, go: (n) => n.setTab('orders') },
  { key: 'customers', label: 'Customers', icon: Users, go: (n) => n.setTab('customers') },
  { key: 'calc', label: 'Calculator', icon: Calculator, go: (n) => n.setTab('calc') },
];

// Pages that live under "More" on a phone get their own entries on a desktop.
const open = (route: Route) => (n: ReturnType<typeof useNav>) => {
  n.setTab('more');
  n.push(route);
};
const LIBRARY: Item[] = [
  { key: 'inbox', label: 'Inbox', icon: InboxIcon, go: open({ name: 'inbox' }), show: (p) => p.inbox },
  { key: 'boxes', label: 'Saved boxes', icon: Boxes, go: open({ name: 'boxes' }), show: (p) => p.editOrders },
  { key: 'stock', label: 'Paper stock', icon: Layers, go: open({ name: 'stock' }), show: (p) => p.stock },
  { key: 'boxStock', label: 'Box stock', icon: Container, go: open({ name: 'boxStock' }), show: (p) => p.boxStock },
  { key: 'settings', label: 'App settings', icon: SettingsIcon, go: open({ name: 'settings' }) },
  { key: 'webPrices', label: 'Web price list', icon: Globe, go: open({ name: 'webPrices' }), show: (p) => p.ownerSettings },
  { key: 'products', label: 'Products', icon: Package, go: open({ name: 'products' }), show: (p) => p.ownerSettings },
  { key: 'cloud', label: 'Cloud sync', icon: Cloud, go: open({ name: 'cloud' }) },
  { key: 'team', label: 'Staff', icon: UserCog, go: open({ name: 'team' }), show: (p, on) => p.team && on },
  { key: 'backup', label: 'Backup & restore', icon: DatabaseBackup, go: open({ name: 'backup' }) },
  { key: 'help', label: 'Help & FAQ', icon: CircleHelp, go: open({ name: 'help' }) },
];

/** Which sidebar entry is highlighted for the page being shown. */
function activeKey(tab: Tab, top: Route | undefined): string {
  if (!top) return tab;
  switch (top.name) {
    case 'order':
    case 'orderEdit':
      return 'orders';
    case 'customer':
    case 'customerEdit':
      return 'customers';
    case 'box':
      return top.id ? 'boxes' : 'calc';
    case 'reel':
    case 'reelEdit':
      return 'stock';
    case 'product':
      return 'products';
    default:
      return top.name;
  }
}

function NavButton({ item, active, onClick }: { item: Item; active: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      data-slot="bottom-nav-tab"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14.5px] transition-colors ${
        active ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60'
      }`}
    >
      <Icon className={`size-[18px] shrink-0 ${active ? 'text-sidebar-primary' : ''}`} />
      {item.label}
    </button>
  );
}

/** Left sidebar shown on desktop-sized screens; phones and small tablets use the bottom bar instead. */
export function DesktopNav() {
  const nav = useNav();
  const { data, cloudStatus } = useStore();
  const p = usePerms();
  const tabs = tabsFor(p.role);
  const cloudOn = cloudStatus.phase === 'ready';
  const current = activeKey(nav.tab, nav.stack[nav.stack.length - 1]);
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex items-center gap-3 px-5 pb-4 pt-6">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="size-9 rounded-xl" />
        <div className="min-w-0">
          <div className="truncate text-[17px] font-bold leading-tight">BoxBook</div>
          {data.settings.businessName && <div className="truncate text-[12px] opacity-75">{data.settings.businessName}</div>}
        </div>
      </div>
      <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {MAIN.filter((it) => tabs.includes(it.key as Tab)).map((it) => (
          <NavButton key={it.key} item={it} active={current === it.key} onClick={() => it.go(nav)} />
        ))}
        <div className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider opacity-70">Library</div>
        {LIBRARY.filter((it) => !it.show || it.show(p, cloudOn)).map((it) => (
          <NavButton key={it.key} item={it} active={current === it.key} onClick={() => it.go(nav)} />
        ))}
      </nav>
      <p className="px-5 pb-5 pt-3 text-[12px] leading-snug opacity-70">{cloudStatus.phase === 'ready' ? `Synced with the cloud${cloudStatus.orgName ? ` (${cloudStatus.orgName})` : ''}.` : 'Your data stays on this device. Back it up regularly.'}</p>
    </aside>
  );
}
