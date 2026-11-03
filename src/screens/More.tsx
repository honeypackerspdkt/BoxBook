import { useState } from 'react';
import { Box, Building2, Calculator, CircleHelp, DatabaseBackup, Plus } from 'lucide-react';
import { useStore } from '../store';
import { useNav } from '../nav';
import { specLabel } from '../lib/calc';
import { timeAgo } from '../lib/format';
import type { Settings } from '../lib/types';
import { Empty, Field, Header, List, NumInput, Page, Row, Section, Segmented, Fab } from '../ui';

const iconCls = 'grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary';

export function More() {
  const { data, updateSettings } = useStore();
  const nav = useNav();
  const { settings } = data;
  return (
    <>
      <Header title="More" large />
      <Page>
        <Section>
          <List>
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
