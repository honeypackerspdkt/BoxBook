import { useEffect, useMemo, useState } from 'react';
import { Box, Check, ClipboardList, Copy, Download, FileText, Globe, Link2, MessageCircle, Pencil, Phone, Plus, Share2, Smartphone, Trash2, UserPlus, Wallet, X } from 'lucide-react';
import { artworkSummary } from '@honeypackers/box-core/artwork';
import { cloudConfigured } from '../lib/cloud/supabase-api';
import { usePerms, useStore } from '../store';
import { canMoveStatus } from '../lib/roles';
import { useNav } from '../nav';
import { calcBox, estimate, isOpen, orderTotals, specLabel } from '@honeypackers/box-core/calc';
import { fmtDate, money, money0, num, relDays, telHref, todayISO, uid, waHref } from '../lib/format';
import { orderText, shareText } from '../lib/share';
import { shareFile } from '../lib/sharefile';
import type { InvoiceMeta, Order, OrderItem, OrderStatus } from '../lib/types';
import { Confirm, Empty, Fab, Field, Header, IconBtn, List, NumInput, Page, Row, SearchBox, Section, Sheet, STATUS, STATUS_FLOW, StatusChip } from '../ui';
import { Missing } from './Customers';

type Filter = 'all' | 'active' | OrderStatus;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'quote', label: 'Quotation' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'production', label: 'In production' },
  { value: 'ready', label: 'Ready' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PAY_MODES = ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Other'];

/** Where an order came from: online (website) or manual (made in the app). */
type Source = 'any' | 'web' | 'app';
const SOURCES: { value: Source; label: string }[] = [
  { value: 'any', label: 'Online + manual' },
  { value: 'web', label: 'Online' },
  { value: 'app', label: 'Manual' },
];
const sourceOf = (o: Order): 'web' | 'app' => (o.source === 'web' ? 'web' : 'app');

export function SourceChip({ o }: { o: Order }) {
  const web = sourceOf(o) === 'web';
  return (
    <span className={`chip shrink-0 ${web ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground'}`} title={web ? 'Ordered on the website' : 'Made in BoxBook'}>
      {web ? <Globe size={12} /> : <Smartphone size={12} />}
      {web ? 'Online' : 'Manual'}
    </span>
  );
}

/** The print design a buyer made on the website: preview, logo file and where everything goes. */
function ArtworkCard({ o }: { o: Order }) {
  const a = o.artwork!;
  const [urls, setUrls] = useState<{ preview?: string; logo?: string; error?: string }>({});
  useEffect(() => {
    if (!cloudConfigured || (!a.preview && !a.logo)) return;
    let live = true;
    import('../lib/cloud/supabase-api')
      .then(async (api) => ({
        preview: a.preview ? await api.privateFileUrl(a.preview) : undefined,
        logo: a.logo ? await api.privateFileUrl(a.logo) : undefined,
      }))
      .then((u) => live && setUrls(u))
      .catch(() => live && setUrls({ error: 'Connect to the internet to see the artwork.' }));
    return () => {
      live = false;
    };
  }, [a.preview, a.logo]);
  return (
    <Section title="Print artwork">
      <div className="card space-y-3 p-4">
        {urls.preview ? (
          <img src={urls.preview} alt={`Print design for ${o.number}`} className="w-full rounded-lg border border-border/60" />
        ) : (
          <div className="grid aspect-[2/1] place-items-center rounded-lg bg-muted text-[13px] text-muted-foreground">{urls.error || (a.preview ? 'Loading preview…' : 'No preview')}</div>
        )}
        <ul className="space-y-1 text-[14px]">
          {artworkSummary(a).map((l, i) => (
            <li key={i} className={i ? 'text-muted-foreground' : 'font-semibold'}>{l}</li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-3">
          {urls.preview && (
            <a className="btn-ghost" href={urls.preview} target="_blank" rel="noreferrer" download={`${o.number}-design.png`}>
              <Download size={18} /> Design
            </a>
          )}
          {urls.logo && (
            <a className="btn-ghost" href={urls.logo} target="_blank" rel="noreferrer" download={`${o.number}-logo`}>
              <Download size={18} /> Logo file
            </a>
          )}
        </div>
      </div>
    </Section>
  );
}

const matches = (o: Order, f: Filter) => (f === 'all' ? true : f === 'active' ? isOpen(o) : o.status === f);
const byNewest = (a: Order, b: Order) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number);

export function OrdersList() {
  const p = usePerms();
  const { data } = useStore();
  const nav = useNav();
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filter>('all');
  const [src, setSrc] = useState<Source>('any');
  const cur = data.settings.currency;
  const customers = useMemo(() => new Map(data.customers.map((c) => [c.id, c])), [data.customers]);

  const counts = useMemo(() => {
    const m = new Map<Filter, number>();
    const inSrc = data.orders.filter((o) => src === 'any' || sourceOf(o) === src);
    for (const x of FILTERS) m.set(x.value, inSrc.filter((o) => matches(o, x.value)).length);
    return m;
  }, [data.orders, src]);
  const srcCounts = useMemo(() => {
    const web = data.orders.filter((o) => sourceOf(o) === 'web').length;
    return { any: data.orders.length, web, app: data.orders.length - web } as Record<Source, number>;
  }, [data.orders]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.orders
      .filter((o) => matches(o, f))
      .filter((o) => src === 'any' || sourceOf(o) === src)
      .filter((o) => {
        if (!s) return true;
        const c = customers.get(o.customerId);
        return [o.number, c?.name, c?.company, ...o.items.map((i) => i.description)].some((x) => x?.toLowerCase().includes(s));
      })
      .sort(byNewest);
  }, [data.orders, customers, q, f, src]);

  return (
    <>
      <Header title="Orders" subtitle={`${data.orders.length} total`} large />
      <Page>
        {data.orders.length === 0 ? (
          <Empty
            icon={<ClipboardList size={28} />}
            title={p.editOrders ? 'No orders yet' : 'No jobs right now'}
            text={p.editOrders ? 'Create a quotation or order for a customer. Track its status, deliveries and payments here.' : 'Orders for you appear here as soon as the office confirms them.'}
            action={
              p.editOrders && (
                <button className="btn-primary" onClick={() => nav.push({ name: 'orderEdit' })}>
                  <Plus size={18} /> New order
                </button>
              )
            }
          />
        ) : (
          <>
            <div className="mb-3">
              <SearchBox value={q} onChange={setQ} placeholder="Search order, customer, item…" />
            </div>
            <div className="mb-2 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Online or manual orders">
              {SOURCES.map((x) => (
                <button
                  key={x.value}
                  onClick={() => setSrc(x.value)}
                  aria-pressed={src === x.value}
                  className={`rounded-lg px-2 py-2 text-[13px] font-semibold ${src === x.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
                >
                  {x.label} <span className="tnum opacity-60">{srcCounts[x.value]}</span>
                </button>
              ))}
            </div>
            <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
              {FILTERS.map((x) => (
                <button
                  key={x.value}
                  onClick={() => setF(x.value)}
                  className={`chip shrink-0 px-3.5 py-2 text-[13px] ${f === x.value ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}
                >
                  {x.label}
                  <span className={`tnum ${f === x.value ? 'opacity-80' : 'opacity-60'}`}>{counts.get(x.value)}</span>
                </button>
              ))}
            </div>
            {list.length === 0 ? (
              <p className="py-10 text-center text-muted-foreground">No orders match.</p>
            ) : (
              <List>
                {list.map((o) => {
                  const t = orderTotals(o);
                  const c = customers.get(o.customerId);
                  const late = isOpen(o) && o.dueDate && o.dueDate < todayISO();
                  return (
                    <Row
                      key={o.id}
                      onClick={() => nav.push({ name: 'order', id: o.id })}
                      title={
                        <span className="flex items-center gap-2">
                          <span className="truncate">{c?.name || o.customerName || 'Unknown customer'}</span>
                          <StatusChip s={o.status} />
                          <SourceChip o={o} />
                        </span>
                      }
                      sub={
                        <>
                          {o.number} · {fmtDate(o.date)}
                          {o.dueDate && isOpen(o) && <span className={late ? 'font-semibold text-bad' : ''}> · Due {relDays(o.dueDate).toLowerCase()}</span>}
                        </>
                      }
                      right={
                        p.money && (
                        <span className="tnum text-right">
                          <span className="block text-[14px] font-semibold">{money0(t.total, cur)}</span>
                          {t.balance > 0.5 && o.status !== 'quote' && <span className="block text-[11px] font-medium text-bad">{money0(t.balance, cur)} due</span>}
                        </span>
                        )
                      }
                    />
                  );
                })}
              </List>
            )}
          </>
        )}
      </Page>
      {data.orders.length > 0 && p.editOrders && <Fab label="Order" icon={<Plus size={20} />} onClick={() => nav.push({ name: 'orderEdit' })} />}
    </>
  );
}

export function OrderDetail({ id }: { id: string }) {
  const { data, upsertOrder, updateSettings, deleteOrder, toast, cloud, markInboxSeen } = useStore();
  const p = usePerms();
  const isNewWebOrder = !!data.orders.find((x) => x.id === id && x.source === 'web') && !(data.settings.inboxSeen || []).includes(id);
  useEffect(() => {
    if (isNewWebOrder) markInboxSeen([id]);
  }, [isNewWebOrder, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const nav = useNav();
  const [invBusy, setInvBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [delOrder, setDelOrder] = useState(false);
  const [delPay, setDelPay] = useState<string | null>(null);
  const o = data.orders.find((x) => x.id === id);
  const cur = data.settings.currency;
  if (!o) return <Missing />;
  const c = data.customers.find((x) => x.id === o.customerId);
  const t = orderTotals(o);
  const idx = STATUS_FLOW.indexOf(o.status);
  const next = idx >= 0 && idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : undefined;
  const late = isOpen(o) && o.dueDate && o.dueDate < todayISO();

  const canMove = (s: OrderStatus) => s !== o.status && canMoveStatus(p.role, o.status, s);
  const setStatus = (s: OrderStatus) => {
    if (!canMove(s)) return;
    if (p.editOrders) {
      upsertOrder({ ...o, status: s });
      toast(`Marked ${STATUS[s].label.toLowerCase()}`);
      return;
    }
    // Production / dispatch: through the server, which checks the step is allowed for the role.
    cloud
      .setOrderStatus(o.id, s)
      .then(() => toast(`Marked ${STATUS[s].label.toLowerCase()}`))
      .catch((e) => {
        const m = String((e as Error)?.message || e);
        toast(/fetch|network|load failed/i.test(m) ? 'No internet connection. Try again when you are online.' : m);
      });
  };

  const text = orderText(o, c, data.settings);
  const share = async () => {
    const m = await shareText(`Order ${o.number}`, text);
    if (m) toast(m);
  };

  /** Razorpay payment link for the amount due, sent to the customer on WhatsApp (or the share sheet). */
  const sendPayLink = async () => {
    if (linkBusy) return;
    setLinkBusy(true);
    try {
      const link = await cloud.paymentLink(o.id);
      const msg = `${data.settings.businessName || 'Honey Packers'}: payment for order ${link.orderNumber || o.number}\nAmount: ${money(link.amount, cur)}\nPay securely here: ${link.url}`;
      if (c?.phone) window.open(waHref(c.phone, msg), '_blank');
      else {
        const m = await shareText(`Payment link ${o.number}`, msg);
        if (m) toast(m);
      }
    } catch (e) {
      toast(String((e as Error)?.message || e));
    } finally {
      setLinkBusy(false);
    }
  };

  /** Makes the GST tax invoice PDF and opens the share sheet (WhatsApp, e-mail, Drive…). */
  const sendInvoice = async () => {
    if (invBusy) return;
    const s = data.settings;
    if (!s.businessName.trim()) {
      toast('Fill in your company profile first');
      nav.push({ name: 'company' });
      return;
    }
    if (o.items.length === 0) {
      toast('Add an item before making an invoice');
      return;
    }
    setInvBusy(true);
    try {
      const { buildInvoiceModel, formatInvoiceNo, renderInvoicePdf } = await import('@honeypackers/box-core/invoice');
      let no = o.invoiceNo;
      if (!no && cloud.active) {
        // GST invoice numbers come from the cloud so two phones can never use the same one.
        try {
          no = await cloud.assignInvoiceNo(o.id);
        } catch (e) {
          toast(`Invoice number needs internet: ${String((e as Error)?.message || e)}`);
          return;
        }
      } else if (!no) {
        no = formatInvoiceNo(s);
        upsertOrder({ ...o, invoiceNo: no });
        updateSettings({ nextInvoiceNo: s.nextInvoiceNo + 1 });
      }
      const model = buildInvoiceModel({ ...o, invoiceNo: no }, c, s, no);
      const { bytes, fileName } = await renderInvoicePdf(model);
      const note = `Invoice ${no} from ${s.businessName}\nAmount: ${money(model.total, s.currency)}`;
      const m = await shareFile(fileName, bytes, 'application/pdf', `Invoice ${no}`, note);
      if (m) toast(m);
    } catch (e) {
      toast(e instanceof Error ? `Could not make invoice: ${e.message}` : 'Could not make invoice');
    } finally {
      setInvBusy(false);
    }
  };

  const duplicate = () => {
    const n = upsertOrder({
      customerId: o.customerId,
      date: todayISO(),
      dueDate: '',
      status: 'quote',
      items: o.items.map((i) => ({ ...i, id: uid() })),
      discount: o.discount,
      taxPct: o.taxPct,
      payments: [],
      notes: o.notes,
    });
    toast(`Copied as ${n.number}`);
    nav.replace({ name: 'order', id: n.id });
  };

  return (
    <>
      <Header
        title={o.number}
        subtitle={c?.name || o.customerName || 'Unknown customer'}
        back
        actions={
          <>
            {p.money && (
              <IconBtn label="Share" onClick={share}>
                <Share2 size={20} />
              </IconBtn>
            )}
            {p.editOrders && (
              <IconBtn label="Edit" onClick={() => nav.push({ name: 'orderEdit', id })}>
                <Pencil size={19} />
              </IconBtn>
            )}
          </>
        }
      />
      <Page>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start lg:gap-8">
        <div>
        <div className="mb-4 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <StatusChip s={o.status} />
            <SourceChip o={o} />
          </span>
          <span className="text-[13px] text-muted-foreground">{fmtDate(o.date)}</span>
        </div>

        {o.status === 'cancelled' ? (
          <div className="card mb-5 flex items-center justify-between p-4">
            <span className="text-[14px] text-muted-foreground">This order is cancelled.</span>
            {p.editOrders && (
              <button className="text-[14px] font-semibold text-primary" onClick={() => setStatus('quote')}>
                Reopen
              </button>
            )}
          </div>
        ) : (
          <div className="card mb-5 p-4">
            <ol className="flex items-start">
              {STATUS_FLOW.map((s, i) => {
                const done = i <= idx;
                return (
                  <li key={s} className="flex flex-1 flex-col items-center">
                    <div className="flex w-full items-center">
                      <span className={`h-0.5 flex-1 ${i === 0 ? 'opacity-0' : i <= idx ? 'bg-primary' : 'bg-border'}`} />
                      <button
                        aria-label={`Set status ${STATUS[s].label}`}
                        disabled={!canMove(s)}
                        onClick={() => setStatus(s)}
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition ${done ? 'border-primary bg-primary text-white' : 'border-border bg-card text-muted-foreground'}`}
                      >
                        {done ? <Check size={16} strokeWidth={3} /> : <span className="text-[12px] font-bold">{i + 1}</span>}
                      </button>
                      <span className={`h-0.5 flex-1 ${i === STATUS_FLOW.length - 1 ? 'opacity-0' : i < idx ? 'bg-primary' : 'bg-border'}`} />
                    </div>
                    <span className={`mt-1.5 text-center text-[11px] leading-tight ${i === idx ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{STATUS[s].label}</span>
                  </li>
                );
              })}
            </ol>
            {next && canMove(next) && (
              <button className="btn-primary mt-4 w-full" onClick={() => setStatus(next)}>
                Mark as {STATUS[next].label.toLowerCase()}
              </button>
            )}
          </div>
        )}

        <div className="mb-5 card divide-y divide-border/60">
          <div className="p-4">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Customer</div>
            <button className="mt-0.5 text-left text-[16px] font-bold" disabled={!c || !p.customers} onClick={() => c && p.customers && nav.push({ name: 'customer', id: c.id })}>
              {c?.name || o.customerName || 'Unknown customer'}
            </button>
            {c?.company && <div className="text-[13px] text-muted-foreground">{c.company}</div>}
            {!p.money && c?.address && <div className="mt-1 whitespace-pre-wrap text-[13.5px]">{c.address}</div>}
          </div>
          {o.dueDate && (
            <div className="flex items-center justify-between p-4 text-[14px]">
              <span className="text-muted-foreground">Delivery by</span>
              <span className={`font-semibold ${late ? 'text-bad' : ''}`}>
                {fmtDate(o.dueDate)}
                {isOpen(o) && <span className="font-normal text-muted-foreground"> · {relDays(o.dueDate)}</span>}
              </span>
            </div>
          )}
        </div>

        {c?.phone && (
          <div className="mb-5 grid grid-cols-2 gap-3">
            <a className="btn-ghost" href={telHref(c.phone)}>
              <Phone size={18} /> Call
            </a>
            <a className="btn-ghost" href={p.money ? waHref(c.phone, text) : waHref(c.phone)} target="_blank" rel="noreferrer">
              <MessageCircle size={18} /> WhatsApp
            </a>
          </div>
        )}

        <Section title="Items">
          <div className="card divide-y divide-border/60">
            {o.items.length === 0 && <p className="p-4 text-center text-[14px] text-muted-foreground">No items.</p>}
            {o.items.map((it) => (
              <div key={it.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{it.description || 'Item'}</div>
                  <div className="tnum text-[13px] text-muted-foreground">
                    {p.money ? `${num(it.qty, 0)} × ${money(it.rate, cur)}` : `${num(it.qty, 0)} pcs${it.spec ? ` · ${specLabel(it.spec)}` : ''}`}
                  </div>
                </div>
                {p.money && <div className="tnum shrink-0 text-[15px] font-semibold">{money(it.qty * it.rate, cur)}</div>}
              </div>
            ))}
          </div>
        </Section>

        {o.artwork && o.artwork.elements?.length > 0 && <ArtworkCard o={o} />}

        </div>
        <div>
        {p.money && (
        <>
        <Section title="Amount">
          <dl className="card tnum space-y-2 p-4 text-[14px]">
            <Line k="Subtotal" v={money(t.subtotal, cur)} />
            {o.discount > 0 && <Line k="Discount" v={`−${money(o.discount, cur)}`} />}
            {o.taxPct > 0 && <Line k={`GST ${num(o.taxPct)}%`} v={money(t.tax, cur)} />}
            <div className="flex items-baseline justify-between border-t border-border/60 pt-2 text-[17px] font-bold">
              <span>Total</span>
              <span>{money(t.total, cur)}</span>
            </div>
            {t.paid > 0 && <Line k="Paid" v={money(t.paid, cur)} tone="good" />}
            {o.status !== 'cancelled' && o.status !== 'quote' && <Line k="Balance due" v={money(t.balance, cur)} tone={t.balance > 0.5 ? 'bad' : 'good'} strong />}
          </dl>
        </Section>

        <Section
          title="Payments"
          action={
            o.status !== 'cancelled' && (
              <button className="text-[14px] font-semibold text-primary" onClick={() => setPayOpen(true)}>
                + Add payment
              </button>
            )
          }
        >
          {o.payments.length === 0 ? (
            <div className="card p-5 text-center text-[14px] text-muted-foreground">No payments recorded.</div>
          ) : (
            <div className="card divide-y divide-border/60">
              {o.payments.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <Wallet size={18} className="shrink-0 text-good" />
                  <div className="min-w-0 flex-1">
                    <div className="tnum text-[15px] font-semibold">{money(p.amount, cur)}</div>
                    <div className="truncate text-[12.5px] text-muted-foreground">
                      {fmtDate(p.date)} · {p.mode}
                      {p.note ? ` · ${p.note}` : ''}
                    </div>
                  </div>
                  <button aria-label="Delete payment" className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground active:bg-muted" onClick={() => setDelPay(p.id)}>
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
        </>
        )}

        {o.notes && (
          <Section title="Notes">
            <div className="card whitespace-pre-wrap p-4 text-[14px]">{o.notes}</div>
          </Section>
        )}

        {p.editOrders && (
        <>
        {cloud.active && t.balance > 0.5 && o.status !== 'cancelled' && (
          <button className="btn-ghost mb-3 w-full" disabled={linkBusy} onClick={sendPayLink}>
            <Link2 size={18} /> {linkBusy ? 'Making link…' : `Send payment link (${money(t.balance, cur)})`}
          </button>
        )}
        <button className="btn-primary mb-3 w-full" disabled={invBusy} onClick={sendInvoice}>
          <FileText size={18} /> {invBusy ? 'Making PDF…' : o.invoiceNo ? `Share invoice ${o.invoiceNo} (PDF)` : 'Make & share invoice (PDF)'}
        </button>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-ghost" onClick={duplicate}>
            <Copy size={18} /> Repeat order
          </button>
          {o.status !== 'cancelled' ? (
            <button className="btn-ghost" onClick={() => setStatus('cancelled')}>
              <X size={18} /> Cancel order
            </button>
          ) : (
            <span />
          )}
        </div>
        <button className="btn-danger mt-3 w-full" onClick={() => setDelOrder(true)}>
          <Trash2 size={18} /> Delete order
        </button>
        </>
        )}
      </div>
        </div>
      </Page>

      <PaymentSheet open={payOpen} onClose={() => setPayOpen(false)} order={o} />
      <Confirm
        open={delOrder}
        onClose={() => setDelOrder(false)}
        title="Delete order?"
        text={`${o.number} and its payments will be removed. This cannot be undone.`}
        onConfirm={() => {
          deleteOrder(o.id);
          toast('Order deleted');
          nav.back();
        }}
      />
      <Confirm
        open={delPay !== null}
        onClose={() => setDelPay(null)}
        title="Delete payment?"
        text="This payment will be removed from the order."
        onConfirm={() => {
          upsertOrder({ ...o, payments: o.payments.filter((p) => p.id !== delPay) });
          toast('Payment deleted');
        }}
      />
    </>
  );
}

function PaymentSheet({ open, onClose, order }: { open: boolean; onClose: () => void; order: Order }) {
  const { upsertOrder, toast } = useStore();
  const balance = Math.max(0, Math.round(orderTotals(order).balance * 100) / 100);
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [mode, setMode] = useState(PAY_MODES[0]);
  const [note, setNote] = useState('');

  // Start each time the sheet opens with the full balance filled in.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setAmount(balance);
      setDate(todayISO());
      setMode(PAY_MODES[0]);
      setNote('');
    }
  }

  const save = () => {
    upsertOrder({ ...order, payments: [...order.payments, { id: uid(), date, amount, mode, note: note.trim() }] });
    toast('Payment added');
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add payment">
      <div className="space-y-4">
        <Field label="Amount">
          <NumInput value={amount} onValue={setAmount} suffix="₹" autoFocus />
        </Field>
        {balance > 0 && amount !== balance && (
          <button className="text-[13px] font-semibold text-primary" onClick={() => setAmount(balance)}>
            Use full balance ({money(balance)})
          </button>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Mode">
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              {PAY_MODES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Note">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reference no., cheque no…" />
        </Field>
        <button className="btn-primary w-full" disabled={amount <= 0 || !date} onClick={save}>
          Save payment
        </button>
      </div>
    </Sheet>
  );
}

export function OrderEdit({ id, customerId: initialCustomer, prefill }: { id?: string; customerId?: string; prefill?: OrderItem }) {
  const { data, upsertOrder, upsertCustomer, toast } = useStore();
  const nav = useNav();
  const existing = id ? data.orders.find((o) => o.id === id) : undefined;
  const cur = data.settings.currency;

  const [customerId, setCustomerId] = useState(existing?.customerId || initialCustomer || '');
  const [date, setDate] = useState(existing?.date || todayISO());
  const [dueDate, setDueDate] = useState(existing?.dueDate || '');
  const [status, setStatus] = useState<OrderStatus>(existing?.status || 'quote');
  const [items, setItems] = useState<OrderItem[]>(existing?.items || (prefill ? [{ ...prefill, id: uid() }] : []));
  const [discount, setDiscount] = useState(existing?.discount || 0);
  const [taxPct, setTaxPct] = useState(existing ? existing.taxPct : data.settings.defaults.taxPct);
  const [notes, setNotes] = useState(existing?.notes || '');
  const [invoiceNo, setInvoiceNo] = useState(existing?.invoiceNo || '');
  const [inv, setInv] = useState<InvoiceMeta>(existing?.invoice || {});
  const setInvField = (k: keyof InvoiceMeta) => (e: { target: { value: string } }) => setInv((x) => ({ ...x, [k]: e.target.value }));
  const [boxSheet, setBoxSheet] = useState(false);
  const [custSheet, setCustSheet] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const customers = useMemo(() => [...data.customers].sort((a, b) => a.name.localeCompare(b.name)), [data.customers]);
  const boxes = useMemo(() => [...data.boxes].sort((a, b) => Number(b.customerId === customerId) - Number(a.customerId === customerId) || a.name.localeCompare(b.name)), [data.boxes, customerId]);

  const t = orderTotals({ items, discount, taxPct, payments: existing?.payments || [], status } as Order);
  const canSave = !!customerId && items.some((i) => i.qty > 0);

  const patchItem = (iid: string, patch: Partial<OrderItem>) => setItems((xs) => xs.map((x) => (x.id === iid ? { ...x, ...patch } : x)));

  const addBox = (boxId: string) => {
    const b = data.boxes.find((x) => x.id === boxId);
    if (!b) return;
    const unit = estimate(calcBox(b.spec).paperCost, b.pricing, 1).unitPrice;
    const label = specLabel(b.spec);
    setItems((xs) => [...xs, { id: uid(), description: b.name === label ? label : `${b.name} · ${label}`, qty: 1000, rate: Math.round(unit * 100) / 100, spec: b.spec, boxId: b.id }]);
    setBoxSheet(false);
  };

  const quickAdd = () => {
    const c = upsertCustomer({ name: newName.trim(), phone: newPhone.trim() });
    setCustomerId(c.id);
    setNewName('');
    setNewPhone('');
    setCustSheet(false);
    toast('Customer added');
  };

  const save = () => {
    const rec = upsertOrder({
      id: existing?.id,
      customerId,
      date,
      dueDate,
      status,
      items: items.filter((i) => i.qty > 0 || i.description.trim()),
      discount,
      taxPct,
      payments: existing?.payments || [],
      notes: notes.trim(),
      invoiceNo: invoiceNo.trim() || undefined,
      invoice: Object.fromEntries(Object.entries(inv).filter(([, v]) => (v || '').trim())) as InvoiceMeta,
    });
    toast(existing ? 'Order updated' : `${rec.number} created`);
    if (existing) nav.back();
    else nav.replace({ name: 'order', id: rec.id });
  };

  return (
    <>
      <Header title={existing ? `Edit ${existing.number}` : 'New order'} back />
      <Page>
        <Section title="Customer">
          <div className="card space-y-3 p-4">
            <select className="input" aria-label="Customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company ? ` · ${c.company}` : ''}
                </option>
              ))}
            </select>
            <button className="flex items-center gap-1.5 text-[14px] font-semibold text-primary" onClick={() => setCustSheet(true)}>
              <UserPlus size={16} /> New customer
            </button>
          </div>
        </Section>

        <Section title="Details">
          <div className="card space-y-4 p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Order date">
                <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Delivery by">
                <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            </div>
            <Field label="Status">
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>
                {(Object.keys(STATUS) as OrderStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS[s].label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Items">
          <div className="space-y-3">
            {items.map((it, n) => (
              <div key={it.id} className="card space-y-3 p-4">
                <div className="flex items-start gap-2">
                  <input className="input" aria-label={`Item ${n + 1} description`} value={it.description} onChange={(e) => patchItem(it.id, { description: e.target.value })} placeholder="Description" />
                  <button aria-label="Remove item" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-bad active:bg-bad/10" onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}>
                    <Trash2 size={18} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Qty">
                    <NumInput value={it.qty} onValue={(v) => patchItem(it.id, { qty: v })} suffix="pcs" />
                  </Field>
                  <Field label="Rate">
                    <NumInput value={it.rate} onValue={(v) => patchItem(it.id, { rate: v })} suffix={cur} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="HSN / SAC">
                    <input className="input" inputMode="numeric" value={it.hsn || ''} onChange={(e) => patchItem(it.id, { hsn: e.target.value })} placeholder={data.settings.defaultHsn || 'Default'} />
                  </Field>
                  <Field label="Unit">
                    <input className="input" value={it.unit || ''} onChange={(e) => patchItem(it.id, { unit: e.target.value })} placeholder={data.settings.defaultUnit || 'Nos.'} />
                  </Field>
                </div>
                <div className="tnum flex justify-between text-[14px]">
                  <span className="text-muted-foreground">Line total</span>
                  <span className="font-semibold">{money(it.qty * it.rate, cur)}</span>
                </div>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <button className="btn-ghost" onClick={() => setBoxSheet(true)} disabled={data.boxes.length === 0}>
                <Box size={18} /> Saved box
              </button>
              <button className="btn-ghost" onClick={() => setItems((xs) => [...xs, { id: uid(), description: '', qty: 0, rate: 0 }])}>
                <Plus size={18} /> Custom line
              </button>
            </div>
          </div>
        </Section>

        <Section title="Amount">
          <div className="card space-y-4 p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Discount">
                <NumInput value={discount} onValue={setDiscount} suffix={cur} />
              </Field>
              <Field label="GST">
                <NumInput value={taxPct} onValue={setTaxPct} suffix="%" />
              </Field>
            </div>
            <dl className="tnum space-y-1.5 border-t border-border/60 pt-3 text-[14px]">
              <Line k="Subtotal" v={money(t.subtotal, cur)} />
              {discount > 0 && <Line k="Discount" v={`−${money(discount, cur)}`} />}
              <Line k={`GST ${num(taxPct)}%`} v={money(t.tax, cur)} />
            </dl>
            <div className="flex items-baseline justify-between rounded-xl bg-foreground px-4 py-3 text-background">
              <span className="text-[13px] font-semibold opacity-80">Total</span>
              <span className="tnum text-[20px] font-bold">{money(t.total, cur)}</span>
            </div>
          </div>
        </Section>

        <Section title="Tax invoice details">
          <details className="card group p-4">
            <summary className="cursor-pointer list-none text-[14px] font-semibold text-primary">Optional — printed on the PDF invoice</summary>
            <div className="mt-4 space-y-4">
              <Field label="Invoice no." hint="Leave empty to number automatically when the PDF is first made.">
                <input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Auto" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Dispatched through">
                  <input className="input" value={inv.dispatchedThrough || ''} onChange={setInvField('dispatchedThrough')} placeholder="Car, Lorry…" />
                </Field>
                <Field label="Destination">
                  <input className="input" value={inv.destination || ''} onChange={setInvField('destination')} />
                </Field>
                <Field label="Mode / terms of payment">
                  <input className="input" value={inv.termsOfPayment || ''} onChange={setInvField('termsOfPayment')} />
                </Field>
                <Field label="Delivery note">
                  <input className="input" value={inv.deliveryNote || ''} onChange={setInvField('deliveryNote')} />
                </Field>
                <Field label="Dispatch doc no.">
                  <input className="input" value={inv.dispatchDocNo || ''} onChange={setInvField('dispatchDocNo')} />
                </Field>
                <Field label="Delivery note date">
                  <input className="input" type="date" value={inv.deliveryNoteDate || ''} onChange={setInvField('deliveryNoteDate')} />
                </Field>
              </div>
              <Field label="Terms of delivery">
                <textarea className="input min-h-[64px]" value={inv.termsOfDelivery || ''} onChange={setInvField('termsOfDelivery')} />
              </Field>
            </div>
          </details>
        </Section>

        <Section title="Notes">
          <textarea className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery address, payment terms…" />
        </Section>

        <button className="btn-primary w-full" disabled={!canSave} onClick={save}>
          {existing ? 'Save changes' : 'Create order'}
        </button>
        {!canSave && <p className="mt-2 text-center text-[13px] text-muted-foreground">Choose a customer and add at least one item with a quantity.</p>}
      </Page>

      <Sheet open={boxSheet} onClose={() => setBoxSheet(false)} title="Add saved box">
        <List>
          {boxes.map((b) => (
            <Row
              key={b.id}
              onClick={() => addBox(b.id)}
              icon={<Box size={20} className="text-primary" />}
              title={b.name}
              sub={[specLabel(b.spec), data.customers.find((c) => c.id === b.customerId)?.name].filter(Boolean).join(' · ')}
              chevron={false}
            />
          ))}
        </List>
      </Sheet>

      <Sheet open={custSheet} onClose={() => setCustSheet(false)} title="New customer">
        <div className="space-y-4">
          <Field label="Name *">
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </Field>
          <Field label="Phone">
            <input className="input" type="tel" inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          </Field>
          <button className="btn-primary w-full" disabled={!newName.trim()} onClick={quickAdd}>
            Add customer
          </button>
        </div>
      </Sheet>
    </>
  );
}

function Line({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={`${strong ? 'text-[16px] font-bold' : 'font-semibold'} ${tone === 'good' ? 'text-good' : tone === 'bad' ? 'text-bad' : ''}`}>{v}</dd>
    </div>
  );
}
