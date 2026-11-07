import { useMemo } from 'react';
import { CheckCheck, Globe, Inbox as InboxIcon, MessageCircle, Phone, ShoppingBag, UserPlus, X } from 'lucide-react';
import { orderTotals } from '@honeypackers/box-core/calc';
import { useStore, usePerms } from '../store';
import { useNav } from '../nav';
import { money0, telHref, timeAgo, waHref } from '../lib/format';
import { inbox } from '../lib/inbox';
import type { Enquiry } from '../lib/types';
import { Empty, Header, List, Page, Row, Section, StatusChip } from '../ui';

const last10 = (p: string) => p.replace(/\D/g, '').slice(-10);

/** Website orders not opened yet on this phone, and enquiries from the website contact form. */
export function Inbox() {
  const { data, cloudStatus, markInboxSeen, setEnquiryStatus, upsertCustomer, toast } = useStore();
  const p = usePerms();
  const nav = useNav();
  const box = useMemo(() => inbox(data), [data]);
  const customers = useMemo(() => new Map(data.customers.map((c) => [c.id, c])), [data.customers]);
  const cur = data.settings.currency;

  const makeOrder = (e: Enquiry) => {
    // Use the customer with the same mobile number if there is one, otherwise add them.
    const existing = e.phone ? data.customers.find((c) => c.phone && last10(c.phone) === last10(e.phone)) : undefined;
    const c = existing || upsertCustomer({ name: e.name || e.phone || 'Website customer', phone: e.phone, email: e.email, notes: `From website enquiry:\n${e.message}` });
    if (e.status === 'new') setEnquiryStatus(e.id, 'contacted');
    if (!existing) toast(`Customer ${c.name} added`);
    nav.push({ name: 'orderEdit', customerId: c.id });
  };

  return (
    <>
      <Header title="Inbox" subtitle="From honeypackers.in" back />
      <Page>
        {cloudStatus.phase !== 'ready' && (
          <p className="card mb-5 p-4 text-[14px] text-muted-foreground">Website orders and enquiries arrive here once cloud sync is on (More → Cloud sync).</p>
        )}
        {box.orders.length === 0 && box.enquiries.length === 0 && cloudStatus.phase === 'ready' && (
          <Empty icon={<InboxIcon size={28} />} title="All caught up" text="New website orders and enquiries will appear here as soon as they come in." />
        )}

        {box.orders.length > 0 && (
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

        {box.enquiries.length > 0 && (
          <Section title={`Enquiries (${box.enquiries.length})`}>
            <div className="space-y-3">
              {box.enquiries.map((e) => (
                <div key={e.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold">
                        {e.name || e.phone || 'Website visitor'}
                        {e.status === 'new' && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 align-middle text-[11px] font-bold text-primary-foreground">New</span>}
                      </p>
                      <p className="text-[12.5px] text-muted-foreground">
                        {[e.phone, e.email].filter(Boolean).join(' · ')} · {timeAgo(e.createdAt)}
                      </p>
                    </div>
                    <Globe size={18} className="shrink-0 text-muted-foreground" />
                  </div>
                  {e.message && <p className="mt-2 whitespace-pre-wrap text-[14px]">{e.message}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {e.phone && (
                      <>
                        <a className="btn-ghost h-10 px-3 text-[13.5px]" href={telHref(e.phone)} onClick={() => e.status === 'new' && setEnquiryStatus(e.id, 'contacted')}>
                          <Phone size={16} /> Call
                        </a>
                        <a
                          className="btn-ghost h-10 px-3 text-[13.5px]"
                          href={waHref(e.phone, `Hi ${e.name || ''}, thank you for your enquiry to ${data.settings.businessName || 'us'}.`)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => e.status === 'new' && setEnquiryStatus(e.id, 'contacted')}
                        >
                          <MessageCircle size={16} /> WhatsApp
                        </a>
                      </>
                    )}
                    {p.editOrders && (
                      <button className="btn-ghost h-10 px-3 text-[13.5px]" onClick={() => makeOrder(e)}>
                        <UserPlus size={16} /> Make order
                      </button>
                    )}
                    {e.status === 'new' && (
                      <button className="btn-ghost h-10 px-3 text-[13.5px]" onClick={() => setEnquiryStatus(e.id, 'contacted')}>
                        <CheckCheck size={16} /> Contacted
                      </button>
                    )}
                    <button className="btn-ghost h-10 px-3 text-[13.5px]" onClick={() => (setEnquiryStatus(e.id, 'closed'), toast('Enquiry closed'))}>
                      <X size={16} /> Close
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </Page>
    </>
  );
}
