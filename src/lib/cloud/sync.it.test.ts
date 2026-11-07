// Integration test: two phones syncing through the real database schema (supabase/migrations on local Postgres).
// Runs from `npm run db:test`, which starts Postgres and sets PGTEST_URL; skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { emptyData } from '../storage';
import { isUuid, uid } from '../format';
import type { AppData, Order } from '../types';
import { SyncEngine, newSyncState, type CloudApi, type SyncState } from './engine';
import { CloudController } from './controller';
import { rowsOf, sameRow } from './mapping';
import { asUser, pgApi } from './pg-api';

const url = process.env.PGTEST_URL;
const suite = url ? describe : describe.skip;

function device(api: CloudApi, orgId: string, role: string, initial: AppData) {
  let data = initial;
  const engine = new SyncEngine(api, newSyncState(orgId, role), {
    getData: () => data,
    setData: (n) => (data = n),
    saveState: async () => {},
  });
  return {
    engine,
    get data() {
      return data;
    },
    edit(fn: (d: AppData) => AppData) {
      const prev = data;
      data = fn(data);
      engine.track(prev, data);
    },
    async sync() {
      const r = await engine.sync();
      expect(r.errors).toEqual([]);
      return r;
    },
  };
}

const later = (ms = 1000) => new Date(Date.now() + ms).toISOString();

function phoneData(): AppData {
  const d = emptyData();
  const custId = uid();
  const boxId = uid();
  const order: Order = {
    id: uid(),
    number: 'ORD-0007',
    customerId: custId,
    date: '2026-11-01',
    dueDate: '2026-11-10',
    status: 'confirmed',
    items: [
      { id: uid(), description: '3 ply 300×200×150', qty: 500, rate: 12.8, hsn: '48191010', unit: 'Nos.', boxId },
      { id: uid(), description: 'Printing plate', qty: 1, rate: 1500 },
    ],
    discount: 100,
    taxPct: 5,
    payments: [{ id: uid(), date: '2026-11-02', amount: 3000, mode: 'UPI', note: 'advance' }],
    notes: '',
    invoice: { dispatchedThrough: 'Own vehicle' },
    createdAt: '2026-11-01T05:00:00.000Z',
    updatedAt: '2026-11-01T05:00:00.000Z',
  };
  return {
    ...d,
    customers: [{ id: custId, name: 'Kumar Traders', company: 'Kumar Traders Pvt Ltd', phone: '98765 43210', email: '', gstin: '33ABCDE1234F1Z5', address: 'Main Road', stateCode: '33', notes: '', createdAt: '2025-06-01T00:00:00.000Z', updatedAt: '2025-06-01T00:00:00.000Z' }],
    boxes: [{ id: boxId, name: 'Kumar 300', customerId: custId, spec: { length: 300, width: 200, height: 150, ply: 3, perLayer: false, layers: Array.from({ length: 9 }, () => ({ gsm: 120, bf: 18, price: 42 })) }, pricing: { overhead: 0, profitPct: 25, taxPct: 5 }, createdAt: '2025-06-02T00:00:00.000Z', updatedAt: '2025-06-02T00:00:00.000Z' }],
    orders: [order],
    settings: { ...d.settings, businessName: 'Honey Packers', invoicePrefix: 'HP/', nextOrderNo: 8, nextInvoiceNo: 330 },
    web: { ...d.web, zones: [{ id: uid(), name: 'Town', pincodeFrom: 622001, pincodeTo: 622999, mode: 'own', ratePerKg: 4, minCharge: 300, freeAbove: null, days: 1, active: true }] },
  };
}

/** Business data of two devices is the same (ignoring server-only fields and order of lists). */
function expectSameData(a: AppData, b: AppData) {
  const ra = rowsOf(a);
  const rb = rowsOf(b);
  expect([...rb.keys()].sort()).toEqual([...ra.keys()].sort());
  for (const [k, e] of ra) {
    const other = { ...rb.get(k)!.row, created_at: e.row.created_at };
    expect(sameRow(e.row, other), `${k}\n${JSON.stringify(e.row)}\n${JSON.stringify(rb.get(k)!.row)}`).toBe(true);
  }
}

suite('sync through the real schema', () => {
  let pool: pg.Pool;
  const owner = uid();
  const sales = uid();
  const prod = uid();
  let orgId = '';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query('insert into auth.users (id, email) values ($1, $2), ($3, $4), ($5, $6)', [owner, 'it-owner@x.in', sales, 'it-sales@x.in', prod, 'it-prod@x.in']);
    orgId = await asUser(pool, owner, async (c) => (await c.query(`select public.create_organization('IT Packers', 'Owner') as id`)).rows[0].id);
    await pool.query(`insert into public.user_profiles (id, organization_id, role) values ($1, $3, 'Sales'), ($2, $3, 'Production')`, [sales, prod, orgId]);
  });
  afterAll(() => pool?.end());

  let A: ReturnType<typeof device>;
  let B: ReturnType<typeof device>;

  it('moves the phone data to the cloud and a second phone downloads it', async () => {
    const api = pgApi(pool, owner);
    A = device(api, orgId, 'Administrator', phoneData());
    await api.setCounter('order', A.data.settings.nextOrderNo);
    await api.setCounter('invoice', A.data.settings.nextInvoiceNo);
    A.engine.queueAll();
    const r = await A.sync();
    expect(r.pushed).toBe(9); // company settings, price list, customer, box, order, 2 items, payment, zone
    expect(A.engine.pending).toBe(0);
    const { rows } = await pool.query('select (select count(*) from customers where org_id = $1) c, (select count(*) from order_items where org_id = $1) i, (select business_name from org_settings where org_id = $1) n, (select created_at from customers where org_id = $1) ca', [orgId]);
    expect(rows[0]).toMatchObject({ c: '1', i: '2', n: 'Honey Packers' });
    expect(new Date(rows[0].ca).toISOString()).toBe('2025-06-01T00:00:00.000Z');

    B = device(pgApi(pool, owner), orgId, 'Administrator', emptyData());
    await B.sync();
    expectSameData(A.data, B.data);
    expect(B.data.settings.businessName).toBe('Honey Packers');
    expect(B.data.orders[0].items.map((i) => i.description)).toEqual(['3 ply 300×200×150', 'Printing plate']);
    expect(B.engine.pending).toBe(0);
  });

  it('merges edits of different fields made on both phones', async () => {
    const c = A.data.customers[0].id;
    A.edit((d) => ({ ...d, customers: d.customers.map((x) => (x.id === c ? { ...x, name: 'Kumar Traders (Main)', updatedAt: later() } : x)) }));
    B.edit((d) => ({ ...d, customers: d.customers.map((x) => (x.id === c ? { ...x, phone: '99999 00000', updatedAt: later() } : x)) }));
    await A.sync();
    const rb = await B.sync();
    expect(rb.conflicts).toBe(0);
    await A.sync();
    for (const dev of [A, B]) expect(dev.data.customers[0]).toMatchObject({ name: 'Kumar Traders (Main)', phone: '99999 00000' });
    expectSameData(A.data, B.data);
  });

  it('same field changed on both: the newer edit wins and the other is listed', async () => {
    const c = A.data.customers[0].id;
    A.edit((d) => ({ ...d, customers: d.customers.map((x) => (x.id === c ? { ...x, notes: 'from A', updatedAt: later(1000) } : x)) }));
    B.edit((d) => ({ ...d, customers: d.customers.map((x) => (x.id === c ? { ...x, notes: 'from B', updatedAt: later(60_000) } : x)) }));
    await A.sync();
    const rb = await B.sync();
    expect(rb.conflicts).toBe(1);
    expect(B.engine.state.conflicts[0]).toMatchObject({ field: 'notes', kept: 'from B', lost: 'from A' });
    await A.sync();
    expect(A.data.customers[0].notes).toBe('from B');
    expect(B.data.customers[0].notes).toBe('from B');
  });

  it('payments added on both phones are all kept', async () => {
    const o = A.data.orders[0].id;
    const add = (amount: number) => (d: AppData) => ({ ...d, orders: d.orders.map((x) => (x.id === o ? { ...x, payments: [...x.payments, { id: uid(), date: '2026-11-05', amount, mode: 'Cash', note: '' }], updatedAt: later() } : x)) });
    A.edit(add(1000));
    B.edit(add(2000));
    await A.sync();
    await B.sync();
    await A.sync();
    for (const dev of [A, B]) expect(dev.data.orders[0].payments.map((p) => p.amount).sort()).toEqual([1000, 2000, 3000]);
  });

  it('company settings and the web price list sync, merged per field', async () => {
    A.edit((d) => ({ ...d, settings: { ...d.settings, businessTagline: 'Boxes for every business' } }));
    B.edit((d) => ({ ...d, settings: { ...d.settings, businessPhone: '+91 90000 00000' }, web: { ...d.web, minOrderValue: 2000 } }));
    await A.sync();
    await B.sync();
    await A.sync();
    for (const dev of [A, B]) {
      expect(dev.data.settings).toMatchObject({ businessTagline: 'Boxes for every business', businessPhone: '+91 90000 00000' });
      expect(dev.data.web.minOrderValue).toBe(2000);
    }
  });

  it('an order made offline gets a real number, and invoice numbers come only from the server', async () => {
    const offline = { on: true };
    const C = device(pgApi(pool, owner, { offline: () => offline.on }), orgId, 'Administrator', B.data);
    C.engine.state.base = structuredClone(B.engine.state.base);
    C.engine.state.lastPulledAt = B.engine.state.lastPulledAt;
    const id = uid();
    C.edit((d) => ({ ...d, orders: [{ ...d.orders[0], id, number: `D-${C.engine.state.device}-1`, items: [], payments: [], invoiceNo: undefined, createdAt: later(), updatedAt: later() }, ...d.orders] }));
    const r = await C.engine.sync();
    expect(r.errors[0]).toMatch(/Failed to fetch/);
    expect(C.engine.pending).toBe(1);
    await expect(C.engine.assignInvoiceNo(id)).rejects.toThrow(/not reached the cloud/);

    offline.on = false;
    await C.sync();
    const made = C.data.orders.find((o) => o.id === id)!;
    expect(made.number).toBe('ORD-0008'); // counter moved over from the phone (nextOrderNo 8)
    expect(await C.engine.assignInvoiceNo(id)).toBe('HP/330');
    expect(await C.engine.assignInvoiceNo(id)).toBe('HP/330');
    expect(await A.engine.assignInvoiceNo(A.data.orders[0].id)).toBe('HP/331');
    await C.sync(); // nothing left to push: the number changes did not cause a conflict
    expect(C.engine.state.conflicts).toEqual([]);
    expect(C.engine.pending).toBe(0);
    await A.sync();
    expect(A.data.orders.find((o) => o.id === id)).toMatchObject({ number: 'ORD-0008', invoiceNo: 'HP/330' });
  });

  it('deleting an order removes it, its lines and payments everywhere', async () => {
    const o = A.data.orders.find((x) => x.number === 'ORD-0007')!;
    A.edit((d) => ({ ...d, orders: d.orders.filter((x) => x.id !== o.id) }));
    await A.sync();
    await B.sync();
    expect(B.data.orders.some((x) => x.id === o.id)).toBe(false);
    const { rows } = await pool.query('select count(*) filter (where deleted_at is null) live, count(*) all_ from order_items where order_id = $1', [o.id]);
    expect(rows[0]).toMatchObject({ live: '0', all_: '2' }); // soft-deleted, so other phones learn about it
    expectSameData(A.data, B.data);
  });

  it('staff roles: sales can sync, production only reads', async () => {
    const S = device(pgApi(pool, sales), orgId, 'Sales', emptyData());
    await S.sync();
    expect(S.data.customers).toHaveLength(1);
    S.edit((d) => ({ ...d, customers: [...d.customers, { id: uid(), name: 'New buyer', company: '', phone: '', email: '', gstin: '', address: '', notes: '', createdAt: later(), updatedAt: later() }] }));
    S.edit((d) => ({ ...d, settings: { ...d.settings, businessName: 'Hacked' } }));
    await S.sync();
    expect(S.engine.pending).toBe(0);
    expect(S.data.settings.businessName).toBe('Hacked'); // only on this phone…
    const { rows } = await pool.query('select business_name from org_settings where org_id = $1', [orgId]);
    expect(rows[0].business_name).toBe('Honey Packers'); // …the server keeps the owner's

    const P = device(pgApi(pool, prod), orgId, 'Production', emptyData());
    await P.sync();
    expect(P.engine.canWrite).toBe(false);
    expect(P.data.customers).toHaveLength(0);
    expect(P.data.orders.every((x) => x.discount === 0 && x.items.every((i) => i.rate === 0))).toBe(true);
  });
});

suite('controller flows: move a phone to the cloud, other phones join', () => {
  let pool: pg.Pool;
  const owner = uid();
  const memory = new Map<string, SyncState | null>();

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query('insert into auth.users (id, email) values ($1, $2)', [owner, 'flow-owner@x.in']);
  });
  afterAll(() => pool?.end());

  function phone(name: string, initial: AppData) {
    let data = initial;
    const backups: AppData[] = [];
    const ctl = new CloudController(
      { getData: () => data, setDataUntracked: (n) => (data = n), backupNow: async () => void backups.push(data) },
      {
        cloudConfigured: true,
        currentUser: async () => ({ id: owner, email: 'flow-owner@x.in' }),
        myProfile: () =>
          asUser(pool, owner, async (c) => {
            const r = (await c.query(`select p.organization_id, p.role, o.name from user_profiles p join organizations o on o.id = p.organization_id where p.id = $1`, [owner])).rows[0];
            return r ? { orgId: r.organization_id, orgName: r.name, role: r.role, name: '' } : null;
          }),
        createOrganization: (n: string, you: string) => asUser(pool, owner, async (c) => (await c.query('select public.create_organization($1, $2) as id', [n, you])).rows[0].id),
        loadSyncState: async () => memory.get(name) ?? null,
        saveSyncState: async (s: SyncState) => void memory.set(name, structuredClone(s)),
        clearSyncState: async () => void memory.delete(name),
        signOut: async () => {},
        api: () => pgApi(pool, owner),
      },
    );
    return {
      ctl,
      backups,
      get data() {
        return data;
      },
      edit(fn: (d: AppData) => AppData) {
        const prev = data;
        data = fn(data);
        ctl.track(prev, data);
      },
    };
  }

  it('creates the business from an old phone (short ids) and keeps its numbers', async () => {
    const legacy = phoneData();
    const c = legacy.customers[0];
    legacy.customers = [{ ...c, id: 'kq3x1abc' }];
    legacy.orders = legacy.orders.map((o) => ({ ...o, id: 'kq3x1ord', customerId: 'kq3x1abc' }));
    legacy.boxes = legacy.boxes.map((b) => ({ ...b, customerId: 'kq3x1abc' }));
    const A = phone('A', legacy);
    await A.ctl.init();
    expect(A.ctl.status.phase).toBe('no-business');
    await A.ctl.createBusiness('Flow Packers', 'Owner');
    expect(A.ctl.status).toMatchObject({ phase: 'ready', pending: 0, lastError: '' });
    expect(A.backups).toHaveLength(1);
    expect(isUuid(A.data.customers[0].id) && A.data.orders[0].customerId === A.data.customers[0].id).toBe(true);
    expect(A.ctl.draftOrderNumber(8)).toMatch(/^D-....-8$/);
    expect(await A.ctl.assignInvoiceNo(A.data.orders[0].id)).toBe('HP/330');

    // app restarted offline: straight back to ready from the saved state
    const again = phone('A', A.data);
    await again.ctl.init();
    expect(again.ctl.status.phase).toBe('ready');
  });

  it('a new phone downloads the business; a used phone can add its own records', async () => {
    const B = phone('B', emptyData());
    await B.ctl.init();
    expect(B.ctl.status).toMatchObject({ phase: 'join', orgName: 'Flow Packers' });
    await B.ctl.join('replace');
    expect(B.ctl.status.lastError).toBe('');
    expect(B.data.customers.map((c) => c.name)).toEqual(['Kumar Traders']);
    expect(B.data.orders[0].invoiceNo).toBe('HP/330');
    expect(B.data.settings.businessName).toBe('Honey Packers');

    const own = phoneData();
    own.customers = [{ ...own.customers[0], id: 'local1', name: 'Only on phone C' }];
    own.orders = [];
    own.boxes = [];
    own.settings = { ...own.settings, businessName: 'Should not win' };
    const C = phone('C', own);
    await C.ctl.init();
    await C.ctl.join('merge');
    expect(C.ctl.status).toMatchObject({ pending: 0, lastError: '' });
    expect(C.data.customers.map((c) => c.name).sort()).toEqual(['Kumar Traders', 'Only on phone C']);
    expect(C.data.settings.businessName).toBe('Honey Packers');

    B.edit((d) => ({ ...d, customers: d.customers.map((x) => ({ ...x, notes: 'called', updatedAt: later() })) }));
    await B.ctl.syncNow();
    await C.ctl.syncNow();
    expect(C.data.customers.find((c) => c.name === 'Kumar Traders')?.notes).toBe('called');
  });
});
