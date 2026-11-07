import { useState } from 'react';
import { Box, Building2, Calculator, CircleHelp, Cloud, DatabaseBackup, Globe, Inbox as InboxIcon, Package, Plus, UserCog } from 'lucide-react';
import { setupProblems } from '@honeypackers/box-core/pricing';
import { usePerms, useStore } from '../store';
import { useNav } from '../nav';
import { specLabel } from '@honeypackers/box-core/calc';
import { timeAgo } from '../lib/format';
import type { AppData, Settings } from '../lib/types';
import type { CloudStatus } from '../lib/cloud/controller';
import { inbox } from '../lib/inbox';
import { Empty, Field, Header, List, NumInput, Page, Row, Section, Segmented, Fab } from '../ui';

function webSummary(w: AppData['web']): string {
  const left = setupProblems(w.rules).length;
  if (left) return `${left} thing${left > 1 ? 's' : ''} to fill in before prices show online`;
  return `${w.rules.grades.length} grade${w.rules.grades.length > 1 ? 's' : ''} · ${w.zones.length} delivery zone${w.zones.length === 1 ? '' : 's'}${w.showPrices ? '' : ' · prices hidden'}`;
}

function cloudSummary(s: CloudStatus): string {
  switch (s.phase) {
    case 'off':
      return 'Not set up yet';
    case 'signed-out':
      return 'Off · sign in to use on several phones';
    case 'no-business':
    case 'join':
      return 'Signed in · finish setting up';
    case 'ready':
      return s.syncing ? 'Syncing…' : s.pending ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to upload` : `On · ${s.orgName || 'synced'}`;
  }
}

const iconCls = 'grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary';

export function More() {
  const { data, updateSettings, cloudStatus } = useStore();
  const p = usePerms();
  const inboxCount = inbox(data).count;
  const nav = useNav();
  const { settings } = data;
  return (
    <>
      <Header title="More" large />
      <Page>
        <Section>
          <List>
            {p.inbox && (
              <Row
                onClick={() => nav.push({ name: 'inbox' })}
                icon={
                  <span className={iconCls}>
                    <InboxIcon size={20} />
                  </span>
                }
                title="Inbox"
                sub={inboxCount ? `${inboxCount} new from the website` : 'Website orders and enquiries'}
                right={inboxCount ? <span className="grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1.5 text-[12px] font-bold text-primary-foreground">{inboxCount}</span> : undefined}
              />
            )}
            {p.editOrders && (
              <Row
                onClick={() => nav.push({ name: 'boxes' })}
                icon={
                  <span className={iconCls}>
                    <Box size={20} />
                  </span>
                }
                title="Saved boxes"
                sub={`${data.boxes.length} saved`}
              />
            )}
            {p.ownerSettings && (
              <Row
                onClick={() => nav.push({ name: 'company' })}
                icon={
                  <span className={iconCls}>
                    <Building2 size={20} />
                  </span>
                }
                title="Company profile"
                sub={settings.businessName || 'Name, logo, GSTIN, bank — for invoices'}
              />
            )}
            {p.ownerSettings && (
              <Row
                onClick={() => nav.push({ name: 'business' })}
                icon={
                  <span className={iconCls}>
                    <Calculator size={20} />
                  </span>
                }
                title="Pricing defaults"
                sub={`Profit ${settings.defaults.profitPct}% · GST ${settings.defaults.taxPct}% · ${settings.currency}`}
              />
            )}
            {p.ownerSettings && (
              <Row
                onClick={() => nav.push({ name: 'webPrices' })}
                icon={
                  <span className={iconCls}>
                    <Globe size={20} />
                  </span>
                }
                title="Web price list"
                sub={webSummary(data.web)}
              />
            )}
            {p.ownerSettings && (
              <Row
                onClick={() => nav.push({ name: 'products' })}
                icon={
                  <span className={iconCls}>
                    <Package size={20} />
                  </span>
                }
                title="Products"
                sub={data.products.length ? `${data.products.filter((x) => x.active).length} on the website` : 'Standard boxes sold in packs online'}
              />
            )}
            <Row
              onClick={() => nav.push({ name: 'cloud' })}
              icon={
                <span className={iconCls}>
                  <Cloud size={20} />
                </span>
              }
              title="Cloud sync"
              sub={cloudSummary(cloudStatus)}
            />
            {p.team && cloudStatus.phase === 'ready' && (
              <Row
                onClick={() => nav.push({ name: 'team' })}
                icon={
                  <span className={iconCls}>
                    <UserCog size={20} />
                  </span>
                }
                title="Staff"
                sub="Invite people and choose what they see"
              />
            )}
            <Row
              onClick={() => nav.push({ name: 'backup' })}
              icon={
                <span className={iconCls}>
                  <DatabaseBackup size={20} />
                </span>
              }
              title="Backup & restore"
              sub={settings.lastBackupAt ? `Last backup ${timeAgo(settings.lastBackupAt)}` : 'Not backed up yet'}
            />
            <Row
              onClick={() => nav.push({ name: 'help' })}
              icon={
                <span className={iconCls}>
                  <CircleHelp size={20} />
                </span>
              }
              title="Help & FAQ"
              sub="Answers, backup tips and privacy"
            />
          </List>
        </Section>

        <Section title="Appearance">
          <div className="card p-4">
            <Segmented<Settings['theme']>
              value={settings.theme}
              onChange={(theme) => updateSettings({ theme })}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
          </div>
        </Section>

        <p className="px-2 text-center text-[12.5px] text-muted-foreground">
          BoxBook keeps all data on this phone only. There is no account and no server — so back up regularly.
        </p>
      </Page>
    </>
  );
}

export function BoxesList() {
  const { data } = useStore();
  const nav = useNav();
  const customers = new Map(data.customers.map((c) => [c.id, c]));
  const list = [...data.boxes].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <Header title="Saved boxes" subtitle={`${list.length} saved`} back />
      <Page>
        {list.length === 0 ? (
          <Empty
            icon={<Box size={28} />}
            title="No saved boxes"
            text="Save a box from the calculator to reuse its size, paper and price in orders."
            action={
              <button className="btn-primary" onClick={() => nav.push({ name: 'box' })}>
                <Plus size={18} /> New box
              </button>
            }
          />
        ) : (
          <List>
            {list.map((b) => (
              <Row
                key={b.id}
                onClick={() => nav.push({ name: 'box', id: b.id })}
                icon={<Box size={20} className="text-primary" />}
                title={b.name}
                sub={[specLabel(b.spec), customers.get(b.customerId || '')?.name].filter(Boolean).join(' · ')}
              />
            ))}
          </List>
        )}
      </Page>
      {list.length > 0 && <Fab label="Box" icon={<Plus size={20} />} onClick={() => nav.push({ name: 'box' })} />}
    </>
  );
}

export function Business() {
  const { data, updateSettings, toast } = useStore();
  const nav = useNav();
  const [s, setS] = useState<Settings>(data.settings);
  const text = (k: 'currency') => (e: { target: { value: string } }) => setS({ ...s, [k]: e.target.value });
  const setDef = (k: keyof Settings['defaults'], v: number) => setS({ ...s, defaults: { ...s.defaults, [k]: v } });

  const save = () => {
    updateSettings({
      currency: s.currency.trim() || '₹',
      defaults: s.defaults,
    });
    toast('Pricing defaults saved');
    nav.back();
  };

  return (
    <>
      <Header title="Pricing defaults" back />
      <Page>
        <Section title="Currency">
          <div className="card p-4">
            <Field label="Currency symbol">
              <input className="input" value={s.currency} onChange={text('currency')} maxLength={4} />
            </Field>
          </div>
        </Section>

        <Section title="Default pricing">
          <div className="card p-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Overhead">
                <NumInput value={s.defaults.overhead} onValue={(v) => setDef('overhead', v)} suffix={s.currency} />
              </Field>
              <Field label="Profit">
                <NumInput value={s.defaults.profitPct} onValue={(v) => setDef('profitPct', v)} suffix="%" />
              </Field>
              <Field label="GST">
                <NumInput value={s.defaults.taxPct} onValue={(v) => setDef('taxPct', v)} suffix="%" />
              </Field>
            </div>
            <p className="mt-3 text-[12.5px] text-muted-foreground">Used as the starting values in the calculator and for new orders.</p>
          </div>
        </Section>

        <button className="btn-primary w-full" onClick={save}>
          Save
        </button>
      </Page>
    </>
  );
}
