import { useMemo } from 'react';
import { AlertTriangle, Calculator, CheckCircle2, ClipboardList, Inbox as InboxIcon, ShieldCheck, UserPlus } from 'lucide-react';
import { usePerms, useStore } from '../store';
import { inbox } from '../lib/inbox';
import { useNav } from '../nav';
import { isOpen, orderTotals } from '@honeypackers/box-core/calc';
import { addDays, fmtDate, money0, relDays, timeAgo, todayISO } from '../lib/format';
import { Empty, Header, List, Page, Row, Section, Stat, StatusChip } from '../ui';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const { data } = useStore();
  const p = usePerms();
  const nav = useNav();
  const { settings } = data;
  const box = useMemo(() => inbox(data), [data]);
  const cur = settings.currency;
  const customers = useMemo(() => new Map(data.customers.map((c) => [c.id, c])), [data.customers]);

  const s = useMemo(() => {
    const today = todayISO();
    const weekEnd = addDays(today, 7);
    const month = today.slice(0, 7);
    const open = data.orders.filter(isOpen);
    let dues = 0;
    let sales = 0;
    let salesCount = 0;
    for (const o of data.orders) {
      if (o.status === 'cancelled' || o.status === 'quote') continue;
      const t = orderTotals(o);
      dues += Math.max(0, t.balance);
      if (o.date.startsWith(month)) {
        sales += t.total;
        salesCount++;
      }
    }
    const withDue = open.filter((o) => o.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return {
      active: open.length,
      dueWeek: withDue.filter((o) => o.dueDate >= today && o.dueDate <= weekEnd).length,
      overdue: withDue.filter((o) => o.dueDate < today).length,
      dues,
      sales,
      salesCount,
      upcoming: withDue.slice(0, 5),
      recent: [...data.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    };
  }, [data.orders]);

  const backupStale = !settings.lastBackupAt || Date.now() - new Date(settings.lastBackupAt).getTime() > 3 * 86400000;
  const hasData = data.customers.length + data.orders.length + data.boxes.length > 0;

  const orderRow = (id: string) => {
    const o = data.orders.find((x) => x.id === id)!;
    const c = customers.get(o.customerId);
    return { o, c, t: orderTotals(o) };
  };

  return (
    <>
      <Header title={settings.businessName || 'BoxBook'} subtitle={greeting()} large />
      <Page>
        {p.inbox && box.count > 0 && (
          <button onClick={() => nav.push({ name: 'inbox' })} className="mb-3 flex w-full items-center gap-3 rounded-2xl bg-primary px-4 py-3 text-left text-primary-foreground">
            <InboxIcon size={20} />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">
                {[box.orders.length && `${box.orders.length} new website order${box.orders.length > 1 ? 's' : ''}`, box.enquiries.filter((e) => e.status === 'new').length && `${box.enquiries.filter((e) => e.status === 'new').length} new enquir${box.enquiries.filter((e) => e.status === 'new').length > 1 ? 'ies' : 'y'}`].filter(Boolean).join(' · ')}
              </span>
              <span className="block truncate text-[12px] opacity-85">From honeypackers.in</span>
            </span>
            <span className="text-[13px] font-semibold">Open</span>
          </button>
        )}
        <button
          onClick={() => nav.push({ name: 'backup' })}
          className={`mb-5 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left ${backupStale && hasData ? 'bg-warn/15 text-warn' : 'bg-good/10 text-good'}`}
        >
          {backupStale && hasData ? <AlertTriangle size={20} /> : <ShieldCheck size={20} />}
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">{settings.lastBackupAt ? `Backed up ${timeAgo(settings.lastBackupAt)}` : 'No backup yet'}</span>
            <span className="block truncate text-[12px] opacity-80">
              {settings.lastBackupAt ? (settings.autoBackup ? 'Daily auto-backup is on' : 'Auto-backup is off') : 'Tap to back up your data'}
            </span>
          </span>
          <span className="text-[13px] font-semibold">Open</span>
        </button>

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Active orders" value={String(s.active)} sub={s.active ? 'confirmed → ready' : 'none right now'} tone="kraft" />
          <Stat label="Due this week" value={String(s.dueWeek)} sub={s.overdue ? `${s.overdue} overdue` : 'deliveries'} tone={s.overdue ? 'bad' : undefined} />
          <Stat label="Outstanding" value={money0(s.dues, cur)} sub="to collect" tone={s.dues > 0.5 ? 'bad' : 'good'} />
          <Stat label="This month" value={money0(s.sales, cur)} sub={`${s.salesCount} order${s.salesCount === 1 ? '' : 's'}`} />
        </div>

        <div className="mb-6 grid grid-cols-3 gap-3">
          <Action icon={<ClipboardList size={22} />} label="New order" onClick={() => nav.push({ name: 'orderEdit' })} primary />
          <Action icon={<Calculator size={22} />} label="Calculator" onClick={() => nav.setTab('calc')} />
          <Action icon={<UserPlus size={22} />} label="Customer" onClick={() => nav.push({ name: 'customerEdit' })} />
        </div>

        {!hasData && (
          <Empty icon={<CheckCircle2 size={28} />} title="Welcome to BoxBook" text="Everything you enter stays on this phone. Start by adding a customer or working out a box price in the calculator." />
        )}

        <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8">
        {s.upcoming.length > 0 && (
          <Section title="Upcoming deliveries">
            <List>
              {s.upcoming.map((o) => {
                const { c } = orderRow(o.id);
                const late = o.dueDate < todayISO();
                return (
                  <Row
                    key={o.id}
                    onClick={() => nav.push({ name: 'order', id: o.id })}
                    title={c?.name || 'Unknown customer'}
                    sub={`${o.number} · ${fmtDate(o.dueDate)}`}
                    right={<span className={`text-[13px] font-semibold ${late ? 'text-bad' : 'text-muted-foreground'}`}>{relDays(o.dueDate)}</span>}
                  />
                );
              })}
            </List>
          </Section>
        )}

        {s.recent.length > 0 && (
          <Section
            title="Recent orders"
            action={
              <button className="text-[14px] font-semibold text-primary" onClick={() => nav.setTab('orders')}>
                See all
              </button>
            }
          >
            <List>
              {s.recent.map((o) => {
                const { c, t } = orderRow(o.id);
                return (
                  <Row
                    key={o.id}
                    onClick={() => nav.push({ name: 'order', id: o.id })}
                    title={c?.name || 'Unknown customer'}
                    sub={`${o.number} · ${fmtDate(o.date)}`}
                    right={
                      <span className="flex flex-col items-end gap-1">
                        <span className="tnum text-[14px] font-semibold">{money0(t.total, cur)}</span>
                        <StatusChip s={o.status} />
                      </span>
                    }
                  />
                );
              })}
            </List>
          </Section>
        )}
        </div>
      </Page>
    </>
  );
}

function Action({ icon, label, onClick, primary }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1.5 rounded-2xl px-2 py-4 text-[13px] font-semibold active:scale-95 ${primary ? 'bg-primary text-white shadow-sm' : 'card text-foreground'}`}
    >
      {icon}
      {label}
    </button>
  );
}
