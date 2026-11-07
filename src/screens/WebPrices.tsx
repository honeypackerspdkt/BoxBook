import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Layers, MapPin, Plus, Trash2 } from 'lucide-react';
import { layerName } from '@honeypackers/box-core/calc';
import { gradeLabel, priceCustomBox, setupProblems, slabTable, type DeliveryZone, type Grade, type PaperRate, type Slab } from '@honeypackers/box-core/pricing';
import type { Ply } from '@honeypackers/box-core/types';
import { useStore } from '../store';
import { useNav } from '../nav';
import { money, uid } from '../lib/format';
import type { WebShop } from '../lib/types';
import { Field, Header, List, NumInput, Page, Row, Section, Segmented, Sheet, Toggle } from '../ui';

const PLIES: Ply[] = [3, 5, 7, 9];
const MODE_LABEL: Record<DeliveryZone['mode'], string> = { own: 'Own vehicle', courier: 'Courier', pickup: 'Pickup at factory' };
const colHead = 'grid gap-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
const delBtn = 'grid h-12 w-10 place-items-center rounded-xl text-muted-foreground active:bg-muted';

/** Owner screen: prices and delivery charges the website uses. Saved with the rest of the data (and in backups). */
export function WebPrices() {
  const { data, updateWeb, toast } = useStore();
  const nav = useNav();
  const cur = data.settings.currency;
  const [w, setW] = useState<WebShop>(data.web);
  const [gradeEdit, setGradeEdit] = useState<Grade | null>(null);
  const [zoneEdit, setZoneEdit] = useState<DeliveryZone | null>(null);

  const rules = w.rules;
  const setRules = (patch: Partial<WebShop['rules']>) => setW((x) => ({ ...x, rules: { ...x.rules, ...patch } }));
  const problems = useMemo(() => setupProblems(rules), [rules]);

  const setPaper = (i: number, patch: Partial<PaperRate>) => setRules({ paper: rules.paper.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const setSlab = (i: number, patch: Partial<Slab>) => setRules({ slabs: rules.slabs.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const saveGrade = (g: Grade) => {
    const exists = rules.grades.some((x) => x.id === g.id);
    setRules({ grades: exists ? rules.grades.map((x) => (x.id === g.id ? g : x)) : [...rules.grades, g] });
    setGradeEdit(null);
  };
  const saveZone = (z: DeliveryZone) => {
    const exists = w.zones.some((x) => x.id === z.id);
    setW((x) => ({ ...x, zones: exists ? x.zones.map((y) => (y.id === z.id ? z : y)) : [...x.zones, z] }));
    setZoneEdit(null);
  };

  const save = () => {
    const clean: WebShop = {
      ...w,
      rules: {
        ...rules,
        paper: rules.paper.filter((p) => p.gsm > 0 || p.bf > 0 || p.pricePerKg > 0),
        slabs: rules.slabs.filter((s) => s.minQty > 0).sort((a, b) => a.minQty - b.minQty),
      },
      advancePct: Math.min(100, Math.max(0, w.advancePct)),
    };
    updateWeb(clean);
    toast('Web price list saved');
    nav.back();
  };

  return (
    <>
      <Header title="Web price list" subtitle="Prices and delivery on honeypackers.in" back />
      <Page>
        <div className={`card mb-6 flex gap-3 p-4 ${problems.length ? 'bg-warn/10' : 'bg-good/10'}`}>
          {problems.length ? <AlertTriangle className="mt-0.5 shrink-0 text-warn" size={20} /> : <CheckCircle2 className="mt-0.5 shrink-0 text-good" size={20} />}
          <div className="min-w-0 text-[13.5px]">
            {problems.length ? (
              <>
                <p className="font-semibold">Not ready to show prices yet</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="font-semibold">Ready: the website can show live prices for every grade.</p>
            )}
          </div>
        </div>

        <Section title="Website">
          <div className="card space-y-4 p-4">
            <Toggle checked={w.showPrices} onChange={(showPrices) => setW({ ...w, showPrices })} label="Show prices on the website" desc="Off: visitors can only ask for a quote." />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Paid at checkout" hint="100 = full payment upfront">
                <NumInput value={w.advancePct} onValue={(advancePct) => setW({ ...w, advancePct })} suffix="%" />
              </Field>
              <Field label="Minimum order value" hint="Before GST, 0 = none">
                <NumInput value={w.minOrderValue} onValue={(minOrderValue) => setW({ ...w, minOrderValue })} suffix={cur} />
              </Field>
            </div>
          </div>
        </Section>

        <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
          <div>
            <Section title="Paper rates">
              <div className="card p-4">
                {rules.paper.length > 0 && (
                  <div className={`${colHead} mb-1 grid-cols-[1fr_1fr_1.3fr_2.5rem]`}>
                    <span>GSM</span>
                    <span>BF</span>
                    <span>Price / kg</span>
                  </div>
                )}
                <div className="space-y-2">
                  {rules.paper.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1.3fr_2.5rem] gap-2">
                      <NumInput aria-label="GSM" value={p.gsm} onValue={(gsm) => setPaper(i, { gsm })} />
                      <NumInput aria-label="BF" value={p.bf} onValue={(bf) => setPaper(i, { bf })} />
                      <NumInput aria-label="Price per kg" value={p.pricePerKg} onValue={(pricePerKg) => setPaper(i, { pricePerKg })} suffix={cur} />
                      <button aria-label="Remove paper" className={delBtn} onClick={() => setRules({ paper: rules.paper.filter((_, j) => j !== i) })}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="btn-ghost mt-3 w-full" onClick={() => setRules({ paper: [...rules.paper, { gsm: 0, bf: 0, pricePerKg: 0 }] })}>
                  <Plus size={18} /> Add paper
                </button>
              </div>
            </Section>

            <Section title="Conversion cost">
              <div className="card p-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {PLIES.map((ply) => (
                    <Field key={ply} label={`${ply} ply`}>
                      <NumInput value={rules.conversionPerKg[String(ply)] ?? 0} onValue={(v) => setRules({ conversionPerKg: { ...rules.conversionPerKg, [String(ply)]: v } })} suffix={`${cur}/kg`} />
                    </Field>
                  ))}
                </div>
                <p className="mt-3 text-[12.5px] text-muted-foreground">Per kg of board: corrugation, pasting, slotting, stitching and labour. Leave a ply at 0 if you don't sell it online.</p>
              </div>
            </Section>

            <Section title="Board grades">
              {rules.grades.length > 0 && (
                <List>
                  {rules.grades.map((g) => (
                    <Row key={g.id} onClick={() => setGradeEdit(g)} icon={<Layers size={20} className="text-primary" />} title={g.label || gradeLabel(g)} sub={`${g.ply} ply${g.layers.length > 1 ? ' · paper per layer' : ''}`} />
                  ))}
                </List>
              )}
              <button className="btn-ghost mt-3 w-full" onClick={() => setGradeEdit({ id: uid(), label: '', ply: 3, layers: [{ gsm: 0, bf: 0 }] })}>
                <Plus size={18} /> Add grade
              </button>
            </Section>
          </div>

          <div>
            <Section title="Quantity slabs (margin)">
              <div className="card p-4">
                {rules.slabs.length > 0 && (
                  <div className={`${colHead} mb-1 grid-cols-[1fr_1fr_2.5rem]`}>
                    <span>From qty</span>
                    <span>Margin</span>
                  </div>
                )}
                <div className="space-y-2">
                  {rules.slabs.map((s, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_2.5rem] gap-2">
                      <NumInput aria-label="From quantity" value={s.minQty} onValue={(minQty) => setSlab(i, { minQty })} suffix="pcs" />
                      <NumInput aria-label="Margin" value={s.marginPct} onValue={(marginPct) => setSlab(i, { marginPct })} suffix="%" />
                      <button aria-label="Remove slab" className={delBtn} onClick={() => setRules({ slabs: rules.slabs.filter((_, j) => j !== i) })}>
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="btn-ghost mt-3 w-full" onClick={() => setRules({ slabs: [...rules.slabs, { minQty: 0, marginPct: 0 }] })}>
                  <Plus size={18} /> Add slab
                </button>
                <p className="mt-3 text-[12.5px] text-muted-foreground">Margin added on cost for orders of at least that many boxes, e.g. 100+ at 30%, 500+ at 22%.</p>
              </div>
            </Section>

            <Section title="Printing">
              <div className="card p-4">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Colour / box">
                    <NumInput value={rules.printing.perColourPerBox} onValue={(perColourPerBox) => setRules({ printing: { ...rules.printing, perColourPerBox } })} suffix={cur} />
                  </Field>
                  <Field label="Plate / colour">
                    <NumInput value={rules.printing.plateCharge} onValue={(plateCharge) => setRules({ printing: { ...rules.printing, plateCharge } })} suffix={cur} />
                  </Field>
                  <Field label="Max colours">
                    <NumInput value={rules.printing.maxColours} onValue={(maxColours) => setRules({ printing: { ...rules.printing, maxColours: Math.floor(maxColours) } })} />
                  </Field>
                </div>
                <p className="mt-3 text-[12.5px] text-muted-foreground">The plate charge is spread over the order quantity.</p>
              </div>
            </Section>

            <Section title="Order and machine limits">
              <div className="card p-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Minimum quantity">
                    <NumInput value={rules.limits.minQty} onValue={(minQty) => setRules({ limits: { ...rules.limits, minQty: Math.floor(minQty) } })} suffix="pcs" />
                  </Field>
                  <Field label="Maximum quantity" hint="Above this: quote">
                    <NumInput value={rules.limits.maxQty ?? 0} onValue={(maxQty) => setRules({ limits: { ...rules.limits, maxQty: Math.floor(maxQty) } })} suffix="pcs" />
                  </Field>
                  <Field label="Max deckle" hint="W + H + allowance">
                    <NumInput value={rules.limits.maxDeckle} onValue={(maxDeckle) => setRules({ limits: { ...rules.limits, maxDeckle } })} suffix="mm" />
                  </Field>
                  <Field label="Max cut size" hint="Per sheet">
                    <NumInput value={rules.limits.maxCut} onValue={(maxCut) => setRules({ limits: { ...rules.limits, maxCut } })} suffix="mm" />
                  </Field>
                </div>
                <p className="mt-3 text-[12.5px] text-muted-foreground">0 = no limit. Bigger boxes are sent to "ask for a quote".</p>
              </div>
            </Section>

            <Section title="Delivery zones">
              {w.zones.length > 0 && (
                <List>
                  {w.zones.map((z) => (
                    <Row key={z.id} onClick={() => setZoneEdit(z)} icon={<MapPin size={20} className="text-primary" />} title={z.name || 'Zone'} sub={zoneSummary(z, cur)} />
                  ))}
                </List>
              )}
              <button
                className="btn-ghost mt-3 w-full"
                onClick={() => setZoneEdit({ id: uid(), name: '', pincodeFrom: 0, pincodeTo: 0, mode: 'own', ratePerKg: 0, minCharge: 0, freeAbove: null, days: 1, active: true })}
              >
                <Plus size={18} /> Add zone
              </button>
              <p className="mt-2 px-1 text-[12.5px] text-muted-foreground">Pincodes with no zone can't order online and are asked to send an enquiry.</p>
            </Section>
          </div>
        </div>

        <Preview web={w} cur={cur} />

        <button className="btn-primary w-full" onClick={save}>
          Save
        </button>
      </Page>

      <GradeSheet grade={gradeEdit} paper={rules.paper} onClose={() => setGradeEdit(null)} onSave={saveGrade} onDelete={(id) => {
        setRules({ grades: rules.grades.filter((g) => g.id !== id) });
        setGradeEdit(null);
      }} />
      <ZoneSheet zone={zoneEdit} cur={cur} onClose={() => setZoneEdit(null)} onSave={saveZone} onDelete={(id) => {
        setW((x) => ({ ...x, zones: x.zones.filter((z) => z.id !== id) }));
        setZoneEdit(null);
      }} />
    </>
  );
}

function zoneSummary(z: DeliveryZone, cur: string): string {
  const pins = z.pincodeFrom === z.pincodeTo ? `${z.pincodeFrom}` : `${z.pincodeFrom}–${z.pincodeTo}`;
  const charge =
    z.mode === 'own'
      ? `${cur}${z.ratePerKg}/kg, min ${cur}${z.minCharge}${z.freeAbove ? `, free above ${cur}${z.freeAbove}` : ''}`
      : z.mode === 'courier'
        ? 'courier rates at checkout'
        : 'free';
  return `${pins} · ${MODE_LABEL[z.mode]} · ${charge}${z.active === false ? ' · off' : ''}`;
}

/* ------------------------------------ grade editor ------------------------------------ */

function GradeSheet({ grade, paper, onClose, onSave, onDelete }: { grade: Grade | null; paper: PaperRate[]; onClose: () => void; onSave: (g: Grade) => void; onDelete: (id: string) => void }) {
  return (
    <Sheet open={!!grade} onClose={onClose} title="Board grade">
      {grade && <GradeForm key={grade.id} initial={grade} paper={paper} onSave={onSave} onDelete={onDelete} />}
    </Sheet>
  );
}

function GradeForm({ initial, paper, onSave, onDelete }: { initial: Grade; paper: PaperRate[]; onSave: (g: Grade) => void; onDelete: (id: string) => void }) {
  const [g, setG] = useState<Grade>(initial);
  const perLayer = g.layers.length > 1;
  const resize = (ply: Ply, per: boolean): Grade['layers'] => {
    const base = g.layers.length ? g.layers : [{ gsm: 0, bf: 0 }];
    if (!per) return [base[0]];
    return Array.from({ length: ply }, (_, i) => base[i] ?? base[base.length - 1]);
  };
  const setLayer = (i: number, patch: Partial<Grade['layers'][number]>) => setG({ ...g, layers: g.layers.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const hasRate = (l: { gsm: number; bf: number }) => paper.some((p) => p.gsm === l.gsm && p.bf === l.bf && p.pricePerKg > 0);
  const valid = g.layers.every((l) => l.gsm > 0 && l.bf > 0);

  return (
    <div className="space-y-4">
      <Field label="Name on the website" hint={`Empty = "${gradeLabel(g)}"`}>
        <input className="input" value={g.label} placeholder={gradeLabel(g)} onChange={(e) => setG({ ...g, label: e.target.value })} />
      </Field>
      <Field label="Ply">
        <Segmented<Ply> value={g.ply} options={PLIES.map((p) => ({ value: p, label: `${p} ply` }))} onChange={(ply) => setG({ ...g, ply, layers: resize(ply, perLayer) })} />
      </Field>
      <Toggle checked={!perLayer} onChange={(same) => setG({ ...g, layers: resize(g.ply, !same) })} label="Same paper in every layer" />
      <div>
        <div className={`${colHead} mb-1 grid-cols-[1fr_1fr]`}>
          <span>GSM</span>
          <span>BF</span>
        </div>
        <div className="space-y-2">
          {g.layers.map((l, i) => (
            <div key={i}>
              {perLayer && <div className="mb-1 text-[12.5px] font-semibold">{layerName(i, g.ply)}</div>}
              <div className="grid grid-cols-2 gap-2">
                <NumInput aria-label={`${perLayer ? layerName(i, g.ply) : 'Paper'} GSM`} value={l.gsm} onValue={(gsm) => setLayer(i, { gsm })} />
                <NumInput aria-label={`${perLayer ? layerName(i, g.ply) : 'Paper'} BF`} value={l.bf} onValue={(bf) => setLayer(i, { bf })} />
              </div>
              {l.gsm > 0 && l.bf > 0 && !hasRate(l) && <p className="mt-1 text-[12px] text-warn">No paper rate for {l.gsm} GSM / {l.bf} BF yet.</p>}
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 pt-2">
        <button className="btn-danger" onClick={() => onDelete(g.id)}>
          <Trash2 size={18} /> Delete
        </button>
        <button className="btn-primary" disabled={!valid} onClick={() => onSave({ ...g, label: g.label.trim() })}>
          Done
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------ zone editor ------------------------------------ */

function ZoneSheet({ zone, cur, onClose, onSave, onDelete }: { zone: DeliveryZone | null; cur: string; onClose: () => void; onSave: (z: DeliveryZone) => void; onDelete: (id: string) => void }) {
  return (
    <Sheet open={!!zone} onClose={onClose} title="Delivery zone">
      {zone && <ZoneForm key={zone.id} initial={zone} cur={cur} onSave={onSave} onDelete={onDelete} />}
    </Sheet>
  );
}

const validPin = (n: number) => Number.isInteger(n) && n >= 100000 && n <= 999999;

function ZoneForm({ initial, cur, onSave, onDelete }: { initial: DeliveryZone; cur: string; onSave: (z: DeliveryZone) => void; onDelete: (id: string) => void }) {
  const [z, setZ] = useState<DeliveryZone>(initial);
  const pinsOk = validPin(z.pincodeFrom) && validPin(z.pincodeTo) && z.pincodeFrom <= z.pincodeTo;
  const valid = z.name.trim() !== '' && pinsOk;
  return (
    <div className="space-y-4">
      <Field label="Name">
        <input className="input" value={z.name} placeholder="e.g. Pudukkottai town" onChange={(e) => setZ({ ...z, name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pincode from">
          <NumInput value={z.pincodeFrom} onValue={(v) => setZ({ ...z, pincodeFrom: Math.floor(v), pincodeTo: z.pincodeTo || Math.floor(v) })} />
        </Field>
        <Field label="Pincode to">
          <NumInput value={z.pincodeTo} onValue={(v) => setZ({ ...z, pincodeTo: Math.floor(v) })} />
        </Field>
      </div>
      {!pinsOk && (z.pincodeFrom > 0 || z.pincodeTo > 0) && <p className="-mt-2 text-[12px] text-warn">Use 6-digit pincodes, "from" not above "to".</p>}
      <Field label="Delivery by">
        <Segmented<DeliveryZone['mode']> value={z.mode} options={(['own', 'courier', 'pickup'] as const).map((m) => ({ value: m, label: MODE_LABEL[m] }))} onChange={(mode) => setZ({ ...z, mode })} />
      </Field>
      {z.mode === 'own' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate">
            <NumInput value={z.ratePerKg} onValue={(ratePerKg) => setZ({ ...z, ratePerKg })} suffix={`${cur}/kg`} />
          </Field>
          <Field label="Minimum charge">
            <NumInput value={z.minCharge} onValue={(minCharge) => setZ({ ...z, minCharge })} suffix={cur} />
          </Field>
          <Field label="Free above" hint="Order value, 0 = never free">
            <NumInput value={z.freeAbove ?? 0} onValue={(v) => setZ({ ...z, freeAbove: v > 0 ? v : null })} suffix={cur} />
          </Field>
          <Field label="Delivery in">
            <NumInput value={z.days} onValue={(days) => setZ({ ...z, days: Math.floor(days) })} suffix="days" />
          </Field>
        </div>
      )}
      {z.mode === 'courier' && (
        <Field label="Delivery in" hint="The charge comes from the courier's rates at checkout.">
          <NumInput value={z.days} onValue={(days) => setZ({ ...z, days: Math.floor(days) })} suffix="days" />
        </Field>
      )}
      <Toggle checked={z.active !== false} onChange={(active) => setZ({ ...z, active })} label="Zone is on" />
      <div className="grid grid-cols-2 gap-3 pt-2">
        <button className="btn-danger" onClick={() => onDelete(z.id!)}>
          <Trash2 size={18} /> Delete
        </button>
        <button className="btn-primary" disabled={!valid} onClick={() => onSave({ ...z, name: z.name.trim() })}>
          Done
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------ preview ------------------------------------ */

function Preview({ web, cur }: { web: WebShop; cur: string }) {
  const rules = web.rules;
  const [size, setSize] = useState({ length: 300, width: 200, height: 150 });
  const [gradeId, setGradeId] = useState('');
  const [colours, setColours] = useState(0);
  const grade = rules.grades.find((g) => g.id === gradeId) ?? rules.grades[0];
  const input = { ...size, gradeId: grade?.id ?? '', colours };
  const table = grade ? slabTable(input, rules) : [];
  const first = grade ? priceCustomBox({ ...input, qty: Math.max(rules.limits.minQty, 1) }, rules) : null;

  return (
    <Section title="Preview: what a buyer sees">
      <div className="card p-4">
        <div className="grid grid-cols-3 gap-3">
          {(['length', 'width', 'height'] as const).map((k) => (
            <Field key={k} label={k === 'length' ? 'Length' : k === 'width' ? 'Width' : 'Height'}>
              <NumInput value={size[k]} onValue={(v) => setSize({ ...size, [k]: v })} suffix="mm" />
            </Field>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Grade">
            <select className="input" value={grade?.id ?? ''} onChange={(e) => setGradeId(e.target.value)} disabled={!rules.grades.length}>
              {!rules.grades.length && <option value="">Add a grade first</option>}
              {rules.grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label || gradeLabel(g)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Colours">
            <NumInput value={colours} onValue={(v) => setColours(Math.floor(v))} />
          </Field>
        </div>

        {first && !first.ok && <p className="mt-4 rounded-xl bg-warn/10 p-3 text-[13.5px]">{first.message}</p>}
        {first?.ok && (
          <>
            <p className="mt-4 text-[12.5px] text-muted-foreground">
              BS {first.box.bs} kg/cm² · {first.box.weight} g per box · deckle {first.box.deckleSize} mm · cut {first.box.cutSize} mm{first.box.sheets > 1 ? ' × 2 sheets' : ''}
            </p>
            <div className="mt-3 overflow-hidden rounded-xl border border-border/60">
              {table.map((r) => (
                <div key={r.minQty} className="flex items-center justify-between border-b border-border/60 px-3.5 py-2.5 text-[14px] last:border-0">
                  <span>From {r.minQty.toLocaleString('en-IN')} boxes</span>
                  <span className="tnum font-semibold">
                    {money(r.unitPrice, cur)} <span className="text-[12px] font-normal text-muted-foreground">/ box</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              At {first.qty} boxes: paper {money(first.paper, cur)} + conversion {money(first.conversion, cur)}
              {first.printing ? ` + printing ${money(first.printing, cur)}` : ''} = {money(first.base, cur)} cost, + {first.marginPct}% margin. GST extra.
            </p>
          </>
        )}
        {!web.showPrices && <p className="mt-3 text-[12.5px] text-muted-foreground">Prices are switched off: the website shows "ask for a quote" instead.</p>}
      </div>
    </Section>
  );
}
