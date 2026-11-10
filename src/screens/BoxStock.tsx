import { useEffect, useState } from 'react';
import { History, Package, Plus, SlidersHorizontal } from 'lucide-react';
import { usePerms, useStore } from '../store';
import { useNav } from '../nav';
import { fmtDateTime, money0, num } from '../lib/format';
import { boxFillPct, boxStockByPly, boxStockLevel, boxStockList, boxStockTotals, KIND_LABEL } from '../lib/box-stock';
import type { BoxStockMove } from '../lib/cloud/supabase-api';
import type { Product } from '../lib/types';
import { Empty, Field, Header, List, NumInput, Page, Row, Section, Segmented } from '../ui';
import { AlertBox, ListPage, Tile, TileGrid, Toolbar, StatCards, useLayout } from '../list-page';

const api = () => import('../lib/cloud/supabase-api');
const pcs = (n: number) => `${num(n, 0)} pcs`;
const sizeOf = (p: Product) => `${num(p.spec.length, 0)}×${num(p.spec.width, 0)}×${num(p.spec.height, 0)} mm`;

/**
 * Ready-made boxes of the website's standard products, on the shared list layout (like Paper stock): summary cards,
 * a "time to make boxes" alert, tiles or a list grouped by ply; a box opens its own page. Stock goes up when boxes are
 * made, down when a website order is paid / confirmed (database trigger), back up when that order is cancelled.
 */
export function BoxStock() {
  const { data, cloudStatus } = useStore();
  const p = usePerms();
  const nav = useNav();
  const [layout, setLayout] = useLayout('boxStock', 'tiles');
  const online = cloudStatus.phase === 'ready';
  const shown = data.products.filter((x) => x.active || x.stockQty != null);
  const groups = boxStockByPly(shown);
  const { untracked } = boxStockList(shown);
  const totals = boxStockTotals(shown);
  const alerts = shown.filter((x) => ['out', 'low'].includes(boxStockLevel(x)));
  const cur = data.settings.currency;
  const openBox = (id: string) => nav.push({ name: 'boxStockItem', id });

  if (!p.boxStock) return <Header title="Box stock" back />;

  return (
    <ListPage title="Box stock" subtitle="Ready-made boxes for online orders" back>
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
          <StatCards
            items={[
              { label: 'In stock', value: pcs(totals.boxes), tone: 'primary' },
              { label: 'Box types', value: String(totals.kept) },
              { label: 'Value', value: p.money ? (totals.value >= 100000 ? `${cur}${num(totals.value / 100000, 1)} L` : money0(totals.value, cur)) : '—' },
            ]}
          />
          <AlertBox
            title="Time to make boxes"
            lines={alerts.map((x) => (
              <>
                <b>{x.name}</b>: {(x.stockQty || 0) > 0 ? `${pcs(x.stockQty || 0)} left` : 'none left'}
                {x.stockMin != null ? `, keep at least ${pcs(x.stockMin)}` : ''}
              </>
            ))}
          />
          <Toolbar search={<p className="text-[13px] text-muted-foreground">Tap a box to add boxes made, correct the count or see its history.</p>} layout={layout} onLayout={setLayout} />

          {groups.length === 0 && <div className="card mb-5 p-5 text-center text-[14px] text-muted-foreground">No box is kept in stock yet. Open a box under “Made to order” and add the boxes you made.</div>}
          {groups.map((g) => (
            <Section key={g.ply} title={`${g.ply} ply`} action={<span className="tnum text-[13px] font-semibold text-muted-foreground">{pcs(g.boxes)} in stock</span>}>
              {layout === 'tiles' ? (
                <TileGrid>
                  {g.items.map((x) => {
                    const level = boxStockLevel(x);
                    return (
                      <Tile
                        key={x.id}
                        onClick={() => openBox(x.id)}
                        badge={sizeOf(x)}
                        flag={level === 'out' ? 'Out' : level === 'low' ? 'Low' : undefined}
                        flagTone={level === 'out' ? 'bad' : 'warn'}
                        big={num(Math.max(0, x.stockQty || 0), 0)}
                        unit="pcs"
                        pct={boxFillPct(x, g.max)}
                        barTone={level === 'out' ? 'muted' : level === 'low' ? 'warn' : 'primary'}
                        left={x.stockMin != null ? `alert at ${num(x.stockMin, 0)}` : 'no alert'}
                        right={`${x.madeDays || 7} days to make`}
                        caption={x.name}
                        dim={level === 'out'}
                      />
                    );
                  })}
                </TileGrid>
              ) : (
                <List>
                  {g.items.map((x) => {
                    const level = boxStockLevel(x);
                    return (
                      <Row
                        key={x.id}
                        onClick={() => openBox(x.id)}
                        title={
                          <>
                            {sizeOf(x)} <span className="font-normal text-muted-foreground">· {x.ply} ply</span>
                          </>
                        }
                        sub={x.stockMin != null ? `Alert at ${pcs(x.stockMin)}` : 'No low-stock alert'}
                        right={
                          <span className="text-right">
                            <span className={`tnum block text-[15px] font-bold ${level === 'out' ? 'text-muted-foreground' : ''}`}>{pcs(Math.max(0, x.stockQty || 0))}</span>
                            <span className={`block text-[11.5px] font-bold uppercase tracking-wide ${level === 'out' ? 'text-bad' : level === 'low' ? 'text-warn' : 'text-muted-foreground'}`}>{level === 'out' ? 'Out' : level === 'low' ? 'Low' : 'In stock'}</span>
                          </span>
                        }
                      />
                    );
                  })}
                </List>
              )}
            </Section>
          ))}

          {untracked.length > 0 && (
            <Section title="Made to order (no stock kept)">
              {layout === 'tiles' ? (
                <TileGrid>
                  {untracked.map((x) => (
                    <button key={x.id} type="button" onClick={() => openBox(x.id)} className="flex min-h-[120px] flex-col rounded-2xl border-2 border-dashed border-border p-3.5 text-left transition active:scale-[0.98] active:bg-muted/60">
                      <span className="tnum inline-block self-start rounded-md bg-muted px-1.5 py-0.5 text-[12px] font-bold text-muted-foreground">{sizeOf(x)}</span>
                      <span className="mt-2 line-clamp-2 text-[13.5px] font-semibold">{x.name}</span>
                      <span className="mt-auto flex items-center gap-1 pt-2 text-[13px] font-semibold text-primary">
                        <Plus size={15} /> Start keeping stock
                      </span>
                    </button>
                  ))}
                </TileGrid>
              ) : (
                <List>
                  {untracked.map((x) => (
                    <Row key={x.id} onClick={() => openBox(x.id)} title={x.name} sub="Tap to add boxes made and start keeping stock" />
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
    </ListPage>
  );
}

/** One box: add boxes made, correct the count, see the history (a full page, like a reel in Paper stock). */
export function BoxStockItem({ id }: { id: string }) {
  const { data, cloud, cloudStatus, toast } = useStore();
  const perm = usePerms();
  const product = data.products.find((x) => x.id === id) || null;
  const online = cloudStatus.phase === 'ready';
  const canCorrect = perm.boxStockCorrect;
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

  if (!product || !perm.boxStock) {
    return (
      <>
        <Header title="Box stock" back />
        <Page>
          <p className="py-10 text-center text-muted-foreground">This box is no longer here.</p>
        </Page>
      </>
    );
  }

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
    <>
      <Header title={product.name} subtitle="Box stock" back />
      <Page>
      {!online && <p className="mb-4 rounded-xl bg-warn/10 p-3 text-[13.5px]">Box stock is kept in the cloud. Connect to the internet to change it.</p>}
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
      </Page>
    </>
  );
}
