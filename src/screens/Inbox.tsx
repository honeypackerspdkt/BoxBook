import { useMemo, useState } from 'react';
import { CheckCheck, Globe, Inbox as InboxIcon, MessageCircle, Phone, ShoppingBag, UserPlus, X } from 'lucide-react';
import { orderTotals } from '@honeypackers/box-core/calc';
import { useStore, usePerms } from '../store';
import { useNav } from '../nav';
import { money0, telHref, timeAgo, waHref } from '../lib/format';
import { inbox } from '../lib/inbox';
import { Empty, Header, List, Page, Row, Section, StatusChip } from '../ui';
import { Chips, ListPage, StatCards, Toolbar } from '../list-page';

const last10 = (p: string) => p.replace(/\D/g, '').slice(-10);

/** Website orders not opened yet on this phone, and enquiries from the website contact form. */
export function Inbox() {
  const { data, cloudStatus, markInboxSeen } = useStore();
  const p = usePerms();
  const nav = useNav();
  const box = useMemo(() => inbox(data), [data]);
  const customers = useMemo(() => new Map(data.customers.map((c) => [c.id, c])), [data.customers]);
  const cur = data.settings.currency;

  const [show, setShow] = useState<'all' | 'orders' | 'enquiries'>('all');
  const newEnq = box.enquiries.filter((e) => e.status === 'new');
  const nothing = box.orders.length === 0 && box.enquiries.length === 0;

  return (
    <ListPage title="Inbox" subtitle="From your website" back>
      {cloudStatus.phase !== 'ready' && <p className="card mb-5 p-4 text-[14px] text-muted-foreground">Website orders and enquiries arrive here once cloud sync is on (More → Cloud sync).</p>}
      {nothing && cloudStatus.phase === 'ready' ? (
        <div className="card">
          <Empty icon={<InboxIcon size={28} />} title="All caught up" text="New website orders and enquiries will appear here as soon as they come in." />
        </div>
      ) : (
        <>
          <StatCards
            items={[
              { label: 'New orders', value: String(box.orders.length), tone: box.orders.length ? 'primary' : undefined },
              { label: 'New enquiries', value: String(newEnq.length), tone: newEnq.length ? 'primary' : undefined },
              { label: 'Contacted', value: String(box.enquiries.length - newEnq.length) },
            ]}
          />
          <Toolbar>
            <Chips
              value={show}
              onChange={setShow}
              options={[
                { value: 'all', label: 'All', count: box.orders.length + box.enquiries.length },
                { value: 'orders', label: 'Website orders', count: box.orders.length },
                { value: 'enquiries', label: 'Enquiries', count: box.enquiries.length },
              ]}
            />
          </Toolbar>

          {show !== 'enquiries' && box.orders.length > 0 && (
            <Section
              title={`Website orders (${box.orders.length})`}
              action={
                <button className="flex items-center gap-1 text-[13px] font-semibold text-primary" onClick={() => markInboxSeen(box.orders.map((o) => o.id))}>
                  <CheckCheck size={15} /> Mark all seen
                </button>
              }
            >
              <List>
                {box.orders.map((o) => {
                  const t = orderTotals(o);
                  return (
                    <Row
                      key={o.id}
                      onClick={() => nav.push({ name: 'order', id: o.id })}
                      icon={<ShoppingBag size={20} className="text-primary" />}
                      title={
                        <span className="flex items-center gap-2">
                          <span className="truncate">{customers.get(o.customerId)?.name || o.customerName || 'Website buyer'}</span>
                          <StatusChip s={o.status} />
                        </span>
                      }
                      sub={`${o.number} · ${timeAgo(o.createdAt)}${t.paid > 0 ? ` · paid ${money0(t.paid, cur)}` : ''}`}
                      right={p.money && <span className="tnum text-[14px] font-semibold">{money0(t.total, cur)}</span>}
                    />
                  );
                })}
              </List>
            </Section>
          )}

          {show !== 'orders' && box.enquiries.length > 0 && (
            <Section title={`Enquiries (${box.enquiries.length})`}>
              <List>
                {box.enquiries.map((e) => (
                  <Row
                    key={e.id}
                    onClick={() => nav.push({ name: 'enquiry', id: e.id })}
                    icon={<Globe size={20} className={e.status === 'new' ? 'text-primary' : 'text-muted-foreground'} />}
                    title={
                      <span className="flex items-center gap-2">
                        <span className="truncate">{e.name || e.phone || 'Website visitor'}</span>
                        {e.status === 'new' && <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">New</span>}
                      </span>
                    }
                    sub={`${timeAgo(e.createdAt)}${e.message ? ` · ${e.message.replace(/\s+/g, ' ').slice(0, 80)}` : ''}`}
                  />
                ))}
              </List>
            </Section>
          )}
        </>
      )}
    </ListPage>
  );
}

/** One website enquiry as a full page: message, contact buttons, make an order, mark contacted / close. */
export function EnquiryDetail({ id }: { id: string }) {
  const { data, setEnquiryStatus, upsertCustomer, toast } = useStore();
  const p = usePerms();
  const nav = useNav();
  const e = (data.enquiries || []).find((x) => x.id === id);
  if (!e) {
    return (
      <>
        <Header title="Enquiry" back />
        <Page>
          <p className="py-10 text-center text-muted-foreground">This enquiry is no longer here.</p>
        </Page>
      </>
    );
  }
  const makeOrder = () => {
    const existing = e.phone ? data.customers.find((c) => c.phone && last10(c.phone) === last10(e.phone)) : undefined;
    const c = existing || upsertCustomer({ name: e.name || e.phone || 'Website customer', phone: e.phone, email: e.email, notes: `From website enquiry:\n${e.message}` });
    if (e.status === 'new') setEnquiryStatus(e.id, 'contacted');
    if (!existing) toast(`Customer ${c.name} added`);
    nav.replace({ name: 'orderEdit', customerId: c.id });
  };
  const contacted = () => e.status === 'new' && setEnquiryStatus(e.id, 'contacted');
  return (
    <>
      <Header title={e.name || e.phone || 'Website visitor'} subtitle={`Enquiry · ${timeAgo(e.createdAt)}`} back />
      <Page>
        <div className="card p-4">
          <p className="text-[13px] text-muted-foreground">{[e.phone, e.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
          {e.message && <p className="mt-2 whitespace-pre-wrap text-[15px]">{e.message}</p>}
          <p className="mt-3 text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground">{e.status === 'new' ? 'New' : e.status === 'contacted' ? 'Contacted' : 'Closed'}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {e.phone && (
            <>
              <a className="btn-ghost" href={telHref(e.phone)} onClick={contacted}>
                <Phone size={18} /> Call
              </a>
              <a className="btn-ghost" href={waHref(e.phone, `Hi ${e.name || ''}, thank you for your enquiry to ${data.settings.businessName || 'us'}.`)} target="_blank" rel="noreferrer" onClick={contacted}>
                <MessageCircle size={18} /> WhatsApp
              </a>
            </>
          )}
          {p.editOrders && (
            <button className="btn-primary col-span-2" onClick={makeOrder}>
              <UserPlus size={18} /> Make order
            </button>
          )}
          {e.status === 'new' && (
            <button className="btn-ghost" onClick={() => (setEnquiryStatus(e.id, 'contacted'), toast('Marked as contacted'))}>
              <CheckCheck size={18} /> Contacted
            </button>
          )}
          <button className="btn-ghost" onClick={() => (setEnquiryStatus(e.id, 'closed'), toast('Enquiry closed'), nav.back())}>
            <X size={18} /> Close enquiry
          </button>
        </div>
      </Page>
    </>
  );
}
