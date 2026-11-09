import type { DeliveryZone, WebShop } from '@honeypackers/box-core/pricing';
import { normalizeWebShop } from '@honeypackers/box-core/pricing';
import type { AppData, Customer, Enquiry, Order, OrderItem, Payment, Product, SavedBox, Settings } from '../types';

/**
 * App records ↔ Supabase rows (supabase/migrations). Rows use the database column names and leave out
 * org_id / rev / updated_at / updated_by: the sync engine adds and reads those.
 */
export type Table = 'customers' | 'boxes' | 'products' | 'orders' | 'order_items' | 'payments' | 'delivery_zones' | 'enquiries';
/** Push order: parents before children (foreign keys). */
export const TABLES: Table[] = ['customers', 'boxes', 'products', 'orders', 'order_items', 'payments', 'delivery_zones', 'enquiries'];

export type Row = { id: string } & Record<string, unknown>;
export interface Entry {
  table: Table;
  row: Row;
}
export const keyOf = (table: string, id: string) => `${table}:${id}`;
export const splitKey = (key: string) => {
  const i = key.indexOf(':');
  return { table: key.slice(0, i), id: key.slice(i + 1) };
};

/** Fields that the server manages; never compared or merged. */
const SERVER_FIELDS = new Set(['org_id', 'rev', 'created_at', 'updated_at', 'updated_by', 'deleted_at', 'user_id', 'product_id', 'razorpay_payment_id', 'razorpay_order_id']);
export const isServerField = (f: string) => SERVER_FIELDS.has(f);

const orNull = <T>(v: T | undefined | '') => (v === undefined || v === '' ? null : v);

/* ───────────── app → rows ───────────── */

export const customerRow = (c: Customer): Row => ({
  id: c.id,
  name: c.name,
  company: c.company || '',
  phone: c.phone || '',
  email: c.email || '',
  gstin: c.gstin || '',
  address: c.address || '',
  state_code: c.stateCode || '',
  notes: c.notes || '',
  created_at: c.createdAt || null,
});

export const boxRow = (b: SavedBox): Row => ({
  id: b.id,
  name: b.name,
  customer_id: b.customerId || null,
  spec: b.spec,
  pricing: b.pricing,
  created_at: b.createdAt || null,
});

export const orderRow = (o: Order): Row => ({
  id: o.id,
  number: o.number,
  customer_id: o.customerId || null,
  date: o.date,
  due_date: orNull(o.dueDate),
  status: o.status,
  discount: o.discount || 0,
  tax_pct: o.taxPct || 0,
  notes: o.notes || '',
  invoice_no: orNull(o.invoiceNo),
  invoice: o.invoice || {},
  delivery: o.delivery || {},
  source: o.source || 'app',
  // Only sent when the order has one: a device never blanks the design the website stored.
  ...(o.artwork ? { artwork: o.artwork } : {}),
  created_at: o.createdAt || null,
});

export const itemRow = (o: Order, it: OrderItem, position: number): Row => ({
  id: it.id,
  order_id: o.id,
  position,
  description: it.description || '',
  qty: it.qty || 0,
  rate: it.rate || 0,
  hsn: orNull(it.hsn),
  unit: orNull(it.unit),
  spec: it.spec ?? null,
  box_id: it.boxId || null,
  created_at: o.createdAt || null,
});

export const paymentRow = (o: Order, p: Payment): Row => ({
  id: p.id,
  order_id: o.id,
  date: p.date,
  amount: p.amount || 0,
  mode: p.mode || '',
  note: p.note || '',
});

export const zoneRow = (z: DeliveryZone, sort: number): Row => ({
  id: z.id!,
  name: z.name,
  pincode_from: z.pincodeFrom,
  pincode_to: z.pincodeTo,
  mode: z.mode,
  rate_per_kg: z.ratePerKg || 0,
  min_charge: z.minCharge || 0,
  free_above: z.freeAbove ?? null,
  days: z.days || 0,
  active: z.active !== false,
  sort: z.sort ?? sort,
});

export const productRow = (p: Product): Row => ({
  id: p.id,
  slug: p.slug,
  name: p.name,
  description: p.description || '',
  ply: p.ply,
  spec: p.spec,
  packs: p.packs,
  hsn: p.hsn || '48191010',
  tax_pct: p.taxPct ?? 5,
  stock_qty: p.stockQty ?? null,
  photos: p.photos || [],
  active: p.active,
  sort: p.sort || 0,
  created_at: p.createdAt || null,
});

/** Only the status is changed in the app; the rest comes from the website. */
export const enquiryRow = (e: Enquiry): Row => ({ id: e.id, status: e.status });

/** Every syncable row in the app data, by key. */
export function rowsOf(d: AppData): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const put = (table: Table, row: Row) => out.set(keyOf(table, row.id), { table, row });
  d.customers.forEach((c) => put('customers', customerRow(c)));
  d.boxes.forEach((b) => put('boxes', boxRow(b)));
  for (const o of d.orders) {
    put('orders', orderRow(o));
    o.items.forEach((it, i) => put('order_items', itemRow(o, it, i)));
    o.payments.forEach((p) => put('payments', paymentRow(o, p)));
  }
  d.web.zones.forEach((z, i) => z.id && put('delivery_zones', zoneRow(z, i)));
  (d.enquiries || []).forEach((e) => put('enquiries', enquiryRow(e)));
  (d.products || []).forEach((p) => put('products', productRow(p)));
  return out;
}

/* ───────────── rows → app ───────────── */

const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => (v == null || v === '' ? 0 : Number(v));
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : new Date().toISOString());

/** Applies one server row (or its deletion) to the app data. Returns the same object when nothing applies. */
export function applyRow(d: AppData, table: string, row: Row): AppData {
  const deleted = row.deleted_at != null;
  const id = row.id;
  switch (table) {
    case 'customers': {
      if (deleted) return { ...d, customers: d.customers.filter((c) => c.id !== id) };
      const prev = d.customers.find((c) => c.id === id);
      const c: Customer = {
        ...prev,
        id,
        name: str(row.name),
        company: str(row.company),
        phone: str(row.phone),
        email: str(row.email),
        gstin: str(row.gstin),
        address: str(row.address),
        ...(row.state_code ? { stateCode: str(row.state_code) } : { stateCode: undefined }),
        notes: str(row.notes),
        createdAt: prev?.createdAt || iso(row.created_at),
        updatedAt: iso(row.updated_at),
      };
      return { ...d, customers: prev ? d.customers.map((x) => (x.id === id ? c : x)) : [c, ...d.customers] };
    }
    case 'boxes': {
      if (deleted) return { ...d, boxes: d.boxes.filter((b) => b.id !== id) };
      const prev = d.boxes.find((b) => b.id === id);
      const b: SavedBox = {
        id,
        name: str(row.name),
        customerId: row.customer_id ? str(row.customer_id) : undefined,
        spec: row.spec as SavedBox['spec'],
        pricing: row.pricing as SavedBox['pricing'],
        createdAt: prev?.createdAt || iso(row.created_at),
        updatedAt: iso(row.updated_at),
      };
      return { ...d, boxes: prev ? d.boxes.map((x) => (x.id === id ? b : x)) : [b, ...d.boxes] };
    }
    case 'orders': {
      if (deleted) return { ...d, orders: d.orders.filter((o) => o.id !== id) };
      const prev = d.orders.find((o) => o.id === id);
      const o: Order = {
        id,
        number: str(row.number),
        customerId: str(row.customer_id),
        date: str(row.date),
        dueDate: str(row.due_date),
        status: (row.status as Order['status']) || 'quote',
        items: prev?.items || [],
        discount: num(row.discount),
        taxPct: num(row.tax_pct),
        payments: prev?.payments || [],
        notes: str(row.notes),
        ...(row.invoice_no ? { invoiceNo: str(row.invoice_no) } : {}),
        ...(row.invoice && Object.keys(row.invoice as object).length ? { invoice: row.invoice as Order['invoice'] } : {}),
        ...(row.delivery && Object.keys(row.delivery as object).length ? { delivery: row.delivery as Order['delivery'] } : {}),
        ...(row.source === 'web' ? { source: 'web' as const } : {}),
        ...(row.artwork && Object.keys(row.artwork as object).length ? { artwork: row.artwork as Order['artwork'] } : {}),
        ...(row.customer_name ? { customerName: str(row.customer_name) } : {}),
        createdAt: prev?.createdAt || iso(row.created_at),
        updatedAt: iso(row.updated_at),
      };
      return { ...d, orders: prev ? d.orders.map((x) => (x.id === id ? o : x)) : [o, ...d.orders] };
    }
    case 'order_items':
    case 'payments': {
      const orderId = str(row.order_id);
      const owner = d.orders.find((o) => o.id === orderId);
      if (!owner) return d; // order not here (deleted locally, or not visible to this role)
      let next: Order;
      if (table === 'order_items') {
        const others = owner.items.filter((it) => it.id !== id);
        if (deleted) next = { ...owner, items: others };
        else {
          const it: OrderItem = {
            id,
            description: str(row.description),
            qty: num(row.qty),
            rate: num(row.rate),
            ...(row.hsn ? { hsn: str(row.hsn) } : {}),
            ...(row.unit ? { unit: str(row.unit) } : {}),
            ...(row.spec ? { spec: row.spec as OrderItem['spec'] } : {}),
            ...(row.box_id ? { boxId: str(row.box_id) } : {}),
          };
          const pos = Math.max(0, Math.min(num(row.position), others.length));
          next = { ...owner, items: [...others.slice(0, pos), it, ...others.slice(pos)] };
        }
      } else {
        const others = owner.payments.filter((p) => p.id !== id);
        if (deleted) next = { ...owner, payments: others };
        else {
          const p: Payment = { id, date: str(row.date), amount: num(row.amount), mode: str(row.mode), note: str(row.note) };
          const at = owner.payments.findIndex((x) => x.id === id);
          next = { ...owner, payments: at >= 0 ? owner.payments.map((x) => (x.id === id ? p : x)) : [...others, p] };
        }
      }
      return { ...d, orders: d.orders.map((o) => (o.id === orderId ? next : o)) };
    }
    case 'products': {
      const list = d.products || [];
      if (deleted) return { ...d, products: list.filter((p) => p.id !== id) };
      const prev = list.find((p) => p.id === id);
      const p: Product = {
        id,
        slug: str(row.slug),
        name: str(row.name),
        description: str(row.description),
        ply: (num(row.ply) || 3) as Product['ply'],
        spec: row.spec as Product['spec'],
        packs: Array.isArray(row.packs) ? (row.packs as Product['packs']).map((k) => ({ qty: num(k.qty), price: num(k.price) })) : [],
        hsn: str(row.hsn) || '48191010',
        taxPct: num(row.tax_pct),
        stockQty: row.stock_qty == null ? null : num(row.stock_qty),
        photos: Array.isArray(row.photos) ? (row.photos as string[]) : [],
        active: row.active !== false,
        sort: num(row.sort),
        createdAt: prev?.createdAt || iso(row.created_at),
        updatedAt: iso(row.updated_at),
      };
      return { ...d, products: prev ? list.map((x) => (x.id === id ? p : x)) : [...list, p] };
    }
    case 'enquiries': {
      const list = d.enquiries || [];
      if (deleted) return { ...d, enquiries: list.filter((e) => e.id !== id) };
      const prev = list.find((e) => e.id === id);
      const e: Enquiry = {
        id,
        name: str(row.name),
        phone: str(row.phone),
        email: str(row.email),
        message: str(row.message),
        page: str(row.page),
        status: (['new', 'contacted', 'closed'].includes(str(row.status)) ? str(row.status) : 'new') as Enquiry['status'],
        createdAt: prev?.createdAt || iso(row.created_at),
        updatedAt: iso(row.updated_at),
      };
      return { ...d, enquiries: prev ? list.map((x) => (x.id === id ? e : x)) : [e, ...list] };
    }
    case 'delivery_zones': {
      const zones = d.web.zones.filter((z) => z.id !== id);
      if (deleted) return { ...d, web: { ...d.web, zones } };
      const z: DeliveryZone = {
        id,
        name: str(row.name),
        pincodeFrom: num(row.pincode_from),
        pincodeTo: num(row.pincode_to),
        mode: (row.mode as DeliveryZone['mode']) || 'own',
        ratePerKg: num(row.rate_per_kg),
        minCharge: num(row.min_charge),
        freeAbove: row.free_above == null ? null : num(row.free_above),
        days: num(row.days),
        active: row.active !== false,
        sort: num(row.sort),
      };
      const at = d.web.zones.findIndex((x) => x.id === id);
      return { ...d, web: { ...d.web, zones: at >= 0 ? d.web.zones.map((x) => (x.id === id ? z : x)) : [...zones, z] } };
    }
  }
  return d;
}

/* ───────────── company settings + web price list (one row per organisation) ───────────── */

const COMPANY: [keyof Settings, string][] = [
  ['businessName', 'business_name'],
  ['businessTagline', 'business_tagline'],
  ['businessAddress', 'business_address'],
  ['businessPhone', 'business_phone'],
  ['businessEmail', 'business_email'],
  ['businessGstin', 'business_gstin'],
  ['businessState', 'business_state'],
  ['bankHolder', 'bank_holder'],
  ['bankName', 'bank_name'],
  ['bankAccount', 'bank_account'],
  ['bankBranch', 'bank_branch'],
  ['bankIfsc', 'bank_ifsc'],
  ['invoiceDeclaration', 'invoice_declaration'],
  ['invoicePrefix', 'invoice_prefix'],
  ['defaultHsn', 'default_hsn'],
  ['defaultUnit', 'default_unit'],
  ['currency', 'currency'],
];

/** Company profile → org_settings columns. The logo stays on the device for now (it is in every backup). */
export function settingsRow(s: Settings): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, col] of COMPANY) r[col] = s[k] ?? '';
  r.pricing_defaults = s.defaults;
  return r;
}

export function applySettingsRow(s: Settings, row: Record<string, unknown>): Settings {
  const next: Settings = { ...s };
  for (const [k, col] of COMPANY) if (col in row) (next as unknown as Record<string, unknown>)[k] = str(row[col]);
  if (row.pricing_defaults && typeof row.pricing_defaults === 'object') next.defaults = { ...s.defaults, ...(row.pricing_defaults as Settings['defaults']) };
  return next;
}

export const webRulesRow = (w: WebShop): Record<string, unknown> => ({
  rules: w.rules,
  advance_pct: w.advancePct,
  min_order_value: w.minOrderValue,
  show_prices: w.showPrices,
});

export function applyWebRulesRow(w: WebShop, row: Record<string, unknown>): WebShop {
  const n = normalizeWebShop({ rules: row.rules, advancePct: num(row.advance_pct), minOrderValue: num(row.min_order_value), showPrices: row.show_prices !== false, zones: w.zones });
  return { ...n, zones: w.zones };
}

/* ───────────── comparing ───────────── */

/** Deep equality with key order ignored (Postgres jsonb sorts keys) and undefined ≡ missing. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b) && !Number.isNaN(Number(a));
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => same(x, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!same(ao[k], bo[k])) return false;
  return true;
}

/** Same row, looking only at the fields the app owns. */
export function sameRow(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  for (const k of Object.keys(a)) {
    if (isServerField(k)) continue;
    if (!same(a[k], b[k])) return false;
  }
  return true;
}
