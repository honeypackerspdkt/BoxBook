import { describe, expect, it } from 'vitest';
import { emptyData } from '../storage';
import { isUuid } from '../format';
import type { AppData } from '../types';
import { applyRow, applySettingsRow, applyWebRulesRow, rowsOf, same, sameRow, settingsRow, webRulesRow } from './mapping';
import { merge3 } from './merge';
import { changedKeys, RULES_KEY, SETTINGS_KEY } from './engine';
import { withUuidIds } from './migrate';

function sample(): AppData {
  const d = emptyData();
  return {
    ...d,
    customers: [{ id: 'c1', name: 'Kumar', company: 'KT', phone: '1', email: '', gstin: '', address: '', stateCode: '33', notes: '', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' }],
    boxes: [{ id: 'b1', name: 'Box', customerId: 'c1', spec: { length: 1, width: 2, height: 3, ply: 3, perLayer: false, layers: [] }, pricing: { overhead: 0, profitPct: 25, taxPct: 5 }, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' }],
    orders: [
      {
        id: 'o1', number: 'ORD-0001', customerId: 'c1', date: '2026-01-01', dueDate: '', status: 'quote', discount: 0, taxPct: 5, notes: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        items: [{ id: 'i1', description: 'A', qty: 2, rate: 3, boxId: 'b1' }, { id: 'i2', description: 'B', qty: 1, rate: 1 }],
        payments: [{ id: 'p1', date: '2026-01-02', amount: 4, mode: 'Cash', note: '' }],
      },
    ],
    web: { ...d.web, zones: [{ id: 'z1', name: 'Town', pincodeFrom: 622001, pincodeTo: 622999, mode: 'own', ratePerKg: 4, minCharge: 300, freeAbove: null, days: 1, active: true }] },
  };
}

describe('mapping', () => {
  it('app data → rows → app data gives the same business data', () => {
    const d = sample();
    let back: AppData = { ...emptyData(), settings: d.settings, web: { ...d.web, zones: [] } };
    for (const { table, row } of [...rowsOf(d).values()]) back = applyRow(back, table, { ...row, rev: 1, updated_at: '2026-01-03T00:00:00Z' });
    const a = rowsOf(d);
    const b = rowsOf(back);
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    for (const [k, e] of a) expect(sameRow(e.row, b.get(k)!.row), k).toBe(true);
    expect(back.orders[0].items.map((i) => i.id)).toEqual(['i1', 'i2']);
  });

  it('deleted rows remove the record', () => {
    const d = sample();
    expect(applyRow(d, 'payments', { id: 'p1', order_id: 'o1', deleted_at: 'x' }).orders[0].payments).toEqual([]);
    expect(applyRow(d, 'orders', { id: 'o1', deleted_at: 'x' }).orders).toEqual([]);
    expect(applyRow(d, 'delivery_zones', { id: 'z1', deleted_at: 'x' }).web.zones).toEqual([]);
    expect(applyRow(d, 'order_items', { id: 'x', order_id: 'missing', description: 'y' })).toBe(d);
  });

  it('company settings and price list rows round-trip', () => {
    const s = { ...emptyData().settings, businessName: 'HP', invoicePrefix: 'HP/', defaults: { overhead: 1, profitPct: 20, taxPct: 5 } };
    expect(applySettingsRow(emptyData().settings, settingsRow(s))).toMatchObject({ businessName: 'HP', invoicePrefix: 'HP/', defaults: { overhead: 1, profitPct: 20, taxPct: 5 } });
    const w = { ...emptyData().web, advancePct: 50, showPrices: false };
    expect(applyWebRulesRow(emptyData().web, { ...webRulesRow(w), advance_pct: '50.00' })).toMatchObject({ advancePct: 50, showPrices: false });
  });

  it('compares like Postgres stores (key order, numeric strings, null vs missing)', () => {
    expect(same({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(same(12.8, '12.8000')).toBe(true);
    expect(same(undefined, null)).toBe(true);
    expect(same([1, 2], [2, 1])).toBe(false);
    expect(sameRow({ id: 'x', name: 'a', rev: 1 }, { id: 'x', name: 'a', rev: 9, updated_at: 'z' })).toBe(true);
  });
});

describe('changedKeys', () => {
  it('finds new, changed and deleted rows, settings and price list', () => {
    const a = sample();
    const b: AppData = {
      ...a,
      customers: [{ ...a.customers[0], phone: '2' }],
      orders: [{ ...a.orders[0], items: [a.orders[0].items[0], { id: 'i3', description: 'C', qty: 1, rate: 1 }] }],
      settings: { ...a.settings, businessName: 'New' },
    };
    const keys = changedKeys(a, b).map((k) => `${k.op} ${k.key}`).sort();
    expect(keys).toEqual(['delete order_items:i2', 'upsert customers:c1', `upsert ${SETTINGS_KEY}`, 'upsert order_items:i3'].sort());
    expect(changedKeys(a, { ...a, web: { ...a.web, showPrices: false } }).map((k) => k.key)).toEqual([RULES_KEY]);
    expect(changedKeys(a, { ...a, settings: { ...a.settings, theme: 'dark', lastBackupAt: 'now' } })).toEqual([]);
  });
});

describe('merge3', () => {
  const base = { id: 'x', name: 'A', phone: '1', notes: '' };
  it('takes each side’s own changes', () => {
    expect(merge3(base, { ...base, name: 'A2' }, { ...base, phone: '2', rev: 3 }, false)).toEqual({ merged: { ...base, name: 'A2', phone: '2', rev: 3 }, conflicts: [] });
  });
  it('same field on both sides: newer wins and the other is reported', () => {
    const r = merge3(base, { ...base, notes: 'L' }, { ...base, notes: 'S' }, true);
    expect(r.merged.notes).toBe('L');
    expect(r.conflicts).toEqual([{ field: 'notes', kept: 'L', lost: 'S' }]);
    expect(merge3(base, { ...base, notes: 'L' }, { ...base, notes: 'S' }, false).merged.notes).toBe('S');
  });
  it('without a common copy every difference is a conflict', () => {
    expect(merge3(undefined, { id: 'x', a: 1, b: 2 }, { id: 'x', a: 1, b: 3 }, true).conflicts).toHaveLength(1);
  });
});

describe('withUuidIds', () => {
  it('gives every record a UUID and keeps the links', () => {
    const { data, changed } = withUuidIds(sample());
    expect(changed).toBe(7);
    const c = data.customers[0].id;
    const b = data.boxes[0].id;
    expect([c, b, data.orders[0].id, data.orders[0].items[0].id, data.orders[0].payments[0].id, data.web.zones[0].id].every(isUuid)).toBe(true);
    expect(data.boxes[0].customerId).toBe(c);
    expect(data.orders[0].customerId).toBe(c);
    expect(data.orders[0].items[0].boxId).toBe(b);
    expect(withUuidIds(data).changed).toBe(0);
  });
});

describe('payment link from the app', () => {
  it('uploads first, then asks the website for a link with the signed-in token', async () => {
    const { CloudController } = await import('./controller');
    const orderRow = { id: 'o-1', number: 'ORD-0007', customer_id: '', date: '2026-11-01', due_date: null, status: 'confirmed', discount: 0, tax_pct: 5, notes: '', invoice: {}, delivery: {}, source: 'app', rev: 3, updated_at: '2026-11-02T00:00:00Z', deleted_at: null };
    let data = emptyData();
    const calls: { url: string; init: RequestInit }[] = [];
    let pulls = 0;
    const api = {
      push: async () => [],
      pull: async () => ({ server_time: new Date().toISOString(), org_id: 'org', role: 'Sales', settings: null, price_rules: null, orders: pulls++ === 0 ? [orderRow] : [] }),
      saveSettings: async () => ({ status: 'ok' as const, row: {} }),
      saveWebRules: async () => ({ status: 'ok' as const, row: {} }),
      assignOrderNo: async () => '',
      assignInvoiceNo: async () => '',
      setCounter: async () => {},
    };
    const ctl = new CloudController(
      { getData: () => data, setDataUntracked: (n) => (data = n), backupNow: async () => {} },
      {
        cloudConfigured: true,
        currentUser: async () => ({ id: 'u', email: '+919876543210' }),
        myProfile: async () => ({ orgId: 'org', orgName: 'HP', role: 'Sales', name: '' }),
        myInvitation: async () => null,
        loadSyncState: async () => null,
        saveSyncState: async () => {},
        clearSyncState: async () => {},
        accessToken: async () => 'tok-1',
        shopUrl: 'https://shop.test',
        fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
          calls.push({ url: String(url), init: init! });
          return new Response(JSON.stringify({ url: 'https://rzp.io/i/x', amount: 5190, orderNumber: 'ORD-0007' }), { status: 200 });
        }) as typeof fetch,
        api: () => api,
      },
    );
    await expect(ctl.paymentLink('o-1')).rejects.toThrow(/cloud sync/);
    await ctl.init();
    await ctl.join('replace');
    expect(data.orders.map((o) => o.number)).toEqual(['ORD-0007']);
    expect(await ctl.paymentLink('o-1')).toEqual({ url: 'https://rzp.io/i/x', amount: 5190, orderNumber: 'ORD-0007' });
    expect(calls[0].url).toBe('https://shop.test/.netlify/functions/payment-link');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok-1');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ orderId: 'o-1' });
    await expect(ctl.paymentLink('not-uploaded')).rejects.toThrow(/not reached the cloud/);
  });
});

describe('website artwork on orders', () => {
  const artwork = { print: 'one' as const, colours: 1, box: { length: 300, width: 200, height: 150 }, ink: '#c62828', elements: [{ id: 't', kind: 'text' as const, text: 'Fragile', x: 0.5, y: 0.8, size: 0.1 }], preview: 'org/artwork/x/preview.png' };
  const row = { id: 'o-web', number: 'ORD-0009', customer_id: '', date: '2026-11-09', status: 'quote', discount: 0, tax_pct: 5, notes: '', invoice: {}, delivery: {}, source: 'web', artwork, rev: 1, updated_at: '2026-11-09T00:00:00Z', deleted_at: null };

  it('comes in from the server and goes back unchanged', () => {
    const d = applyRow(emptyData(), 'orders', row);
    expect(d.orders[0]).toMatchObject({ source: 'web', artwork });
    expect(rowsOf(d).get('orders:o-web')!.row.artwork).toEqual(artwork);
  });
  it('is never sent for manual orders (a device must not blank a stored design)', () => {
    const d = applyRow(emptyData(), 'orders', { ...row, id: 'o-app', source: 'app', artwork: {} });
    expect(d.orders[0].artwork).toBeUndefined();
    expect('artwork' in rowsOf(d).get('orders:o-app')!.row).toBe(false);
  });
});
