import { useMemo, useState } from 'react';
import { Box, MessageCircle, Pencil, Phone, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { useStore } from '../store';
import { useNav } from '../nav';
import { orderTotals, specLabel } from '@honeypackers/box-core/calc';
import { fmtDate, initials, money, money0, telHref, waHref } from '../lib/format';
import { GST_STATES, stateFromGstin } from '@honeypackers/box-core/gst';
import type { Customer } from '../lib/types';
import { Avatar, Confirm, Empty, Fab, Field, Header, IconBtn, List, Page, Row, SearchBox, Section, StatusChip } from '../ui';

export function useCustomerStats() {
  const { data } = useStore();
  return useMemo(() => {
    const m = new Map<string, { orders: number; total: number; balance: number; last: string }>();
    for (const o of data.orders) {
      const t = orderTotals(o);
      const s = m.get(o.customerId) || { orders: 0, total: 0, balance: 0, last: '' };
      s.orders++;
      if (o.status !== 'cancelled') s.total += t.total;
      if (o.status !== 'quote') s.balance += t.balance;
      if (o.date > s.last) s.last = o.date;
      m.set(o.customerId, s);
    }
    return m;
  }, [data.orders]);
}

export function CustomersList() {
  const { data } = useStore();
  const nav = useNav();
  const [q, setQ] = useState('');
  const stats = useCustomerStats();
  const cur = data.settings.currency;

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.customers
      .filter((c) => !s || [c.name, c.company, c.phone, c.gstin].some((f) => f?.toLowerCase().includes(s)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data.customers, q]);

  return (
    <>
      <Header title="Customers" subtitle={`${data.customers.length} total`} large />
      <Page>
        {data.customers.length > 0 && (
          <div className="mb-4">
            <SearchBox value={q} onChange={setQ} placeholder="Search name, company, phone…" />
          </div>
        )}
        {data.customers.length === 0 ? (
          <Empty
            icon={<Users size={28} />}
            title="No customers yet"
            text="Add the companies you make boxes for. Their orders, dues and saved box designs stay together."
            action={
              <button className="btn-primary" onClick={() => nav.push({ name: 'customerEdit' })}>
                <UserPlus size={18} /> Add customer
              </button>
            }
          />
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">No customers match “{q}”.</p>
        ) : (
          <List>
            {list.map((c, i) => {
              const s = stats.get(c.id);
              return (
                <Row
                  key={c.id}
                  onClick={() => nav.push({ name: 'customer', id: c.id })}
                  icon={<Avatar text={initials(c.name)} tone={i} />}
                  title={c.name}
                  sub={[c.company, c.phone].filter(Boolean).join(' · ') || 'No contact details'}
                  right={
                    s && s.balance > 0.5 ? (
                      <span className="tnum text-right text-[13px] font-semibold text-bad">
                        {money0(s.balance, cur)}
                        <span className="block text-[11px] font-normal text-muted-foreground">due</span>
                      </span>
                    ) : s ? (
                      <span className="text-[12px] text-muted-foreground">{s.orders} orders</span>
                    ) : undefined
                  }
                />
              );
            })}
          </List>
        )}
      </Page>
      {data.customers.length > 0 && <Fab label="Customer" icon={<Plus size={20} />} onClick={() => nav.push({ name: 'customerEdit' })} />}
    </>
  );
}

export function CustomerDetail({ id }: { id: string }) {
  const { data, deleteCustomer, toast } = useStore();
  const nav = useNav();
  const [confirm, setConfirm] = useState(false);
  const c = data.customers.find((x) => x.id === id);
  const stats = useCustomerStats().get(id);
  const cur = data.settings.currency;
  if (!c) return <Missing />;
  const orders = data.orders.filter((o) => o.customerId === id).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const boxes = data.boxes.filter((b) => b.customerId === id);

  return (
    <>
      <Header
        title={c.name}
        subtitle={c.company}
        back
        actions={
          <IconBtn label="Edit" onClick={() => nav.push({ name: 'customerEdit', id })}>
            <Pencil size={19} />
          </IconBtn>
        }
      />
      <Page>
        <div className="mb-5 flex items-center gap-4">
          <span className="grid h-16 w-16 place-items-center rounded-3xl bg-primary text-[22px] font-bold text-white">{initials(c.name)}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[20px] font-bold">{c.name}</div>
            {c.company && <div className="truncate text-muted-foreground">{c.company}</div>}
            {c.gstin && <div className="text-[12px] text-muted-foreground">GSTIN {c.gstin}</div>}
          </div>
        </div>

        {c.phone && (
          <div className="mb-5 grid grid-cols-2 gap-3">
            <a className="btn-ghost" href={telHref(c.phone)}>
              <Phone size={18} /> Call
            </a>
            <a className="btn-ghost" href={waHref(c.phone)} target="_blank" rel="noreferrer">
              <MessageCircle size={18} /> WhatsApp
            </a>
          </div>
        )}

        <div className="mb-6 grid grid-cols-3 gap-3">
          <MiniStat label="Orders" value={String(stats?.orders || 0)} />
          <MiniStat label="Business" value={money0(stats?.total || 0, cur)} />
          <MiniStat label="Due" value={money0(stats?.balance || 0, cur)} tone={(stats?.balance || 0) > 0.5 ? 'bad' : undefined} />
        </div>

        <Section
          title="Orders"
          action={
            <button className="text-[14px] font-semibold text-primary" onClick={() => nav.push({ name: 'orderEdit', customerId: id })}>
              + New order
            </button>
          }
        >
          {orders.length === 0 ? (
            <div className="card p-5 text-center text-[14px] text-muted-foreground">No orders yet.</div>
          ) : (
            <List>
              {orders.map((o) => {
                const t = orderTotals(o);
                return (
                  <Row
                    key={o.id}
                    onClick={() => nav.push({ name: 'order', id: o.id })}
                    title={
                      <span className="flex items-center gap-2">
                        {o.number} <StatusChip s={o.status} />
                      </span>
                    }
                    sub={`${fmtDate(o.date)} · ${o.items.length} item${o.items.length === 1 ? '' : 's'}`}
                    right={<span className="tnum text-[14px] font-semibold">{money(t.total, cur)}</span>}
                  />
                );
              })}
            </List>
          )}
        </Section>

        <Section
          title="Saved boxes"
          action={
            <button className="text-[14px] font-semibold text-primary" onClick={() => nav.push({ name: 'box', customerId: id })}>
              + New box
            </button>
          }
        >
          {boxes.length === 0 ? (
            <div className="card p-5 text-center text-[14px] text-muted-foreground">Save box designs from the calculator to reuse them in orders.</div>
          ) : (
            <List>
              {boxes.map((b) => (
                <Row key={b.id} onClick={() => nav.push({ name: 'box', id: b.id })} icon={<Box size={20} className="text-primary" />} title={b.name} sub={specLabel(b.spec)} />
              ))}
            </List>
          )}
        </Section>

        {(c.email || c.address || c.notes) && (
          <Section title="Details">
            <div className="card space-y-3 p-4 text-[14px]">
              {c.email && <Detail k="Email" v={c.email} />}
              {c.address && <Detail k="Address" v={c.address} />}
              {c.notes && <Detail k="Notes" v={c.notes} />}
            </div>
          </Section>
        )}

        <button className="btn-danger w-full" onClick={() => setConfirm(true)}>
          <Trash2 size={18} /> Delete customer
        </button>
      </Page>
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Delete customer?"
        text={`${c.name} and their ${orders.length} order(s) will be removed. Saved boxes are kept. This cannot be undone.`}
        onConfirm={() => {
          deleteCustomer(id);
          toast('Customer deleted');
          nav.back();
        }}
      />
    </>
  );
}

export function CustomerEdit({ id }: { id?: string }) {
  const { data, upsertCustomer, toast } = useStore();
  const nav = useNav();
  const existing = id ? data.customers.find((c) => c.id === id) : undefined;
  const [f, setF] = useState<Partial<Customer>>(existing || {});
  const set = (k: keyof Customer) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const ok = (f.name || '').trim().length > 0;

  const save = () => {
    const c = upsertCustomer({ ...f, name: f.name!.trim() } as Customer);
    toast(existing ? 'Customer updated' : 'Customer added');
    if (existing) nav.back();
    else nav.replace({ name: 'customer', id: c.id });
  };

  return (
    <>
      <Header title={existing ? 'Edit customer' : 'New customer'} back />
      <Page>
        <div className="card space-y-4 p-4">
          <Field label="Name *">
            <input className="input" value={f.name || ''} onChange={set('name')} placeholder="Contact person or shop name" autoFocus={!existing} />
          </Field>
          <Field label="Company">
            <input className="input" value={f.company || ''} onChange={set('company')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <input className="input" type="tel" inputMode="tel" value={f.phone || ''} onChange={set('phone')} />
            </Field>
            <Field label="GSTIN">
              <input className="input uppercase" value={f.gstin || ''} onChange={set('gstin')} maxLength={15} />
            </Field>
          </div>
          <Field label="State (for GST)" hint={stateFromGstin(f.gstin || '') ? 'Taken from the GSTIN.' : 'Decides CGST + SGST or IGST on invoices. Empty = same state as you.'}>
            <select className="input" value={stateFromGstin(f.gstin || '') || f.stateCode || ''} disabled={!!stateFromGstin(f.gstin || '')} onChange={(e) => setF({ ...f, stateCode: e.target.value })}>
              <option value="">— Same as my state —</option>
              {Object.entries(GST_STATES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name} ({code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Email">
            <input className="input" type="email" inputMode="email" value={f.email || ''} onChange={set('email')} />
          </Field>
          <Field label="Address">
            <textarea className="input min-h-[80px]" value={f.address || ''} onChange={set('address')} />
          </Field>
          <Field label="Notes">
            <textarea className="input min-h-[70px]" value={f.notes || ''} onChange={set('notes')} placeholder="Preferred paper, payment terms…" />
          </Field>
        </div>
        <button className="btn-primary mt-5 w-full" disabled={!ok} onClick={save}>
          {existing ? 'Save changes' : 'Add customer'}
        </button>
      </Page>
    </>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'bad' }) {
  return (
    <div className="card px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tnum mt-0.5 truncate text-[17px] font-bold ${tone === 'bad' ? 'text-bad' : ''}`}>{value}</div>
    </div>
  );
}
function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className="whitespace-pre-wrap">{v}</div>
    </div>
  );
}
export function Missing() {
  return (
    <>
      <Header title="Not found" back />
      <Page>
        <p className="py-10 text-center text-muted-foreground">This item no longer exists.</p>
      </Page>
    </>
  );
}
