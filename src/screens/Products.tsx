import { useMemo, useState } from 'react';
import { Package, Plus, Sparkles, Trash2 } from 'lucide-react';
import { calcBox } from '@honeypackers/box-core/calc';
import { gradeLabel, priceCustomBox, productSlug, specForGrade } from '@honeypackers/box-core/pricing';
import type { ProductPack } from '@honeypackers/box-core/types';
import { useStore, usePerms } from '../store';
import { useNav } from '../nav';
import { money, num } from '../lib/format';
import { Confirm, Empty, Fab, Field, Header, List, NumInput, Page, Row, Section, Toggle } from '../ui';

const packsLabel = (packs: ProductPack[], cur: string) => packs.map((k) => `${k.qty} for ${money(k.price, cur)}`).join(' · ') || 'No packs yet';

/** More → Products: standard boxes sold in packs on honeypackers.in. */
export function ProductsList() {
  const { data } = useStore();
  const nav = useNav();
  const cur = data.settings.currency;
  const list = [...data.products].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return (
    <>
      <Header title="Products" subtitle="Standard boxes sold in packs online" back />
      <Page>
        {list.length === 0 ? (
          <Empty
            icon={<Package size={28} />}
            title="No products yet"
            text="Add the box sizes you keep in stock or make often. Buyers pick a pack size on the website and pay online."
            action={
              <button className="btn-primary" onClick={() => nav.push({ name: 'product' })}>
                <Plus size={18} /> Add product
              </button>
            }
          />
        ) : (
          <List>
            {list.map((p) => (
              <Row
                key={p.id}
                onClick={() => nav.push({ name: 'product', id: p.id })}
                icon={<Package size={20} className={p.active ? 'text-primary' : 'text-muted-foreground'} />}
                title={<span className={p.active ? '' : 'text-muted-foreground'}>{p.name}{!p.active && ' (hidden)'}</span>}
                sub={`${packsLabel(p.packs, cur)}${p.stockQty != null ? ` · ${p.stockQty} in stock` : ''}`}
              />
            ))}
          </List>
        )}
      </Page>
      {list.length > 0 && <Fab label="Product" icon={<Plus size={20} />} onClick={() => nav.push({ name: 'product' })} />}
    </>
  );
}

export function ProductEdit({ id }: { id?: string }) {
  const { data, upsertProduct, deleteProduct, toast } = useStore();
  const p = usePerms();
  const nav = useNav();
  const cur = data.settings.currency;
  const rules = data.web.rules;
  const existing = id ? data.products.find((x) => x.id === id) : undefined;

  const [size, setSize] = useState({ length: existing?.spec.length || 0, width: existing?.spec.width || 0, height: existing?.spec.height || 0 });
  const startGrade = rules.grades.find((g) => existing && g.ply === existing.ply && g.layers.every((l, i) => existing.spec.layers[i]?.gsm === l.gsm && existing.spec.layers[i]?.bf === l.bf))?.id ?? rules.grades[0]?.id ?? '';
  const [gradeId, setGradeId] = useState(startGrade);
  const [name, setName] = useState(existing?.name || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [packs, setPacks] = useState<ProductPack[]>(existing?.packs.length ? existing.packs : [{ qty: 25, price: 0 }, { qty: 100, price: 0 }]);
  const [stock, setStock] = useState<number | null>(existing?.stockQty ?? null);
  const [active, setActive] = useState(existing?.active ?? true);
  const [confirmDel, setConfirmDel] = useState(false);

  const grade = rules.grades.find((g) => g.id === gradeId);
  const sizeOk = size.length > 0 && size.width > 0 && size.height > 0;
  const spec = useMemo(() => (grade && sizeOk ? specForGrade(size, grade, rules.paper) ?? specForGrade(size, grade, grade.layers.map((l) => ({ ...l, pricePerKg: 1 }))) : null), [grade, size, sizeOk, rules.paper]);
  const result = spec ? calcBox(spec) : null;
  const autoName = grade && sizeOk ? `${grade.ply} ply box ${size.length}×${size.width}×${size.height} mm` : '';

  if (!p.ownerSettings) return <Header title="Products" back />;

  /** Web price list price for this pack size (paper + conversion + margin), as a starting point. */
  const suggest = (qty: number) => {
    const r = priceCustomBox({ ...size, gradeId, qty, colours: 0 }, rules);
    return r.ok ? Math.round(r.unitPrice * qty) : null;
  };
  const setPack = (i: number, patch: Partial<ProductPack>) => setPacks((xs) => xs.map((k, j) => (j === i ? { ...k, ...patch } : k)));
  const validPacks = packs.filter((k) => k.qty > 0 && k.price > 0);
  const canSave = !!spec && validPacks.length > 0;

  const save = () => {
    if (!spec || !grade) return;
    const finalName = name.trim() || autoName;
    upsertProduct({
      id: existing?.id,
      slug: existing?.slug || productSlug(finalName),
      name: finalName,
      description: description.trim(),
      ply: grade.ply,
      // Paper prices stay private: products are public on the website.
      spec: { ...spec, layers: spec.layers.map((l) => ({ ...l, price: 0 })) },
      packs: [...validPacks].sort((a, b) => a.qty - b.qty),
      hsn: existing?.hsn || data.settings.defaultHsn || '48191010',
      taxPct: existing?.taxPct ?? data.settings.defaults.taxPct,
      stockQty: stock == null ? null : Math.max(0, Math.floor(stock)),
      photos: existing?.photos || [],
      active,
      sort: existing?.sort ?? data.products.length,
    });
    toast('Product saved');
    nav.back();
  };

  return (
    <>
      <Header title={existing ? existing.name : 'New product'} back />
      <Page>
        {!rules.grades.length ? (
          <div className="card p-4 text-[14px]">
            <p className="font-semibold">Add a board grade first</p>
            <p className="mt-1 text-muted-foreground">Products use the board grades from your web price list (More → Web price list).</p>
            <button className="btn-primary mt-3" onClick={() => nav.push({ name: 'webPrices' })}>
              Open web price list
            </button>
          </div>
        ) : (
          <>
            <Section title="Box">
              <div className="card space-y-4 p-4">
                <div className="grid grid-cols-3 gap-3">
                  {(['length', 'width', 'height'] as const).map((k) => (
                    <Field key={k} label={k === 'length' ? 'Length' : k === 'width' ? 'Width' : 'Height'}>
                      <NumInput value={size[k]} onValue={(v) => setSize({ ...size, [k]: v })} suffix="mm" />
                    </Field>
                  ))}
                </div>
                <Field label="Board grade">
                  <select className="input" value={gradeId} onChange={(e) => setGradeId(e.target.value)}>
                    {rules.grades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label || gradeLabel(g)}
                      </option>
                    ))}
                  </select>
                </Field>
                {result && <p className="text-[13px] text-muted-foreground">BS {num(result.bs)} kg/cm² · {num(result.weight)} g per box</p>}
                <Field label="Name on the website" hint={autoName ? `Empty = "${autoName}"` : undefined}>
                  <input className="input" value={name} placeholder={autoName} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Description (optional)">
                  <textarea className="input min-h-20 py-2.5" value={description} maxLength={600} placeholder="What it suits, e.g. garments, shoes, e-commerce shipping" onChange={(e) => setDescription(e.target.value)} />
                </Field>
              </div>
            </Section>

            <Section title="Packs and prices (before GST)">
              <div className="card p-4">
                <div className="space-y-2">
                  {packs.map((k, i) => {
                    const s = suggest(k.qty);
                    return (
                      <div key={i}>
                        <div className="grid grid-cols-[1fr_1.3fr_2.5rem] gap-2">
                          <NumInput aria-label="Boxes per pack" value={k.qty} onValue={(qty) => setPack(i, { qty: Math.floor(qty) })} suffix="pcs" />
                          <NumInput aria-label="Pack price" value={k.price} onValue={(price) => setPack(i, { price })} suffix={cur} />
                          <button aria-label="Remove pack" className="grid h-12 w-10 place-items-center rounded-xl text-muted-foreground active:bg-muted" onClick={() => setPacks((xs) => xs.filter((_, j) => j !== i))}>
                            <Trash2 size={18} />
                          </button>
                        </div>
                        {s != null && k.qty > 0 && (
                          <button className="mt-1 flex items-center gap-1 text-[12.5px] font-semibold text-primary" onClick={() => setPack(i, { price: s })}>
                            <Sparkles size={13} /> Web price list: {money(s, cur)} ({money(s / k.qty, cur)} a box) — use it
                          </button>
                        )}
                        {k.qty > 0 && k.price > 0 && <p className="mt-0.5 text-[12px] text-muted-foreground">{money(k.price / k.qty, cur)} a box</p>}
                      </div>
                    );
                  })}
                </div>
                <button className="btn-ghost mt-3 w-full" onClick={() => setPacks((xs) => [...xs, { qty: 0, price: 0 }])}>
                  <Plus size={18} /> Add pack size
                </button>
              </div>
            </Section>

            <Section title="On the website">
              <div className="card space-y-3 p-4">
                <Toggle checked={active} onChange={setActive} label="Show on the website" />
                <Toggle checked={stock != null} onChange={(on) => setStock(on ? (existing?.stockQty ?? 0) : null)} label="Limited stock" desc={stock == null ? 'Made to order: any quantity can be bought' : 'Buyers cannot order more boxes than you have'} />
                {stock != null && (
                  <Field label="Boxes in stock">
                    <NumInput value={stock} onValue={(v) => setStock(Math.floor(v))} suffix="pcs" />
                  </Field>
                )}
              </div>
            </Section>

            <button className="btn-primary w-full" disabled={!canSave} onClick={save}>
              Save
            </button>
            {!canSave && <p className="mt-2 text-center text-[12.5px] text-muted-foreground">Enter the size and at least one pack with a price.</p>}
            {existing && (
              <button className="btn-danger mt-3 w-full" onClick={() => setConfirmDel(true)}>
                <Trash2 size={18} /> Delete product
              </button>
            )}
          </>
        )}
      </Page>
      <Confirm
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title="Delete product?"
        text={`${existing?.name} will be removed from the website. Orders already placed keep their lines.`}
        onConfirm={() => {
          deleteProduct(existing!.id);
          toast('Product deleted');
          nav.back();
        }}
      />
    </>
  );
}
