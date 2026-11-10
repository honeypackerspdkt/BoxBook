import { useEffect, useState } from 'react';
import { AlertTriangle, History, LayoutGrid, List as ListIcon, Package, Plus, SlidersHorizontal } from 'lucide-react';
import { usePerms, useStore } from '../store';
import { useNav } from '../nav';
import { fmtDateTime, money0, num } from '../lib/format';
import { boxFillPct, boxStockByPly, boxStockLevel, boxStockList, boxStockTotals, KIND_LABEL } from '../lib/box-stock';
import type { BoxStockMove } from '../lib/cloud/supabase-api';
import type { Product } from '../lib/types';
import { Empty, Field, Header, List, NumInput, Page, Row, Section, Segmented, Sheet } from '../ui';

const api = () => import('../lib/cloud/supabase-api');
const pcs = (n: number) => `${num(n, 0)} pcs`;

type Layout = 'tiles' | 'list';
const LAYOUT_KEY = 'boxbook-boxstock-layout';
const readLayout = (): Layout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'tiles';
  } catch {
    return 'tiles';
  }
};
const sizeOf = (p: Product) => `${num(p.spec.length, 0)}×${num(p.spec.width, 0)}×${num(p.spec.height, 0)} mm`;

/**
 * Ready-made boxes of the website's standard products, in the same style as Paper stock: summary cards, a "time to make
 * boxes" alert, tiles or a list grouped by ply. Stock goes up when boxes are made, down when a website order is paid /
 * confirmed (database trigger), back up when that order is cancelled. Manual orders don't touch it.
 */
export function BoxStock() {
  const { data, cloudStatus } = useStore();
  const p = usePerms();
  const nav = useNav();
  const [openId, setOpenId] = useState<string | null>(null);
  const [layout, setLayoutState] = useState<Layout>(readLayout);
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* private mode: just not remembered */
    }
  };
  const online = cloudStatus.phase === 'ready';
  const shown = data.products.filter((x) => x.active || x.stockQty != null);
  const groups = boxStockByPly(shown);
  const { untracked } = boxStockList(shown);
  const totals = boxStockTotals(shown);
  const alerts = shown.filter((x) => ['out', 'low'].includes(boxStockLevel(x)));
  const open = data.products.find((x) => x.id === openId) || null;
  const cur = data.settings.currency;

  if (!p.boxStock) return <Header title="Box stock" back />;

  return (
    <>
      <Header title="Box stock" subtitle="Ready-made boxes for online orders" back />
      <Page>
        {!online && <p className="mb-4 rounded-xl bg-warn/10 p-3 text-[13.5px]">Box stock is kept in the cloud. Connect to the internet to change it.</p>}
        {!data.products.length ? (
          <div className="card">
            <Empty
              icon={<Package size={28} />}
              title="No products yet"
              text="Box stock is kept for the standard boxes sold on the website. Add them first under More → Products."
              action={
                p.ownerSettings ? (
                  <button className="btn-primary" onClick={() => nav.push({ name: 'products' })}>
                    Open products
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <div className="mb-5 grid grid-cols-3 gap-3">
              {(
                [
                  ['In stock', `${num(totals.boxes, 0)} pcs`, 'text-primary'],
                  ['Box types', String(totals.kept), ''],
                  ['Value', p.money ? (totals.value >= 100000 ? `${cur}${num(totals.value / 100000, 1)} L` : money0(totals.value, cur)) : '—', ''],
                ] as const
              ).map(([label, v, cls]) => (
                <div key={label} className="card px-3 py-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
                  <div className={`tnum mt-1 text-[19px] font-bold leading-tight tracking-tight sm:text-[22px] ${cls}`}>{v}</div>
                </div>
              ))}
            </div>

            {alerts.length > 0 && (
              <div className="mb-5 space-y-1.5 rounded-2xl bg-bad/10 p-4 text-bad">
                <div className="flex items-center gap-2 text-[14px] font-bold">
                  <AlertTriangle size={18} /> Time to make boxes
                </div>
                {alerts.map((x) => (
                  <p key={x.id} className="text-[13.5px]">
                    <b>{x.name}</b>: {(x.stockQty || 0) > 0 ? `${pcs(x.stockQty || 0)} left` : 'none left'}
                    {x.stockMin != null ? `, keep at least ${pcs(x.stockMin)}` : ''}
                  </p>
                ))}
              </div>
            )}

            <div className="mb-5 flex items-center justify-between gap-2">
              <p className="min-w-0 text-[13px] text-muted-foreground">Tap a box to add boxes made, correct the count or see its history.</p>
              <div className="flex shrink-0 rounded-xl bg-muted p-1" role="group" aria-label="Layout">
                {(
                  [
                    ['tiles', 'Tiles', LayoutGrid],
                    ['list', 'List', ListIcon],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={label}
                    aria-pressed={layout === value}
                    title={label}
                    onClick={() => setLayout(value)}
                    className={`grid h-9 w-9 place-items-center rounded-lg transition ${layout === value ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}
                  >
                    <Icon size={18} />
                  </button>
                ))}
              </div>
            </div>

            {groups.length === 0 && <div className="card mb-5 p-5 text-center text-[14px] text-muted-foreground">No box is kept in stock yet. Open a box under “Made to order” and add the boxes you made.</div>}
            {groups.map((g) => (
              <Section key={g.ply} title={`${g.ply} ply`} action={<span className="tnum text-[13px] font-semibold text-muted-foreground">{pcs(g.boxes)} in stock</span>}>
                {layout === 'tiles' ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {g.items.map((x) => (
                      <BoxTile key={x.id} product={x} pct={boxFillPct(x, g.max)} onOpen={() => setOpenId(x.id)} />
                    ))}
                  </div>
                ) : (
                  <div className="card divide-y divide-border/60 overflow-hidden">
                    {g.items.map((x) => (
                      <BoxRow key={x.id} product={x} onOpen={() => setOpenId(x.id)} />
                    ))}
                  </div>
                )}
              </Section>
            ))}

            {untracked.length > 0 && (
              <Section title="Made to order (no stock kept)">
                {layout === 'tiles' ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {untracked.map((x) => (
                      <button key={x.id} type="button" onClick={() => setOpenId(x.id)} className="flex min-h-[120px] flex-col rounded-2xl border-2 border-dashed border-border p-3.5 text-left transition active:scale-[0.98] active:bg-muted/60">
                        <span className="tnum inline-block self-start rounded-md bg-muted px-1.5 py-0.5 text-[12px] font-bold text-muted-foreground">{sizeOf(x)}</span>
                        <span className="mt-2 line-clamp-2 text-[13.5px] font-semibold">{x.name}</span>
                        <span className="mt-auto flex items-center gap-1 pt-2 text-[13px] font-semibold text-primary">
                          <Plus size={15} /> Start keeping stock
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <List>
                    {untracked.map((x) => (
                      <Row key={x.id} onClick={() => setOpenId(x.id)} title={x.name} sub="Tap to add boxes made and start keeping stock" />
                    ))}
                  </List>
                )}
              </Section>
            )}
            <p className="px-1 text-[12.5px] text-muted-foreground">
              Stock goes down by itself when a website order is paid or confirmed, and comes back if that order is cancelled. Manual orders don't change it. When a box runs out, the website still takes orders as made to order.
            </p>
          </>
        )}
      </Page>
      <StockSheet product={open} online={online} canCorrect={p.boxStockCorrect} onClose={() => setOpenId(null)} />
    </>
  );
}

/** One box as a tile: size, name, count with a level bar, and its alert level (like a reel tile in Paper stock). */
function BoxTile({ product, pct, onOpen }: { product: Product; pct: number; onOpen: () => void }) {
  const level = boxStockLevel(product);
  const q = Math.max(0, product.stockQty || 0);
  return (
    <button type="button" onClick={onOpen} className={`card flex flex-col p-3.5 text-left transition active:scale-[0.98] ${level === 'out' ? 'opacity-75' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="tnum inline-block rounded-md bg-primary/12 px-1.5 py-0.5 text-[12px] font-bold text-primary">{sizeOf(product)}</span>
        {level === 'out' ? <span className="text-[11px] font-bold uppercase tracking-wide text-bad">Out</span> : level === 'low' ? <span className="text-[11px] font-bold uppercase tracking-wide text-warn">Low</span> : null}
      </div>
      <div className="tnum mt-3 text-[26px] font-bold leading-none tracking-tight">
        {num(q, 0)}
        <span className="ml-1 text-[13px] font-semibold text-muted-foreground">pcs</span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${level === 'out' ? 'bg-muted-foreground/40' : level === 'low' ? 'bg-warn' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="tnum mt-1 flex justify-between text-[11.5px] text-muted-foreground">
        <span>{product.stockMin != null ? `alert at ${num(product.stockMin, 0)}` : 'no alert'}</span>
        <span>{product.madeDays || 7} days to make</span>
      </div>
      <div className="mt-2 truncate text-[12px] text-muted-foreground">{product.name}</div>
    </button>
  );
}

function BoxRow({ product, onOpen }: { product: Product; onOpen: () => void }) {
  const level = boxStockLevel(product);
  return (
    <Row
      onClick={onOpen}
      title={
        <>
          {sizeOf(product)} <span className="font-normal text-muted-foreground">· {product.ply} ply</span>
        </>
      }
      sub={product.stockMin != null ? `Alert at ${pcs(product.stockMin)}` : 'No low-stock alert'}
      right={
        <span className="text-right">
          <span className={`tnum block text-[15px] font-bold ${level === 'out' ? 'text-muted-foreground' : ''}`}>{pcs(Math.max(0, product.stockQty || 0))}</span>
          <span className={`block text-[11.5px] font-bold uppercase tracking-wide ${level === 'out' ? 'text-bad' : level === 'low' ? 'text-warn' : 'text-muted-foreground'}`}>{level === 'out' ? 'Out' : level === 'low' ? 'Low' : 'In stock'}</span>
        </span>
      }
    />
  );
}

/** One product: add boxes made, correct the count, see the history. */
function StockSheet({ product, online, canCorrect, onClose }: { product: Product | null; online: boolean; canCorrect: boolean; onClose: () => void }) {
  const { cloud, toast } = useStore();
  const [mode, setMode] = useState<'made' | 'correct'>('made');
  const [qty, setQty] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [moves, setMoves] = useState<BoxStockMove[] | null>(null);
  const [error, setError] = useState('');
  const current = product?.stockQty ?? 0;

  const load = (id: string) =>
    api()
      .then((a) => a.boxStockMoves(id))
      .then(setMoves)
      .catch((e) => setError(String((e as Error)?.message || e)));

  useEffect(() => {
    setMode('made');
    setQty(0);
    setNote('');
    setMoves(null);
    setError('');
    if (product && online) void load(product.id);
  }, [product?.id, online]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!product) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const delta = mode === 'made' ? qty : qty - current;
  const valid = online && (mode === 'made' ? qty > 0 : qty >= 0 && delta !== 0);
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const a = await api();
      const now = await a.boxStockChange(product.id, mode === 'made' ? 'made' : 'correction', delta, note.trim());
      toast(mode === 'made' ? `Added ${pcs(qty)}: ${pcs(now)} in stock` : `Stock set to ${pcs(now)}`);
      setQty(0);
      setNote('');
      await cloud.syncNow(); // bring the new count to this device
      void load(product.id);
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title={product.name}>
      <div className="space-y-4">
        <div className="card flex items-center justify-between p-4">
          <span className="text-[14px] text-muted-foreground">{product.stockQty == null ? 'Made to order (no stock kept yet)' : 'In stock now'}</span>
          <span className="tnum text-[26px] font-bold">{num(current, 0)}</span>
        </div>

        {canCorrect && product.stockQty != null && (
          <Segmented<'made' | 'correct'>
            value={mode}
            onChange={(m) => (setMode(m), setQty(m === 'correct' ? current : 0))}
            options={[
              { value: 'made', label: 'Add boxes made' },
              { value: 'correct', label: 'Correct count' },
            ]}
          />
        )}
        <p className="text-[13px] text-muted-foreground">
          {mode === 'made' ? 'Boxes finished and kept ready for online orders. They are added to the stock.' : 'After counting the boxes: enter how many there really are.'}
        </p>
        <Field label={mode === 'made' ? 'Boxes made' : 'Boxes counted'} hint={mode === 'correct' && delta !== 0 ? `${delta > 0 ? '+' : ''}${num(delta, 0)} from now` : undefined}>
          <NumInput value={qty} onValue={(v) => setQty(Math.max(0, Math.floor(v)))} suffix="pcs" />
        </Field>
        <Field label="Note (optional)">
          <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'made' ? 'e.g. batch 12, machine 2' : 'e.g. monthly count'} />
        </Field>
        {error && <p className="rounded-xl bg-warn/10 p-3 text-[13.5px]">{error}</p>}
        <button className="btn-primary w-full" disabled={!valid || busy} onClick={save}>
          {mode === 'made' ? <Plus size={18} /> : <SlidersHorizontal size={18} />} {mode === 'made' ? 'Add to stock' : 'Save count'}
        </button>

        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
            <History size={14} /> History
          </p>
          {!online ? (
            <p className="text-[13px] text-muted-foreground">Connect to the internet to see the history.</p>
          ) : moves == null ? (
            <p className="text-[13px] text-muted-foreground">Loading…</p>
          ) : !moves.length ? (
            <p className="text-[13px] text-muted-foreground">No changes yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {moves.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13.5px]">
                  <span className="min-w-0">
                    <span className="font-semibold">{KIND_LABEL[m.kind]}</span>
                    {m.note && <span className="block truncate text-muted-foreground">{m.note}</span>}
                    <span className="block text-[12px] text-muted-foreground">{fmtDateTime(m.createdAt)}</span>
                  </span>
                  <span className={`tnum shrink-0 font-bold ${m.qty < 0 ? 'text-bad' : 'text-primary'}`}>
                    {m.qty > 0 ? '+' : ''}
                    {num(m.qty, 0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
}
