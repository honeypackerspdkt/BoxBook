import { useState } from 'react';
import { AlertTriangle, ChevronRight, Layers, LayoutGrid, List as ListIcon, Pencil, Plus, Scissors, SlidersHorizontal, X } from 'lucide-react';
import { useStore } from '../store';
import { useNav } from '../nav';
import { fmtDate, fmtDateTime, money0, num, todayISO } from '../lib/format';
import { gradeLabel, incrementNumber, reelBalance, stockAlerts, stockByGrade, stockByWidth } from '../lib/stock';
import type { Reel, StockMoveKind } from '../lib/types';
import { Confirm, Empty, Fab, Field, Header, IconBtn, List, NumInput, Page, Row, Section, Segmented, Sheet, Toggle } from '../ui';
import { Missing } from './Customers';

const kg = (n: number) => `${num(n, 1)} kg`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const KIND: Record<StockMoveKind, string> = { issue: 'Issued', return: 'Returned', waste: 'Waste / trim', adjust: 'Correction' };

type Layout = 'tiles' | 'list';
const LAYOUT_KEY = 'boxbook-stock-layout';
const readLayout = (): Layout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'tiles';
  } catch {
    return 'tiles';
  }
};

type ReelItem = { reel: Reel; balance: number };

/** One reel as a tile: number, size or grade, how much is left as a bar, and where it came from. */
function ReelTile({ reel, balance, mode, onOpen }: ReelItem & { mode: 'grade' | 'size'; onOpen: () => void }) {
  const used = balance <= 0.001;
  const pct = reel.weightIn > 0 ? Math.max(0, Math.min(100, (balance / reel.weightIn) * 100)) : 0;
  const lowReel = !used && pct <= 15;
  return (
    <button type="button" onClick={onOpen} className={`card flex flex-col p-3.5 text-left transition active:scale-[0.98] ${used ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-muted-foreground">#{reel.number}</span>
        {used ? <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Used up</span> : lowReel ? <span className="text-[11px] font-bold uppercase tracking-wide text-warn">Almost done</span> : null}
      </div>
      <span className="tnum mt-1.5 inline-block self-start rounded-md bg-primary/12 px-1.5 py-0.5 text-[12px] font-bold text-primary">{mode === 'grade' ? `${num(reel.width, 0)} mm` : gradeLabel(reel.gsm, reel.bf)}</span>
      <div className="tnum mt-3 text-[26px] font-bold leading-none tracking-tight">
        {num(balance, 1)}
        <span className="ml-1 text-[13px] font-semibold text-muted-foreground">kg</span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${used ? 'bg-muted-foreground/40' : lowReel ? 'bg-warn' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="tnum mt-1 flex justify-between text-[11.5px] text-muted-foreground">
        <span>of {num(reel.weightIn, 0)} kg</span>
        <span>{Math.round(pct)}% left</span>
      </div>
      <div className="mt-2 truncate text-[12px] text-muted-foreground">
        {reel.supplier || 'No supplier'} · {fmtDate(reel.receivedAt)}
      </div>
    </button>
  );
}

/** A group's reels, as tiles or as a compact list, with an "add" tile / row at the end. */
function ReelItems({ layout, items, mode, addLabel, onOpen, onAdd }: { layout: Layout; items: ReelItem[]; mode: 'grade' | 'size'; addLabel: string; onOpen: (id: string) => void; onAdd: () => void }) {
  if (layout === 'tiles') {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((it) => (
          <ReelTile key={it.reel.id} {...it} mode={mode} onOpen={() => onOpen(it.reel.id)} />
        ))}
        <button type="button" onClick={onAdd} className="grid min-h-[150px] place-items-center rounded-2xl border-2 border-dashed border-border p-3 text-primary transition active:scale-[0.98] active:bg-muted/60">
          <span className="flex flex-col items-center gap-1.5 text-center text-[13.5px] font-semibold">
            <Plus size={22} />
            {addLabel}
          </span>
        </button>
      </div>
    );
  }
  return (
    <div className="card divide-y divide-border/60 overflow-hidden">
      {items.map(({ reel, balance }) => (
        <Row
          key={reel.id}
          onClick={() => onOpen(reel.id)}
          title={
            <>
              #{reel.number} <span className="font-normal text-muted-foreground">· {mode === 'grade' ? `${num(reel.width, 0)} mm` : gradeLabel(reel.gsm, reel.bf)}</span>
            </>
          }
          sub={`${reel.supplier || 'No supplier'} · ${fmtDate(reel.receivedAt)}`}
          right={
            <span className="text-right">
              <span className={`tnum block text-[15px] font-bold ${balance <= 0.001 ? 'text-muted-foreground' : ''}`}>{kg(balance)}</span>
              <span className="tnum block text-[11.5px] text-muted-foreground">of {num(reel.weightIn, 0)}</span>
            </span>
          }
        />
      ))}
      <button className="flex w-full items-center justify-center gap-1.5 px-4 py-3 text-[14px] font-semibold text-primary active:bg-muted/70" onClick={onAdd}>
        <Plus size={16} /> {addLabel}
      </button>
    </div>
  );
}

/** Paper stock by grade (BF · GSM), reel by reel. */
export function StockList() {
  const { data } = useStore();
  const nav = useNav();
  const [showEmpty, setShowEmpty] = useState(false);
  const groups = stockByGrade(data.reels, data.stockMoves, showEmpty);
  const totalKg = groups.reduce((s, g) => s + g.kg, 0);
  const reelCount = groups.reduce((s, g) => s + g.reels.filter((r) => r.balance > 0.001).length, 0);
  const value = groups.reduce((s, g) => s + g.value, 0);
  const add = () => nav.push({ name: 'reelEdit' });
  const [view, setView] = useState<'grade' | 'size'>('grade');
  const [layout, setLayoutState] = useState<Layout>(readLayout);
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      /* private mode: just not remembered */
    }
  };
  const widths = data.settings.reelWidths || [];
  const sizes = stockByWidth(data.reels, data.stockMoves, widths, showEmpty);
  const alerts = stockAlerts(data.reels, data.stockMoves, data.orders, data.settings.stockMin, data.settings.stockWastePct);
  const lowKeys = new Set(alerts.low.map((l) => l.key));

  return (
    <>
      <Header title="Paper stock" subtitle="Reels in the godown" back />
      <Page>
        <div className="mb-5 grid grid-cols-3 gap-3">
          {(
            [
              ['In stock', `${num(totalKg, totalKg < 100 ? 1 : 0)} kg`, 'text-primary'],
              ['Reels', String(reelCount), ''],
              ['Value', value >= 100000 ? `${data.settings.currency}${num(value / 100000, 1)} L` : money0(value, data.settings.currency), ''],
            ] as const
          ).map(([label, v, cls]) => (
            <div key={label} className="card px-3 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className={`tnum mt-1 text-[19px] font-bold leading-tight tracking-tight sm:text-[22px] ${cls}`}>{v}</div>
            </div>
          ))}
        </div>

        {(alerts.low.length > 0 || alerts.short.length > 0) && (
          <div className="mb-5 space-y-1.5 rounded-2xl bg-bad/10 p-4 text-bad">
            <div className="flex items-center gap-2 text-[14px] font-bold">
              <AlertTriangle size={18} /> Time to buy paper
            </div>
            {alerts.low.map((l) => (
              <p key={'l' + l.key} className="text-[13.5px]">
                <b>{gradeLabel(l.gsm, l.bf)}</b>: {l.kg > 0 ? kg(l.kg) : 'none'} left, keep at least {kg(l.min)}
              </p>
            ))}
            {alerts.short.map((x) => (
              <p key={'s' + x.key} className="text-[13.5px]">
                <b>{gradeLabel(x.gsm, x.bf)}</b>: open orders need {kg(x.missing)} more than is in stock
              </p>
            ))}
          </div>
        )}

        {(data.reels.length > 0 || widths.length > 0) && (
          <div className="mb-5 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <Segmented<'grade' | 'size'>
                value={view}
                onChange={setView}
                options={[
                  { value: 'grade', label: 'By paper grade' },
                  { value: 'size', label: 'By reel size' },
                ]}
              />
            </div>
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
        )}

        {view === 'size' ? (
          sizes.length === 0 ? (
            <div className="card p-5 text-center text-[14px] text-muted-foreground">Add the reel sizes you usually buy in App settings. Each size then shows what is in stock and what you bought.</div>
          ) : (
            sizes.map((g) => (
              <Section
                key={g.width}
                title={`${num(g.width, 0)} mm`}
                action={
                  <span className="tnum text-[13px] font-semibold text-muted-foreground">
                    {kg(g.kg)} in stock · {kg(g.purchased)} bought
                  </span>
                }
              >
                {g.reels.length === 0 && <p className="mb-2 px-1 text-[13.5px] text-muted-foreground">No reels in stock at this size.</p>}
                <ReelItems
                  layout={layout}
                  items={g.reels}
                  mode="size"
                  addLabel={`Purchased ${num(g.width, 0)} mm`}
                  onOpen={(id) => nav.push({ name: 'reel', id })}
                  onAdd={() => nav.push({ name: 'reelEdit', width: g.width })}
                />
              </Section>
            ))
          )
        ) : groups.length === 0 ? (
          <div className="card">
            <Empty
              icon={<Layers size={28} />}
              title="No reels yet"
              text="Add each paper reel when it arrives. Orders then show the paper they need and you issue it from the reels."
              action={
                <button className="btn-primary" onClick={add}>
                  <Plus size={18} /> Add a reel
                </button>
              }
            />
          </div>
        ) : (
          groups.map((g) => (
            <Section
              key={g.key}
              title={gradeLabel(g.gsm, g.bf)}
              action={
                <span className={`tnum text-[13px] font-semibold ${lowKeys.has(g.key) ? 'text-bad' : 'text-muted-foreground'}`}>
                  {lowKeys.has(g.key) && 'Low · '}
                  {plural(g.reels.filter((r) => r.balance > 0.001).length, 'reel')} · {kg(g.kg)}
                </span>
              }
            >
              <ReelItems
                layout={layout}
                items={g.reels}
                mode="grade"
                addLabel="Add reel"
                onOpen={(id) => nav.push({ name: 'reel', id })}
                onAdd={() => nav.push({ name: 'reelEdit', bf: g.bf, gsm: g.gsm })}
              />
            </Section>
          ))
        )}

        <Section title="View">
          <div className="card space-y-4 p-4">
            <Toggle checked={showEmpty} onChange={setShowEmpty} label="Show used-up reels" desc="Reels with nothing left are hidden from the list." />
            <button className="flex w-full items-center justify-between gap-3 border-t border-border/60 pt-4 text-left" onClick={() => nav.push({ name: 'settings', section: 'stock' })}>
              <span>
                <span className="block text-[15px] font-medium">Reel sizes, reorder levels, automatic issue</span>
                <span className="block text-[12.5px] text-muted-foreground">Change them in App settings</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
            </button>
          </div>
        </Section>
      </Page>
      {groups.length > 0 && <Fab label="Add reel" icon={<Plus size={20} />} onClick={add} />}
    </>
  );
}

/** One reel: balance, details and its movement ledger. */
export function ReelDetail({ id }: { id: string }) {
  const { data, addStockMove, deleteStockMove, toast } = useStore();
  const nav = useNav();
  const [adjOpen, setAdjOpen] = useState(false);
  const [delMove, setDelMove] = useState<string | null>(null);
  const reel = data.reels.find((r) => r.id === id);
  if (!reel) return <Missing />;
  const balance = reelBalance(reel, data.stockMoves);
  const moves = data.stockMoves.filter((m) => m.reelId === id).sort((a, b) => b.date.localeCompare(a.date));
  const pct = reel.weightIn > 0 ? Math.max(0, Math.min(100, (balance / reel.weightIn) * 100)) : 0;

  return (
    <>
      <Header
        title={`Reel #${reel.number}`}
        subtitle={gradeLabel(reel.gsm, reel.bf)}
        back
        actions={
          <IconBtn label="Edit" onClick={() => nav.push({ name: 'reelEdit', id })}>
            <Pencil size={19} />
          </IconBtn>
        }
      />
      <Page>
        <div className="lg:mx-auto lg:max-w-2xl">
          <div className="card mb-5 p-4">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Left on the reel</div>
            <div className="tnum mt-0.5 text-[28px] font-bold tracking-tight">{kg(balance)}</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
            </div>
            <div className="tnum mt-1 text-[12.5px] text-muted-foreground">of {kg(reel.weightIn)} received</div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/60 pt-4 text-[14px]">
              <Info k="Width" v={`${reel.width} mm`} />
              <Info k="Rate" v={reel.rate ? `${data.settings.currency}${num(reel.rate)} / kg` : '—'} />
              <Info k="Supplier" v={reel.supplier || '—'} />
              <Info k="Received" v={fmtDate(reel.receivedAt)} />
              <Info k="Value left" v={reel.rate ? money0(balance * reel.rate, data.settings.currency) : '—'} />
            </dl>
            {reel.note && <p className="mt-3 whitespace-pre-wrap border-t border-border/60 pt-3 text-[13.5px] text-muted-foreground">{reel.note}</p>}
          </div>

          <button className="btn-ghost mb-5 w-full" onClick={() => setAdjOpen(true)}>
            <SlidersHorizontal size={18} /> Record waste or correct the weight
          </button>

          <Section title="Movements">
            <List>
              {moves.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">
                      {KIND[m.kind]}
                      {m.orderNo && (
                        <button className="ml-1.5 font-semibold text-primary" onClick={() => m.orderId && data.orders.some((o) => o.id === m.orderId) && nav.push({ name: 'order', id: m.orderId })}>
                          {m.orderNo}
                        </button>
                      )}
                    </div>
                    <div className="truncate text-[12.5px] text-muted-foreground">
                      {fmtDateTime(m.date)}
                      {m.note ? ` · ${m.note}` : ''}
                    </div>
                  </div>
                  <span className={`tnum text-[15px] font-bold ${m.kg < 0 ? 'text-bad' : 'text-good'}`}>
                    {m.kg > 0 ? '+' : '−'}
                    {num(Math.abs(m.kg), 1)} kg
                  </span>
                  <button aria-label="Undo this movement" className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground active:bg-muted" onClick={() => setDelMove(m.id)}>
                    <X size={18} />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold">Received</div>
                  <div className="truncate text-[12.5px] text-muted-foreground">{fmtDate(reel.receivedAt)}</div>
                </div>
                <span className="tnum text-[15px] font-bold text-good">+{num(reel.weightIn, 1)} kg</span>
              </div>
            </List>
          </Section>
        </div>
      </Page>

      <AdjustSheet
        open={adjOpen}
        onClose={() => setAdjOpen(false)}
        balance={balance}
        onSave={(kind, amount, note) => {
          addStockMove({ reelId: id, kind, kg: amount, note });
          setAdjOpen(false);
          toast('Stock updated');
        }}
      />
      <Confirm
        open={delMove !== null}
        onClose={() => setDelMove(null)}
        title="Undo this movement?"
        text="It is removed from the ledger and the reel balance changes back."
        confirmLabel="Undo"
        onConfirm={() => {
          if (delMove) deleteStockMove(delMove);
          toast('Movement removed');
        }}
      />
    </>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[12px] text-muted-foreground">{k}</dt>
      <dd className="font-semibold">{v}</dd>
    </div>
  );
}

function AdjustSheet({ open, onClose, balance, onSave }: { open: boolean; onClose: () => void; balance: number; onSave: (kind: StockMoveKind, kg: number, note: string) => void }) {
  const [kind, setKind] = useState<'waste' | 'less' | 'more'>('waste');
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const removes = kind !== 'more';
  const tooMuch = removes && amount > balance + 0.001;
  const save = () => {
    if (!(amount > 0) || tooMuch) return;
    onSave(kind === 'waste' ? 'waste' : 'adjust', removes ? -amount : amount, note.trim());
    setAmount(0);
    setNote('');
  };
  return (
    <Sheet open={open} onClose={onClose} title="Waste or correction">
      <div className="space-y-4">
        <Segmented<'waste' | 'less' | 'more'>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'waste', label: 'Waste' },
            { value: 'less', label: 'Weighs less' },
            { value: 'more', label: 'Weighs more' },
          ]}
        />
        <p className="text-[13px] text-muted-foreground">
          {kind === 'waste' ? 'Paper thrown away: damaged outer wraps, end of reel, spoilage not tied to one order.' : 'Use after weighing the reel: enter only the difference from what the app shows.'}
        </p>
        <Field label="Kg" hint={tooMuch ? `Only ${kg(balance)} is left on this reel.` : undefined}>
          <NumInput value={amount} onValue={setAmount} suffix="kg" />
        </Field>
        <Field label="Note (optional)">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. damp outer layers" />
        </Field>
        <button className="btn-primary w-full" disabled={!(amount > 0) || tooMuch} onClick={save}>
          <Scissors size={18} /> Save
        </button>
      </div>
    </Sheet>
  );
}

/** Add or edit a reel. */
export function ReelEdit({ id, width, bf, gsm }: { id?: string; width?: number; bf?: number; gsm?: number }) {
  const { data, upsertReel, deleteReel, toast } = useStore();
  const nav = useNav();
  const existing = id ? data.reels.find((r) => r.id === id) : undefined;
  const nextNo = () => incrementNumber(data.reels[0]?.number ?? 'R-000');
  const blank = (): Pick<Reel, 'number' | 'supplier' | 'bf' | 'gsm' | 'width' | 'weightIn' | 'rate' | 'receivedAt' | 'note'> => ({
    number: nextNo(),
    supplier: '',
    bf: bf ?? 0,
    gsm: gsm ?? 0,
    width: width ?? 0,
    weightIn: 0,
    rate: 0,
    receivedAt: todayISO(),
    note: '',
  });
  const [f, setF] = useState(() => (existing ? { ...existing } : blank()));
  const [del, setDel] = useState(false);
  const [saved, setSaved] = useState(0);
  const [count, setCount] = useState(1);
  const sizes = data.settings.reelWidths || [];
  if (id && !existing) return <Missing />;

  const ok = f.number.trim() && f.gsm > 0 && f.bf > 0 && f.width > 0 && f.weightIn > 0;
  const save = (another: boolean) => {
    if (!ok) {
      toast('Fill in reel no., BF, GSM, width and weight');
      return;
    }
    const n = existing ? 1 : Math.max(1, Math.min(50, Math.floor(count) || 1));
    let number = f.number.trim();
    for (let i = 0; i < n; i++) {
      upsertReel({ ...f, id: existing?.id, number, supplier: f.supplier.trim(), note: f.note.trim() });
      if (i < n - 1) number = incrementNumber(number);
    }
    toast(existing ? 'Reel updated' : n > 1 ? `${n} reels added` : 'Reel added');
    if (another) {
      // keep supplier, date, grade, size and rate: reels usually arrive in a batch
      setF((x) => ({ ...x, number: incrementNumber(number), weightIn: 0, note: '' }));
      setSaved((c) => c + n);
    } else nav.back();
  };

  return (
    <>
      <Header title={existing ? `Edit reel #${existing.number}` : 'Add reel'} subtitle={saved ? `${saved} added in this batch` : undefined} back />
      <Page>
        <div className="lg:mx-auto lg:max-w-2xl">
          <Section title="Paper">
            <div className="card space-y-4 p-4">
              <div className="grid grid-cols-3 gap-3">
                <Field label="BF">
                  <NumInput value={f.bf} onValue={(v) => setF({ ...f, bf: v })} />
                </Field>
                <Field label="GSM">
                  <NumInput value={f.gsm} onValue={(v) => setF({ ...f, gsm: v })} />
                </Field>
                <Field label="Width">
                  <NumInput value={f.width} onValue={(v) => setF({ ...f, width: v })} suffix="mm" />
                </Field>
              </div>
              {sizes.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] text-muted-foreground">Common sizes</span>
                  {sizes.map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setF({ ...f, width: w })}
                      className={`rounded-full px-3 py-1 text-[13px] font-semibold ${f.width === w ? 'bg-primary text-white' : 'bg-primary/12 text-primary'}`}
                    >
                      {num(w, 0)}
                    </button>
                  ))}
                </div>
              )}
              <div className={`grid gap-3 ${existing ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {!existing && (
                  <Field label="Reels">
                    <NumInput value={count} onValue={(v) => setCount(Math.floor(v) || 0)} />
                  </Field>
                )}
                <Field label={!existing && count > 1 ? 'Weight each' : 'Weight'}>
                  <NumInput value={f.weightIn} onValue={(v) => setF({ ...f, weightIn: v })} suffix="kg" />
                </Field>
                <Field label="Rate / kg">
                  <NumInput value={f.rate} onValue={(v) => setF({ ...f, rate: v })} suffix={data.settings.currency} />
                </Field>
              </div>
              {!existing && count > 1 && f.weightIn > 0 && (
                <p className="text-[12.5px] text-muted-foreground">
                  Adds {count} reels, #{f.number} onwards, {num(f.weightIn, 1)} kg each: {num(count * f.weightIn, 1)} kg in all.
                </p>
              )}
            </div>
          </Section>

          <Section title="Details">
            <div className="card space-y-4 p-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Reel no.">
                  <input className="input" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} />
                </Field>
                <Field label="Received on">
                  <input className="input" type="date" value={f.receivedAt} onChange={(e) => setF({ ...f, receivedAt: e.target.value })} />
                </Field>
              </div>
              <Field label="Supplier / mill">
                <input className="input" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} list="boxbook-suppliers" />
                <datalist id="boxbook-suppliers">
                  {[...new Set(data.reels.map((r) => r.supplier).filter(Boolean))].map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
              <Field label="Note (optional)">
                <textarea className="input min-h-[72px]" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
              </Field>
            </div>
          </Section>

          <button className="btn-primary w-full" onClick={() => save(false)}>
            {existing ? 'Save changes' : 'Save reel'}
          </button>
          {!existing && (
            <button className="btn-ghost mt-3 w-full" onClick={() => save(true)}>
              <Plus size={18} /> Save & add another
            </button>
          )}
          {existing && (
            <button className="btn-danger mt-3 w-full" onClick={() => setDel(true)}>
              Delete reel
            </button>
          )}
        </div>
      </Page>
      <Confirm
        open={del}
        onClose={() => setDel(false)}
        title="Delete this reel?"
        text={`Reel #${existing?.number} and all its movements are removed. Paper already issued to orders is no longer tracked. This cannot be undone.`}
        onConfirm={() => {
          if (existing) deleteReel(existing.id);
          toast('Reel deleted');
          nav.setTab('more');
          nav.push({ name: 'stock' });
        }}
      />
    </>
  );
}
