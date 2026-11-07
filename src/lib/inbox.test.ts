import { describe, expect, it } from 'vitest';
import { emptyData } from './storage';
import type { AppData, Enquiry, Order } from './types';
import { arrivalText, arrivals, inbox, markSeen } from './inbox';
import { applyRow, rowsOf } from './cloud/mapping';

const order = (id: string, extra: Partial<Order> = {}): Order => ({ id, number: `ORD-${id}`, customerId: '', date: '2026-11-08', dueDate: '', status: 'confirmed', items: [], discount: 0, taxPct: 5, payments: [], notes: '', createdAt: `2026-11-08T0${id.length}:00:00Z`, updatedAt: '', ...extra });
const enq = (id: string, status: Enquiry['status'] = 'new', at = '2026-11-08T10:00:00Z'): Enquiry => ({ id, name: `N${id}`, phone: '', email: '', message: 'boxes', page: 'contact', status, createdAt: at, updatedAt: at });

function data(over: Partial<AppData> = {}): AppData {
  return { ...emptyData(), ...over };
}

describe('inbox', () => {
  it('lists unseen website orders and open enquiries; counts new ones', () => {
    const d = data({
      orders: [order('a', { source: 'web' }), order('b'), order('c', { source: 'web', status: 'cancelled' }), order('dd', { source: 'web' })],
      enquiries: [enq('1', 'contacted'), enq('2'), enq('3', 'closed')],
    });
    const b = inbox(d);
    expect(b.orders.map((o) => o.id)).toEqual(['dd', 'a']);
    expect(b.enquiries.map((e) => e.id)).toEqual(['2', '1']);
    expect(b.count).toBe(3);
    const seen = { ...d, settings: { ...d.settings, inboxSeen: markSeen(d, ['a', 'zz']) } };
    expect(seen.settings.inboxSeen).toEqual(['a']); // unknown ids are dropped
    expect(inbox(seen).count).toBe(2);
  });

  it('tells what arrived with a sync', () => {
    const before = data({ orders: [order('a', { source: 'web' })] });
    const after = data({ orders: [order('a', { source: 'web' }), order('b', { source: 'web' })], enquiries: [enq('1')] });
    const a = arrivals(before, after);
    expect(a.orders.map((o) => o.id)).toEqual(['b']);
    expect(arrivalText(a)).toBe('New website order ORD-b, new enquiry from N1');
    expect(arrivalText(arrivals(after, after))).toBe('');
    expect(arrivalText({ orders: [order('x'), order('y')], enquiries: [enq('1'), enq('2')] })).toBe('2 new website orders, 2 new enquiries');
  });

  it('enquiries sync: the server row comes in whole, the app sends back only the status', () => {
    let d = data();
    d = applyRow(d, 'enquiries', { id: 'e1', name: 'Selvi', phone: '9000000000', email: '', message: '5 ply 400×300×300, 1000 pcs', page: 'contact', status: 'new', created_at: '2026-11-08T10:00:00Z', updated_at: '2026-11-08T10:00:00Z', rev: 1 });
    expect(d.enquiries[0]).toMatchObject({ name: 'Selvi', status: 'new', message: '5 ply 400×300×300, 1000 pcs' });
    expect(rowsOf(d).get('enquiries:e1')!.row).toEqual({ id: 'e1', status: 'new' });
    expect(applyRow(d, 'enquiries', { id: 'e1', deleted_at: 'x' }).enquiries).toEqual([]);
  });
});
