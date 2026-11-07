import { useMemo, useState } from 'react';
import { Bookmark, Layers, PackagePlus, RotateCcw, Share2 } from 'lucide-react';
import { usePerms, useStore } from '../store';
import { useNav } from '../nav';
import { Box3D } from '../Box3D';
import { calcBox, emptyLayers, estimate, isFlute, layerName, specLabel } from '@honeypackers/box-core/calc';
import { money, num } from '../lib/format';
import { boxSpecText, shareText } from '../lib/share';
import type { BoxSpec, PaperLayer, Ply, Pricing } from '../lib/types';
import { Field, Header, IconBtn, NumInput, Page, Section, Segmented, Sheet, Toggle } from '../ui';

const DRAFT_KEY = 'boxbook-calc-draft';

export function defaultSpec(): BoxSpec {
  const layers: PaperLayer[] = emptyLayers().map((_, i) => (isFlute(i) ? { gsm: 120, bf: 16, price: 36 } : { gsm: 150, bf: 18, price: 42 }));
  return { length: 0, width: 0, height: 0, ply: 3, perLayer: false, layers };
}

function loadDraft(): { spec: BoxSpec; qty: number } | null {
  try {
    const s = localStorage.getItem(DRAFT_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
function saveDraft(spec: BoxSpec, qty: number) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ spec, qty }));
  } catch {
    /* ignore */
  }
}

export function Calculator({ boxId, customerId: initialCustomer }: { boxId?: string; customerId?: string }) {
  const { data, upsertBox, toast } = useStore();
  const pm = usePerms();
  const cols = pm.money ? 'grid-cols-[1fr_1fr_1.2fr]' : 'grid-cols-2';
  const nav = useNav();
  const cur = data.settings.currency;
  const saved = boxId ? data.boxes.find((b) => b.id === boxId) : undefined;
  const draft = !saved ? loadDraft() : null;

  const [spec, setSpecState] = useState<BoxSpec>(saved?.spec || draft?.spec || defaultSpec());
  const [pricing, setPricing] = useState<Pricing>(saved?.pricing || data.settings.defaults);
  const [qty, setQtyState] = useState<number>(draft?.qty || 1000);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState(saved?.name || '');
  const [custId, setCustId] = useState(saved?.customerId || initialCustomer || '');

  const setSpec = (s: BoxSpec) => {
    setSpecState(s);
    if (!saved) saveDraft(s, qty);
  };
  const setQty = (q: number) => {
    setQtyState(q);
    if (!saved) saveDraft(spec, q);
  };
  const setLayer = (i: number, patch: Partial<PaperLayer>) => setSpec({ ...spec, layers: spec.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  const valid = spec.length > 0 && spec.width > 0 && spec.height > 0;
  const r = useMemo(() => calcBox(spec), [spec]);
  const est = useMemo(() => estimate(r.paperCost, pricing, qty), [r.paperCost, pricing, qty]);

  const doSave = () => {
    const b = upsertBox({ id: saved?.id, name: name.trim() || specLabel(spec), customerId: custId || undefined, spec, pricing });
    setSaveOpen(false);
    toast(saved ? 'Box updated' : 'Box saved');
    if (!saved) nav.replace({ name: 'box', id: b.id });
  };

  const createOrder = () => {
    nav.push({
      name: 'orderEdit',
      customerId: custId || undefined,
      prefill: {
        id: '',
        description: (saved?.name ? saved.name + ' · ' : '') + specLabel(spec),
        qty,
        rate: Math.round(est.unitPrice * 100) / 100,
        spec,
        boxId: saved?.id,
      },
    });
  };

  const share = async () => {
    const text = `${boxSpecText(spec)}\n\nPrice per box: ${money(est.unitPrice, cur)}\nQty ${num(qty, 0)}: ${money(est.total, cur)}${pricing.taxPct ? ` + GST ${pricing.taxPct}% = ${money(est.totalWithTax, cur)}` : ''}`;
    const m = await shareText('Box estimate', text);
    if (m) toast(m);
  };

  const plyLayers = Array.from({ length: spec.ply }, (_, i) => i);

  return (
    <>
      <Header
        title={saved ? saved.name : 'Box calculator'}
        subtitle={saved ? 'Saved box' : 'Size, weight, strength & price'}
        back={nav.stack.length > 0}
        large={nav.stack.length === 0}
        actions={
          <>
            {!saved && (
              <IconBtn label="Reset" onClick={() => setSpec(defaultSpec())}>
                <RotateCcw size={20} />
              </IconBtn>
            )}
            <IconBtn label="Share" onClick={share}>
              <Share2 size={20} />
            </IconBtn>
          </>
        }
      />
      <Page>
        <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
        <div>
        <Section title="Box size (inner, mm)">
          <div className="card p-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Length">
                <NumInput value={spec.length} onValue={(v) => setSpec({ ...spec, length: v })} />
              </Field>
              <Field label="Width">
                <NumInput value={spec.width} onValue={(v) => setSpec({ ...spec, width: v })} />
              </Field>
              <Field label="Height">
                <NumInput value={spec.height} onValue={(v) => setSpec({ ...spec, height: v })} />
              </Field>
            </div>
            <div className="mt-4">
              <span className="label">Ply</span>
              <Segmented<Ply>
                value={spec.ply}
                onChange={(p) => setSpec({ ...spec, ply: p })}
                options={[3, 5, 7, 9].map((p) => ({ value: p as Ply, label: `${p}-ply` }))}
              />
            </div>
          </div>
        </Section>

        <Section title="3D view">
          <Box3D length={spec.length} width={spec.width} height={spec.height} />
        </Section>

        <Section title="Paper">
          <div className="card p-4">
            <Toggle
              checked={spec.perLayer}
              onChange={(v) => setSpec({ ...spec, perLayer: v })}
              label="Different paper per layer"
              desc={spec.perLayer ? 'Set GSM, BF and price for each layer' : 'Same paper used for every layer'}
            />
            <div className={`mt-3 grid ${cols} gap-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}>
              <span>GSM</span>
              <span>BF</span>
              {pm.money && <span>Price / kg</span>}
            </div>
            <div className="mt-1 space-y-3">
              {(spec.perLayer ? plyLayers : [0]).map((i) => (
                <div key={i}>
                  {spec.perLayer && (
                    <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold">
                      <Layers size={13} className={isFlute(i) ? 'text-primary' : 'text-muted-foreground'} />
                      {layerName(i, spec.ply)}
                      {isFlute(i) && <span className="text-[11px] font-medium text-muted-foreground">×1.4 take-up</span>}
                    </div>
                  )}
                  <div className={`grid ${cols} gap-2`}>
                    <NumInput aria-label={`${layerName(i, spec.ply)} GSM`} value={spec.layers[i].gsm} onValue={(v) => setLayer(i, { gsm: v })} />
                    <NumInput aria-label={`${layerName(i, spec.ply)} BF`} value={spec.layers[i].bf} onValue={(v) => setLayer(i, { bf: v })} />
                    {pm.money && <NumInput aria-label={`${layerName(i, spec.ply)} price`} value={spec.layers[i].price} onValue={(v) => setLayer(i, { price: v })} suffix={cur} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        </div>
        <div>
        <Section title="Result">
          <div className={`card overflow-hidden ${valid ? '' : 'opacity-60'}`}>
            <div className={`grid ${pm.money ? 'grid-cols-3' : 'grid-cols-2'} divide-x divide-border/60 bg-primary/10`}>
              <Big label="Box weight" value={`${num(r.weight)}`} unit="g" />
              <Big label="Strength (BS)" value={num(r.bs)} unit="kg/cm²" />
              {pm.money && <Big label="Paper cost" value={money(r.paperCost, cur)} unit="per box" />}
            </div>
            <div className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60">
              <Small label="Cut size" value={`${r.cutSize} mm`} />
              <Small label="Deckle" value={`${r.deckleSize} mm`} />
              <Small label="Sheets" value={`${r.sheets}`} />
            </div>
            {!valid && <p className="border-t border-border/60 px-4 py-2.5 text-[13px] text-muted-foreground">Enter length, width and height to calculate.</p>}
          </div>
        </Section>

        {pm.money && (
        <Section title="Price estimate">
          <div className="card p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <NumInput value={qty} onValue={setQty} suffix="pcs" />
              </Field>
              <Field label="Overhead / box">
                <NumInput value={pricing.overhead} onValue={(v) => setPricing({ ...pricing, overhead: v })} suffix={cur} />
              </Field>
              <Field label="Profit">
                <NumInput value={pricing.profitPct} onValue={(v) => setPricing({ ...pricing, profitPct: v })} suffix="%" />
              </Field>
              <Field label="GST / tax">
                <NumInput value={pricing.taxPct} onValue={(v) => setPricing({ ...pricing, taxPct: v })} suffix="%" />
              </Field>
            </div>
            <dl className="tnum mt-4 space-y-2 border-t border-border/60 pt-4 text-[14px]">
              <Line k="Cost per box" v={money(est.unitCost, cur)} />
              <Line k="Price per box" v={money(est.unitPrice, cur)} strong />
              <Line k={`Total (${num(qty, 0)} pcs)`} v={money(est.total, cur)} />
              <Line k="Profit" v={money(est.profit, cur)} tone="good" />
              <Line k={`GST ${num(pricing.taxPct)}%`} v={money(est.tax, cur)} />
            </dl>
            <div className="mt-3 flex items-baseline justify-between rounded-xl bg-foreground px-4 py-3 text-background">
              <span className="text-[13px] font-semibold opacity-80">Total with tax</span>
              <span className="tnum text-[20px] font-bold">{money(est.totalWithTax, cur)}</span>
            </div>
          </div>
        </Section>
        )}

        {pm.editOrders && (
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-ghost" disabled={!valid} onClick={() => setSaveOpen(true)}>
            <Bookmark size={18} /> {saved ? 'Update box' : 'Save box'}
          </button>
          <button className="btn-primary" disabled={!valid} onClick={createOrder}>
            <PackagePlus size={18} /> Create order
          </button>
        </div>
        )}
      </div>
        </div>
      </Page>

      <Sheet open={saveOpen} onClose={() => setSaveOpen(false)} title={saved ? 'Update saved box' : 'Save box'}>
        <div className="space-y-4">
          <Field label="Box name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={specLabel(spec)} autoFocus />
          </Field>
          <Field label="Customer (optional)">
            <select className="input" value={custId} onChange={(e) => setCustId(e.target.value)}>
              <option value="">— None —</option>
              {data.customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company ? ` · ${c.company}` : ''}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn-primary w-full" onClick={doSave}>
            Save
          </button>
        </div>
      </Sheet>
    </>
  );
}

function Big({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="px-3 py-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="tnum mt-0.5 truncate text-[19px] font-bold tracking-tight">{value}</div>
      <div className="text-[11px] text-muted-foreground">{unit}</div>
    </div>
  );
}
function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tnum text-[15px] font-semibold">{value}</div>
    </div>
  );
}
function Line({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: 'good' }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={`${strong ? 'text-[16px] font-bold' : 'font-semibold'} ${tone === 'good' ? 'text-good' : ''}`}>{v}</dd>
    </div>
  );
}
