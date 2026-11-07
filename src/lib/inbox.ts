import type { AppData, Enquiry, Order } from './types';

/**
 * Inbox: what came in from the website and still needs someone.
 * - website orders not yet opened on this phone (any status except cancelled)
 * - enquiries that are not closed (new first)
 */
export interface Inbox {
  orders: Order[];
  enquiries: Enquiry[];
  /** Number shown on badges: unseen website orders + new enquiries. */
  count: number;
}

export function inbox(d: AppData): Inbox {
  const seen = new Set(d.settings.inboxSeen || []);
  const orders = d.orders.filter((o) => o.source === 'web' && o.status !== 'cancelled' && !seen.has(o.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rank = { new: 0, contacted: 1, closed: 2 } as const;
  const enquiries = (d.enquiries || []).filter((e) => e.status !== 'closed').sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt.localeCompare(a.createdAt));
  return { orders, enquiries, count: orders.length + enquiries.filter((e) => e.status === 'new').length };
}

/** Items that arrived between two versions of the data (for a "new website order" message after a sync). */
export function arrivals(prev: AppData, next: AppData): { orders: Order[]; enquiries: Enquiry[] } {
  const oldOrders = new Set(prev.orders.map((o) => o.id));
  const oldEnq = new Set((prev.enquiries || []).map((e) => e.id));
  const box = inbox(next);
  return {
    orders: box.orders.filter((o) => !oldOrders.has(o.id)),
    enquiries: box.enquiries.filter((e) => e.status === 'new' && !oldEnq.has(e.id)),
  };
}

/** Message for arrivals, or '' when nothing new. */
export function arrivalText(a: { orders: Order[]; enquiries: Enquiry[] }): string {
  const parts: string[] = [];
  if (a.orders.length === 1) parts.push(`New website order ${a.orders[0].number}`);
  else if (a.orders.length > 1) parts.push(`${a.orders.length} new website orders`);
  if (a.enquiries.length === 1) parts.push(`new enquiry from ${a.enquiries[0].name || a.enquiries[0].phone || 'the website'}`);
  else if (a.enquiries.length > 1) parts.push(`${a.enquiries.length} new enquiries`);
  const s = parts.join(', ');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

/** Keep the seen-list short: only ids of website orders that still exist. */
export function markSeen(d: AppData, ids: string[]): string[] {
  const live = new Set(d.orders.filter((o) => o.source === 'web').map((o) => o.id));
  return [...new Set([...(d.settings.inboxSeen || []), ...ids])].filter((id) => live.has(id)).slice(-1000);
}
