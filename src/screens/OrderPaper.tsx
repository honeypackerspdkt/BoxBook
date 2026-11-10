import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Layers, Undo2 } from 'lucide-react';
import { useStore } from '../store';
import { useNav } from '../nav';
import { fmtDateTime, num } from '../lib/format';
import { availableNet, gradeLabel, issuedNet, matchingReels, nearestWidth, paperNeed, reelDraw, type PaperNeed } from '../lib/stock';
import type { Order } from '../lib/types';
import { NumInput, Section, Sheet } from '../ui';

const kg = (n: number) => `${num(n, 1)} kg`;

/** Paper an order needs, what has been issued from the reels, and what is short. Shown on the order page. */
export function OrderPaper({ order }: { order: Order }) {
  const { data, autoIssue, toast } = useStore();
  const nav = useNav();
  const [issueFor, setIssueFor] = useState<string | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const needs = useMemo(() => paperNeed(order.items), [order.items]);
  const mine = data.stockMoves.filter((m) => m.orderId === order.id).sort((a, b) => b.date.localeCompare(a.date));
  if (needs.length === 0 && mine.length === 0) return null;
  // per reel: what this order took, less what went back
  const takenMap = new Map<string, { reelId: string; net: number; back: number; last: string }>();
  for (const m of mine) {
    if (m.kind !== 'issue' && m.kind !== 'return') continue;
    const t = takenMap.get(m.reelId) ?? { reelId: m.reelId, net: 0, back: 0, last: m.date };
    t.net = Math.round((t.net - m.kg) * 1000) / 1000;
    if (m.kind === 'return') t.back += m.kg;
    takenMap.set(m.reelId, t);
  }
  const taken = [...takenMap.values()].filter((t) => t.net > 0 || t.back > 0);

  const extra = 1 + (data.settings.stockWastePct || 0) / 100;
  const canIssue = order.status === 'confirmed' || order.status === 'production' || order.status === 'ready';
  const rows = needs.map((n) => {
    const plan = Math.round(n.kg * extra * 10) / 10;
    const done = issuedNet(order.id, n, data.reels, data.stockMoves);
    const remaining = Math.max(0, Math.round((plan - done) * 10) / 10);
    return { n, plan, done, remaining, avail: availableNet(n, data.reels, data.stockMoves) };
  });
  const active = rows.find((r) => r.n.key === issueFor);
  const reelNo = (id: string) => data.reels.find((r) => r.id === id)?.number ?? '?';

  return (
    <>
      <Section title="Paper needed">
        <div className="card divide-y divide-border/60">
          {rows.map(({ n, plan, done, remaining, avail }) => {
            const short = remaining > 0 && avail < remaining - 0.05;
            return (
              <div key={n.key} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[15px] font-semibold">{gradeLabel(n.gsm, n.bf)}</div>
                    <div className="text-[12.5px] text-muted-foreground">
                      Reel at least {n.minWidth} mm wide
                      {(data.settings.reelWidths || []).length > 0 && (() => {
                        const w = nearestWidth(data.settings.reelWidths, n.minWidth);
                        return w ? ` · common size ${w} mm` : ' · no common size is wide enough';
                      })()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tnum text-[17px] font-bold">{kg(plan)}</div>
                    <div className="tnum text-[11.5px] text-muted-foreground">{kg(n.kg)} + {num(data.settings.stockWastePct, 0)}% extra</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[13px]">
                  {remaining <= 0 ? (
                    <span className="flex items-center gap-1 font-semibold text-good">
                      <Check size={15} /> Issued {kg(done)}
                    </span>
                  ) : (
                    <span className={`flex items-center gap-1 font-semibold ${short ? 'text-bad' : 'text-muted-foreground'}`}>
                      {short && <AlertTriangle size={15} />}
                      {done > 0 ? `${kg(remaining)} more · ` : ''}
                      {short ? (avail > 0 ? `only ${kg(avail)} in stock` : 'none in stock') : `${kg(avail)} in stock`}
                    </span>
                  )}
                  {canIssue && remaining > 0 && (
                    <button className="rounded-lg bg-primary/12 px-3 py-1.5 text-[13px] font-bold text-primary active:bg-primary/20" onClick={() => setIssueFor(n.key)}>
                      Issue reels
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {!canIssue && needs.length > 0 && (
            <p className="px-4 py-3 text-[12.5px] text-muted-foreground">
              {order.status === 'cancelled' ? 'This order is cancelled. Return any paper it took, below.' : `Paper is issued from the reels ${data.settings.autoIssue ? 'automatically ' : ''}when the order is confirmed.`}
            </p>
          )}
          {canIssue && rows.some((r) => r.remaining > 0) && (
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[12.5px] text-muted-foreground">{data.settings.autoIssue ? 'Short earlier? Add the reels, then try again.' : 'Automatic issue is off in Paper stock.'}</span>
              <button
                className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-bold text-white active:opacity-90"
                onClick={() => toast(autoIssue(order, true) || 'Nothing more to issue')}
              >
                Issue automatically
              </button>
            </div>
          )}
          {taken.length > 0 && (
            <div className="bg-muted/30">
              <div className="px-4 pb-1 pt-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">Taken from reels</div>
              {taken.map((t) => (
                <div key={t.reelId} className="flex items-center gap-3 px-4 py-2">
                  <button className="min-w-0 flex-1 text-left" onClick={() => nav.push({ name: 'reel', id: t.reelId })}>
                    <div className="text-[14px] font-semibold">Reel #{reelNo(t.reelId)}</div>
                    <div className="text-[12px] text-muted-foreground">
                      {fmtDateTime(t.last)}
                      {t.back > 0 ? ` · ${kg(t.back)} returned` : ''}
                    </div>
                  </button>
                  <span className="tnum text-[14px] font-bold">{kg(t.net)}</span>
                  {t.net > 0 && (
                    <button className="flex items-center gap-1 rounded-lg px-2 py-1 text-[12.5px] font-semibold text-muted-foreground active:bg-muted" onClick={() => setReturning(t.reelId)}>
                      <Undo2 size={14} /> Return
                    </button>
                  )}
                </div>
              ))}
              <div className="h-2" />
            </div>
          )}
        </div>
      </Section>

      <ReturnSheet
        order={order}
        reelId={returning}
        max={taken.find((t) => t.reelId === returning)?.net ?? 0}
        label={returning ? `Reel #${reelNo(returning)}` : ''}
        onClose={() => setReturning(null)}
      />
      <IssueSheet order={order} row={active ? { need: active.n, remaining: active.remaining } : null} onClose={() => setIssueFor(null)} />
    </>
  );
}

function ReturnSheet({ order, reelId, max, label, onClose }: { order: Order; reelId: string | null; max: number; label: string; onClose: () => void }) {
  const { addStockMove, toast } = useStore();
  const [amount, setAmount] = useState(0);
  const tooMuch = amount > max + 0.001;
  return (
    <Sheet open={!!reelId} onClose={onClose} title={`Return paper to ${label}`}>
      <div className="space-y-4">
        <p className="text-[13px] text-muted-foreground">
          {order.number} has {kg(max)} out of this reel. Enter what is left over and goes back on the reel.
        </p>
        <label className="block">
          <span className="label">Kg returned</span>
          <NumInput value={amount} onValue={setAmount} suffix="kg" />
          {tooMuch && <span className="mt-1 block text-[12px] text-bad">At most {kg(max)}.</span>}
        </label>
        <button
          className="btn-primary w-full"
          disabled={!(amount > 0) || tooMuch}
          onClick={() => {
            if (!reelId) return;
            addStockMove({ reelId, kind: 'return', kg: amount, orderId: order.id });
            toast(`${kg(amount)} back on ${label}`);
            setAmount(0);
            onClose();
          }}
        >
          Return {amount > 0 ? kg(amount) : ''}
        </button>
      </div>
    </Sheet>
  );
}

function IssueSheet({ order, row, onClose }: { order: Order; row: { need: PaperNeed; remaining: number } | null; onClose: () => void }) {
  const { data, addStockMove, toast } = useStore();
  const nav = useNav();
  const [pick, setPick] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const choices = row ? matchingReels(row.need, data.reels, data.stockMoves) : [];

  const close = () => {
    setPick(null);
    onClose();
  };

  return (
    <Sheet open={!!row} onClose={close} title={row ? `Issue ${gradeLabel(row.need.gsm, row.need.bf)}` : ''}>
      {row && (
        <div className="space-y-3">
          <p className="text-[13px] text-muted-foreground">
            {order.number} still needs <b className="text-foreground">{kg(row.remaining)}</b> of usable paper, cut at {row.need.minWidth} mm. The kg taken from a wider reel includes the side trim.
          </p>
          {choices.length === 0 ? (
            <div className="rounded-xl bg-muted p-4 text-[14px]">
              <div className="flex items-center gap-2 font-semibold">
                <Layers size={16} /> No reel can be used
              </div>
              <p className="mt-1 text-muted-foreground">
                Nothing in stock at {row.need.gsm} GSM, {row.need.bf} BF or higher, at least {row.need.minWidth} mm wide.
              </p>
              <button
                className="mt-3 font-semibold text-primary"
                onClick={() => {
                  close();
                  nav.push({ name: 'reelEdit' });
                }}
              >
                Add a reel
              </button>
            </div>
          ) : (
            choices.map((c) => {
              const open = pick === c.reel.id;
              const suggested = Math.min(c.balance, reelDraw(row.remaining, c.reel.width, row.need.minWidth));
              const tooMuch = amount > c.balance + 0.001;
              return (
                <div key={c.reel.id} className={`overflow-hidden rounded-xl border ${open ? 'border-primary' : 'border-border'}`}>
                  <button
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    onClick={() => {
                      setPick(open ? null : c.reel.id);
                      setAmount(Math.round(suggested * 10) / 10);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold">
                        #{c.reel.number} <span className="font-normal text-muted-foreground">· {c.reel.width} mm</span>
                        {c.higherBf && <span className="ml-1.5 text-[11.5px] font-semibold text-primary">{c.reel.bf} BF</span>}
                      </div>
                      <div className="text-[12.5px] text-muted-foreground">
                        {c.trim === 0 ? 'No side trim' : `${c.trim} mm side trim`}
                        {c.reel.supplier ? ` · ${c.reel.supplier}` : ''}
                      </div>
                    </div>
                    <span className="tnum text-[15px] font-bold">{kg(c.balance)}</span>
                  </button>
                  {open && (
                    <div className="space-y-3 border-t border-border/60 bg-muted/30 p-4">
                      <label className="block">
                        <span className="label">Kg to take off this reel</span>
                        <NumInput value={amount} onValue={setAmount} suffix="kg" />
                        {tooMuch && <span className="mt-1 block text-[12px] text-bad">Only {kg(c.balance)} is left on this reel.</span>}
                      </label>
                      <button
                        className="btn-primary w-full"
                        disabled={!(amount > 0) || tooMuch}
                        onClick={() => {
                          addStockMove({ reelId: c.reel.id, kind: 'issue', kg: -amount, orderId: order.id });
                          toast(`${kg(amount)} issued from reel #${c.reel.number}`);
                          close();
                        }}
                      >
                        Issue {amount > 0 ? kg(amount) : ''}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </Sheet>
  );
}
