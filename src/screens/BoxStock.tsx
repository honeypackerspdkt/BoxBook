import { useEffect, useState } from 'react';
import { AlertTriangle, History, Package, Plus, SlidersHorizontal } from 'lucide-react';
import { usePerms, useStore } from '../store';
import { useNav } from '../nav';
import { fmtDateTime, num } from '../lib/format';
import { boxStockLevel, boxStockList, KIND_LABEL } from '../lib/box-stock';
import type { BoxStockMove } from '../lib/cloud/supabase-api';
import type { Product } from '../lib/types';
import { Empty, Field, Header, List, NumInput, Page, Row, Section, Segmented, Sheet } from '../ui';

const api = () => import('../lib/cloud/supabase-api');
const pcs = (n: number) => `${num(n, 0)} pcs`;

/**
 * Ready-made boxes of the website's standard products. Stock goes up when boxes are made, down when a website
 * order is paid / confirmed (database trigger), back up when that order is cancelled. Manual orders don't touch it.
 */
export function BoxStock() {
  const { data, cloudStatus } = useStore();
  const p = usePerms();
  const nav = useNav();
  const [openId, setOpenId] = useState<string | null>(null);
  const online = cloudStatus.phase === 'ready';
  const { tracked, untracked } = boxStockList(data.products.filter((x) => x.active || x.stockQty != null));
  const open = data.products.find((x) => x.id === openId) || null;

  if (!p.boxStock) return <Header title="Box stock" back />;

  return (
    <>
      <Header title="Box stock" subtitle="Ready-made boxes for online orders" back />
      <Page>
        {!online && <p className="mb-4 rounded-xl bg-warn/10 p-3 text-[13.5px]">Box stock is kept in the cloud. Connect to the internet to change it.</p>}
        {!data.products.length ? (
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
        ) : (
          <>
            <Section title="In stock">
              {tracked.length ? (
                <List>
                  {tracked.map((x) => (
                    <StockRow key={x.id} product={x} onOpen={() => setOpenId(x.id)} />
                  ))}
                </List>
              ) : (
                <p className="card p-4 text-[13.5px] text-muted-foreground">No box is kept in stock yet. Open a box below and add the boxes you made.</p>
              )}
            </Section>
            {untracked.length > 0 && (
              <Section title="Made to order (no stock kept)">
                <List>
                  {untracked.map((x) => (
                    <Row key={x.id} onClick={() => setOpenId(x.id)} title={x.name} sub="Tap to add boxes made and start keeping stock" />
                  ))}
                </List>
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

function StockRow({ product, onOpen }: { product: Product; onOpen: () => void }) {
  const level = boxStockLevel(product);
  const badge =
    level === 'out' ? (
      <span className="text-[11px] font-bold uppercase tracking-wide text-destructive">Out</span>
    ) : level === 'low' ? (
      <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-warn">
        <AlertTriangle size={12} /> Low
      </span>
    ) : null;
  return (
    <Row
      onClick={onOpen}
      title={product.name}
      sub={product.stockMin != null ? `Alert at ${pcs(product.stockMin)}` : 'No low-stock alert'}
      right={
        <span className="flex flex-col items-end">
          <span className="tnum text-[17px] font-bold">{num(product.stockQty || 0, 0)}</span>
          {badge}
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
                  <span className={`tnum shrink-0 font-bold ${m.qty < 0 ? 'text-destructive' : 'text-primary'}`}>
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
