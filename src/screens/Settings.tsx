import { useEffect, useRef, useState, type ChangeEvent, type ComponentType, type ReactNode } from 'react';
import { Building2, Calculator, ChevronRight, CircleHelp, DatabaseBackup, FileText, ImagePlus, Layers, ListChecks, Palette, Plus, Trash2, X } from 'lucide-react';
import { usePerms, useStore } from '../store';
import { useNav } from '../nav';
import { GST_STATES, stateFromGstin } from '@honeypackers/box-core/gst';
import { logoFromFile } from '../lib/image';
import { fmtDateTime, num } from '../lib/format';
import { gradeFromKey, gradeKey, gradeLabel, stockByGrade } from '../lib/stock';
import type { Settings } from '../lib/types';
import { Confirm, Field, Header, List, NumInput, Page, Row, Segmented, Sheet, Toggle } from '../ui';

/**
 * App settings: every predefined value of the app, one section per page.
 * Phone: a list of sections; tap one to open it (swipe from the left edge or press back to return); no tabs.
 * Computer: tabs at the top, no list.
 * Typed fields are saved with the Save bar (one draft across all sections); switches, chips and lists apply at once.
 */

// What the Save bar covers: the typed fields.
type FormKeys =
  | 'businessName' | 'businessTagline' | 'businessAddress' | 'businessPhone' | 'businessEmail' | 'businessGstin' | 'businessState' | 'businessLogo'
  | 'bankHolder' | 'bankName' | 'bankAccount' | 'bankBranch' | 'bankIfsc'
  | 'invoicePrefix' | 'nextInvoiceNo' | 'defaultHsn' | 'defaultUnit' | 'invoiceDeclaration'
  | 'currency' | 'defaults' | 'stockWastePct';
type Form = Pick<Settings, FormKeys>;
type TextKey = { [K in FormKeys]: Form[K] extends string ? K : never }[FormKeys];

const FORM_KEYS: FormKeys[] = [
  'businessName', 'businessTagline', 'businessAddress', 'businessPhone', 'businessEmail', 'businessGstin', 'businessState', 'businessLogo',
  'bankHolder', 'bankName', 'bankAccount', 'bankBranch', 'bankIfsc',
  'invoicePrefix', 'nextInvoiceNo', 'defaultHsn', 'defaultUnit', 'invoiceDeclaration',
  'currency', 'defaults', 'stockWastePct',
];
const pick = (s: Settings): Form => Object.fromEntries(FORM_KEYS.map((k) => [k, s[k]])) as unknown as Form;

type SectionId = 'company' | 'invoice' | 'pricing' | 'stock' | 'lists' | 'backup' | 'appearance';
const THEME_LABEL: Record<Settings['theme'], string> = { system: 'Follows your phone', light: 'Light', dark: 'Dark' };
const SECTIONS: { id: SectionId; label: string; icon: ComponentType<{ size?: number; className?: string }>; summary: (s: Settings) => string }[] = [
  { id: 'company', label: 'Business', icon: Building2, summary: (s) => s.businessName || 'Name, logo, GSTIN, address' },
  { id: 'invoice', label: 'Invoice & bank', icon: FileText, summary: (s) => (s.bankName ? `${s.bankName} · next invoice ${s.invoicePrefix}${s.nextInvoiceNo}` : 'Bank details and invoice numbering') },
  { id: 'pricing', label: 'Pricing', icon: Calculator, summary: (s) => `Profit ${s.defaults.profitPct}% · GST ${s.defaults.taxPct}% · ${s.currency}` },
  {
    id: 'stock',
    label: 'Paper stock',
    icon: Layers,
    summary: (s) => {
      const sizes = (s.reelWidths || []).length;
      const levels = Object.values(s.stockMin || {}).filter((v) => v > 0).length;
      return `${s.autoIssue ? 'Auto-issue on' : 'Auto-issue off'} · ${sizes} ${sizes === 1 ? 'size' : 'sizes'} · ${levels} ${levels === 1 ? 'level' : 'levels'}`;
    },
  },
  { id: 'lists', label: 'Lists', icon: ListChecks, summary: (s) => { const n = (s.payModes || []).length; return `${n} payment ${n === 1 ? 'method' : 'methods'}`; } },
  { id: 'backup', label: 'Backup', icon: DatabaseBackup, summary: (s) => (s.autoBackup ? `Daily backup on · keep ${s.keepBackups} days` : 'Daily backup off') },
  { id: 'appearance', label: 'Appearance', icon: Palette, summary: (s) => THEME_LABEL[s.theme] },
];
/** Company, invoice, pricing, paper rules and lists are shared by everyone and changed by the owner; backup and appearance belong to this device. */
const OWNER_ONLY = new Set<SectionId>(['company', 'invoice', 'pricing', 'stock', 'lists']);
const iconBox = 'grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary';

const kg = (n: number) => `${num(n, 1)} kg`;

/** True on a computer-sized screen, where sections are tabs only (no list page). */
function useIsDesktop() {
  const q = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

function Panel({ desc, children }: { desc?: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      {desc && <p className="mb-3 px-1 text-[13px] leading-snug text-muted-foreground">{desc}</p>}
      <div className="card space-y-4 p-4">{children}</div>
    </section>
  );
}

/** Add / remove values shown as chips. Changes apply immediately. */
function ChipList({ values, onAdd, onRemove, placeholder, numeric, suffix, label }: { values: string[]; onAdd: (v: string) => void; onRemove: (v: string) => void; placeholder: string; numeric?: boolean; suffix?: string; label: string }) {
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText('');
  };
  return (
    <div className="space-y-3">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-primary/12 py-1 pl-3 pr-1 text-[14px] font-semibold text-primary">
              {v}
              {suffix ? ` ${suffix}` : ''}
              <button type="button" aria-label={`Remove ${v}`} className="grid h-6 w-6 place-items-center rounded-full active:bg-primary/20" onClick={() => onRemove(v)}>
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          className="input flex-1"
          aria-label={label}
          inputMode={numeric ? 'numeric' : 'text'}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn-ghost !px-4" disabled={!text.trim()} onClick={add}>
          <Plus size={18} /> Add
        </button>
      </div>
    </div>
  );
}

export function SettingsPage({ section }: { section?: string }) {
  const { data, updateSettings, toast } = useStore();
  const nav = useNav();
  const wide = useIsDesktop();
  const s = data.settings;
  const perm = usePerms();
  const sections = SECTIONS.filter((x) => perm.ownerSettings || !OWNER_ONLY.has(x.id));
  const [f, setF] = useState<Form>(() => pick(s));
  const [leave, setLeave] = useState(false);
  const [levelSheet, setLevelSheet] = useState<{ key?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // phones open on the list of sections; computers always show a section (the first by default)
  const asked = sections.find((x) => x.id === section);
  const active: SectionId | null = asked ? asked.id : wide ? sections[0].id : null;
  const meta = sections.find((x) => x.id === active);

  const dirty = JSON.stringify(f) !== JSON.stringify(pick(s));
  const text = (k: TextKey) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  // the phone's back button and the edge swipe ask before throwing typed changes away
  useEffect(() => {
    if (!dirty) return;
    return nav.onBack(() => {
      setLeave(true);
      return true;
    });
  }, [dirty, nav]);

  // keep the chosen tab in view
  useEffect(() => {
    if (active) tabRefs.current[active]?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [active]);

  const openTab = (id: SectionId) => {
    nav.replace({ name: 'settings', section: id });
    window.scrollTo(0, 0);
  };

  const setGstin = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.toUpperCase();
    const st = stateFromGstin(v);
    setF((x) => ({ ...x, businessGstin: v, businessState: st || x.businessState }));
  };
  const setDef = (k: keyof Settings['defaults'], v: number) => setF((x) => ({ ...x, defaults: { ...x.defaults, [k]: v } }));

  const pickLogo = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const logo = await logoFromFile(file);
      setF((x) => ({ ...x, businessLogo: logo }));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read that image');
    }
  };

  const save = () => {
    const next: Partial<Settings> = {
      businessName: f.businessName.trim(),
      businessTagline: f.businessTagline.trim(),
      businessAddress: f.businessAddress.trim(),
      businessPhone: f.businessPhone.trim(),
      businessEmail: f.businessEmail.trim(),
      businessGstin: f.businessGstin.trim().toUpperCase(),
      businessState: f.businessState,
      businessLogo: f.businessLogo,
      bankHolder: f.bankHolder.trim(),
      bankName: f.bankName.trim(),
      bankAccount: f.bankAccount.trim(),
      bankBranch: f.bankBranch.trim(),
      bankIfsc: f.bankIfsc.trim().toUpperCase(),
      invoicePrefix: f.invoicePrefix.trim(),
      nextInvoiceNo: Math.max(1, Math.floor(f.nextInvoiceNo) || 1),
      defaultHsn: f.defaultHsn.trim(),
      defaultUnit: f.defaultUnit.trim() || 'Nos.',
      invoiceDeclaration: f.invoiceDeclaration.trim(),
      currency: f.currency.trim() || '₹',
      defaults: f.defaults,
      stockWastePct: Math.max(0, f.stockWastePct || 0),
    };
    updateSettings(next);
    setF(pick({ ...s, ...next })); // show the trimmed values and clear the Save bar
    toast('Settings saved');
  };

  const widths = s.reelWidths || [];
  const levels = Object.entries(s.stockMin || {}).filter(([, v]) => v > 0);
  const haveKg = new Map(stockByGrade(data.reels, data.stockMoves).map((g) => [g.key, g.kg]));
  const payModes = s.payModes || [];

  const askLeave = () => (dirty ? setLeave(true) : nav.back());

  // ---------- list of sections (phone) ----------
  if (!active || !meta) {
    return (
      <>
        <Header title="App settings" subtitle="Choose what to set up" back />
        <Page>
          <List>
            {sections.map(({ id, label, icon: Icon, summary }) => (
              <Row key={id} onClick={() => nav.push({ name: 'settings', section: id })} icon={<span className={iconBox}><Icon size={20} /></span>} title={label} sub={summary(s)} />
            ))}
          </List>
          <div className="mt-5">
            <List>
              <Row onClick={() => nav.push({ name: 'help' })} icon={<span className={iconBox}><CircleHelp size={20} /></span>} title="Help & FAQ" sub="Answers, backup tips and privacy" />
            </List>
          </div>
        </Page>
      </>
    );
  }

  // ---------- one section ----------
  return (
    <>
      <Header title={wide ? 'App settings' : meta.label} subtitle={wide ? meta.label : 'App settings'} back onBack={askLeave} />
      <Page>
        {/* computers only: on a phone the list page is the menu */}
        <div className="mb-5 hidden gap-2 overflow-x-auto pb-1 lg:flex" role="tablist" aria-label="Settings sections">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              type="button"
              role="tab"
              aria-selected={id === active}
              onClick={() => id !== active && openTab(id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13.5px] font-semibold transition ${id === active ? 'border-primary bg-primary text-white' : 'border-border bg-card active:bg-muted'}`}
            >
              <Icon size={15} className={id === active ? '' : 'text-primary'} /> {label}
            </button>
          ))}
        </div>

        <div className="lg:mx-auto lg:max-w-2xl" role="tabpanel">
          {active === 'company' && (
            <Panel desc="Printed at the top of every invoice. The logo is kept inside your backups.">
              <div className="flex items-center gap-4">
                <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-card">
                  {f.businessLogo ? <img src={f.businessLogo} alt="Company logo" className="max-h-full max-w-full object-contain" /> : <ImagePlus size={28} className="text-muted-foreground" />}
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-ghost !px-3 !py-2 text-[14px]" onClick={() => fileRef.current?.click()}>
                    <ImagePlus size={16} /> {f.businessLogo ? 'Change logo' : 'Add logo'}
                  </button>
                  {f.businessLogo && (
                    <button type="button" className="btn-danger !px-3 !py-2" aria-label="Remove logo" onClick={() => setF((x) => ({ ...x, businessLogo: '' }))}>
                      <Trash2 size={16} />
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickLogo} />
                </div>
              </div>
              <Field label="Company name">
                <input className="input" value={f.businessName} onChange={text('businessName')} placeholder="HONEY PACKERS" />
              </Field>
              <Field label="Tagline (optional)" hint="Printed under the address, e.g. an ISO certification line.">
                <input className="input" value={f.businessTagline} onChange={text('businessTagline')} placeholder="An ISO 9001 : 2015 Certified Company" />
              </Field>
              <Field label="Address">
                <textarea className="input min-h-[88px]" value={f.businessAddress} onChange={text('businessAddress')} placeholder={'845, Valayampatty, Thirumayam (TK)\nPudukkottai - 622506'} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mobile">
                  <input className="input" type="tel" inputMode="tel" value={f.businessPhone} onChange={text('businessPhone')} />
                </Field>
                <Field label="E-mail">
                  <input className="input" type="email" inputMode="email" value={f.businessEmail} onChange={text('businessEmail')} />
                </Field>
                <Field label="GSTIN">
                  <input className="input uppercase" value={f.businessGstin} onChange={setGstin} maxLength={15} />
                </Field>
                <Field label="State">
                  <select className="input" value={f.businessState} onChange={(e) => setF({ ...f, businessState: e.target.value })}>
                    <option value="">— Select —</option>
                    {Object.entries(GST_STATES).map(([code, name]) => (
                      <option key={code} value={code}>
                        {name} ({code})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </Panel>
          )}

          {active === 'invoice' && (
            <Panel desc="Bank details and numbering for the GST tax invoice PDF.">
              <Field label="Account holder">
                <input className="input" value={f.bankHolder} onChange={text('bankHolder')} placeholder={f.businessName || 'Same as company name'} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Bank name">
                  <input className="input" value={f.bankName} onChange={text('bankName')} />
                </Field>
                <Field label="A/c number">
                  <input className="input" inputMode="numeric" value={f.bankAccount} onChange={text('bankAccount')} />
                </Field>
                <Field label="Branch">
                  <input className="input" value={f.bankBranch} onChange={text('bankBranch')} />
                </Field>
                <Field label="IFSC">
                  <input className="input uppercase" value={f.bankIfsc} onChange={text('bankIfsc')} maxLength={11} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-4">
                <Field label="Invoice prefix" hint="Optional, e.g. HP/">
                  <input className="input" value={f.invoicePrefix} onChange={text('invoicePrefix')} />
                </Field>
                <Field label="Next invoice no.">
                  <NumInput value={f.nextInvoiceNo} onValue={(v) => setF((x) => ({ ...x, nextInvoiceNo: v }))} />
                </Field>
                <Field label="Default HSN / SAC">
                  <input className="input" inputMode="numeric" value={f.defaultHsn} onChange={text('defaultHsn')} />
                </Field>
                <Field label="Default unit">
                  <input className="input" value={f.defaultUnit} onChange={text('defaultUnit')} />
                </Field>
              </div>
              <Field label="Declaration">
                <textarea className="input min-h-[88px]" value={f.invoiceDeclaration} onChange={text('invoiceDeclaration')} />
              </Field>
            </Panel>
          )}

          {active === 'pricing' && (
            <Panel desc="Starting values in the calculator and for new orders.">
              <Field label="Currency symbol">
                <input className="input" value={f.currency} onChange={text('currency')} maxLength={4} />
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Overhead / box">
                  <NumInput value={f.defaults.overhead} onValue={(v) => setDef('overhead', v)} suffix={f.currency} />
                </Field>
                <Field label="Profit">
                  <NumInput value={f.defaults.profitPct} onValue={(v) => setDef('profitPct', v)} suffix="%" />
                </Field>
                <Field label="GST">
                  <NumInput value={f.defaults.taxPct} onValue={(v) => setDef('taxPct', v)} suffix="%" />
                </Field>
              </div>
            </Panel>
          )}

          {active === 'stock' && (
            <Panel desc="How reels are planned, bought and issued.">
              <Toggle checked={s.autoIssue} onChange={(v) => updateSettings({ autoIssue: v })} label="Issue paper automatically" desc="When an order is confirmed, take its paper from the reels if all of it is in stock. If not, you are told what is short and nothing is taken for that grade." />
              <Field label="Extra paper to plan for" hint="Added to the calculated need on every order for start-up waste and spoilage. Side trim from the reel width is worked out separately.">
                <NumInput value={f.stockWastePct} onValue={(v) => setF((x) => ({ ...x, stockWastePct: v }))} suffix="%" />
              </Field>
              <div className="border-t border-border/60 pt-4">
                <span className="label">Common reel sizes</span>
                <p className="mb-3 text-[12.5px] text-muted-foreground">The widths you usually buy. Offered when you add a reel; “By reel size” in Paper stock shows what you hold and bought at each.</p>
                <ChipList
                  label="New reel size in mm"
                  values={widths.map(String)}
                  suffix="mm"
                  numeric
                  placeholder="e.g. 1200"
                  onAdd={(v) => {
                    const w = Math.round(Number(v));
                    if (w > 0 && !widths.includes(w)) updateSettings({ reelWidths: [...widths, w].sort((a, b) => a - b) });
                  }}
                  onRemove={(v) => updateSettings({ reelWidths: widths.filter((w) => String(w) !== v) })}
                />
              </div>
              <div className="border-t border-border/60 pt-4">
                <div className="flex items-end justify-between">
                  <span className="label !mb-0">Reorder levels</span>
                  <button type="button" className="text-[14px] font-semibold text-primary" onClick={() => setLevelSheet({})}>
                    + Add level
                  </button>
                </div>
                <p className="mb-3 mt-1 text-[12.5px] text-muted-foreground">The least paper to keep for each grade. Below it you get a “Time to buy paper” card on Home and in Paper stock.</p>
                {levels.length === 0 ? (
                  <p className="rounded-xl bg-muted/60 p-3 text-center text-[13.5px] text-muted-foreground">No levels set.</p>
                ) : (
                  <List>
                    {levels.map(([key, min]) => {
                      const have = haveKg.get(key) ?? 0;
                      const { gsm, bf } = gradeFromKey(key);
                      return <Row key={key} onClick={() => setLevelSheet({ key })} title={gradeLabel(gsm, bf)} sub={`Keep at least ${kg(min)} · have ${kg(have)}`} right={have < min ? <span className="chip bg-bad/12 text-bad">Low</span> : undefined} />;
                    })}
                  </List>
                )}
              </div>
            </Panel>
          )}

          {active === 'lists' && (
            <Panel desc="Choices offered while you work.">
              <div>
                <span className="label">Payment methods</span>
                <ChipList
                  label="New payment method"
                  values={payModes}
                  placeholder="e.g. Google Pay"
                  onAdd={(v) => {
                    if (!payModes.some((m) => m.toLowerCase() === v.toLowerCase())) updateSettings({ payModes: [...payModes, v] });
                  }}
                  onRemove={(v) => {
                    if (payModes.length > 1) updateSettings({ payModes: payModes.filter((m) => m !== v) });
                    else toast('Keep at least one payment method');
                  }}
                />
              </div>
            </Panel>
          )}

          {active === 'backup' && (
            <Panel desc="Backups hold everything, including these settings and your logo.">
              <Toggle checked={s.autoBackup} onChange={(v) => updateSettings({ autoBackup: v })} label="Daily backup" desc="A copy is saved once a day when you open the app." />
              {s.autoBackup && (
                <div>
                  <span className="label">Keep last</span>
                  <Segmented<number> value={s.keepBackups} onChange={(n) => updateSettings({ keepBackups: n })} options={[7, 14, 30].map((n) => ({ value: n, label: `${n} days` }))} />
                </div>
              )}
              <List>
                <Row
                  onClick={() => nav.push({ name: 'backup' })}
                  title="Backup & restore"
                  sub={s.lastBackupAt ? `Last backup ${fmtDateTime(s.lastBackupAt)}` : 'Back up now, restore, Google Drive'}
                  right={<ChevronRight size={18} className="text-muted-foreground" />}
                  chevron={false}
                />
              </List>
            </Panel>
          )}

          {active === 'appearance' && (
            <Panel>
              <Segmented<Settings['theme']>
                value={s.theme}
                onChange={(theme) => updateSettings({ theme })}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
              <List>
                <Row onClick={() => nav.push({ name: 'help' })} icon={<CircleHelp size={20} className="text-primary" />} title="Help & FAQ" sub="Answers, backup tips and privacy" />
              </List>
            </Panel>
          )}
        </div>

        <p className="px-2 pb-2 text-center text-[12.5px] text-muted-foreground">Switches, lists and chips apply straight away. Typed fields are saved with the Save button.</p>
        {dirty && <div className="h-24" />}
      </Page>

      {dirty && (
        <div className="fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-30 px-4 lg:bottom-6 lg:left-64">
          <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-lift lg:max-w-5xl">
            <span className="min-w-0 flex-1 text-[14px] font-semibold">Unsaved changes</span>
            <button className="btn-ghost !px-4 !py-2" onClick={() => setF(pick(s))}>
              Discard
            </button>
            <button className="btn-primary !px-5 !py-2" onClick={save}>
              Save
            </button>
          </div>
        </div>
      )}

      <Confirm open={leave} onClose={() => setLeave(false)} title="Discard changes?" text="You typed changes that are not saved. Leaving now throws them away." confirmLabel="Discard" onConfirm={() => nav.back()} />
      <LevelSheet state={levelSheet} onClose={() => setLevelSheet(null)} />
    </>
  );
}

function LevelSheet({ state, onClose }: { state: { key?: string } | null; onClose: () => void }) {
  const { data, updateSettings, toast } = useStore();
  const editing = state?.key;
  const [bf, setBf] = useState(0);
  const [gsm, setGsm] = useState(0);
  const [min, setMin] = useState(0);
  const [loaded, setLoaded] = useState<string | null>(null);
  const id = state ? (editing ?? '') : null;
  if (id !== loaded) {
    // (re)load the form when the sheet opens
    setLoaded(id);
    if (state) {
      const g = editing ? gradeFromKey(editing) : { gsm: 0, bf: 0 };
      setBf(g.bf);
      setGsm(g.gsm);
      setMin(editing ? data.settings.stockMin[editing] || 0 : 0);
    }
  }
  const ok = bf > 0 && gsm > 0 && min > 0;
  const save = () => {
    if (!ok) return;
    updateSettings({ stockMin: { ...data.settings.stockMin, [gradeKey(gsm, bf)]: min } });
    toast('Reorder level saved');
    onClose();
  };
  const remove = () => {
    if (!editing) return;
    const next = { ...data.settings.stockMin };
    delete next[editing];
    updateSettings({ stockMin: next });
    toast('Reorder level removed');
    onClose();
  };
  return (
    <Sheet open={!!state} onClose={onClose} title={editing ? `Level for ${gradeLabel(gradeFromKey(editing).gsm, gradeFromKey(editing).bf)}` : 'New reorder level'}>
      <div className="space-y-4">
        {!editing && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="BF">
              <NumInput value={bf} onValue={setBf} />
            </Field>
            <Field label="GSM">
              <NumInput value={gsm} onValue={setGsm} />
            </Field>
          </div>
        )}
        <Field label="Keep at least" hint="You are warned when the paper in stock for this grade falls below this.">
          <NumInput value={min} onValue={setMin} suffix="kg" />
        </Field>
        <button className="btn-primary w-full" disabled={!ok} onClick={save}>
          Save
        </button>
        {editing && (
          <button className="btn-danger w-full" onClick={remove}>
            Remove level
          </button>
        )}
      </div>
    </Sheet>
  );
}
