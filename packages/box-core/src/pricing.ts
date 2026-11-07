import { calcBox, emptyLayers } from './calc';
import type { BoxResult, BoxSpec, Ply, Product, ProductPack } from './types';

/**
 * Web price list for custom boxes (Supabase `price_rules.rules`) and the maths that turns a
 * size + grade + quantity into a price. The website shows it live; the checkout function runs the
 * same code again on the server and refuses an order whose amount differs.
 *
 *   paper      = calcBox(spec).paperCost              (Σ layer kg × ₹/kg, eBox maths)
 *   conversion = box weight kg × conversion ₹/kg for the ply
 *   printing   = colours × ₹/colour/box + plate charge × colours / qty
 *   base       = paper + conversion + printing
 *   unit price = base × (1 + margin % of the quantity slab), rounded to paise
 *   GST        = on goods (and delivery, composite supply) at taxPct, 5% for HSN 4819
 */

export interface PaperRate {
  bf: number;
  gsm: number;
  pricePerKg: number;
}

/** A board grade the buyer can pick. `layers` has one entry (same paper in every layer) or one per layer, top liner first. */
export interface Grade {
  id: string;
  label: string;
  ply: Ply;
  layers: { gsm: number; bf: number }[];
}

export interface Slab {
  minQty: number;
  marginPct: number;
}

export interface PriceRules {
  paper: PaperRate[];
  /** ₹ per kg of board for converting (corrugation, pasting, slotting, labour), keyed by ply ('3', '5', …). */
  conversionPerKg: Partial<Record<string, number>>;
  printing: { perColourPerBox: number; plateCharge: number; maxColours: number };
  slabs: Slab[];
  /** Sizes in mm. maxDeckle / maxCut / maxQty of 0 (or missing maxQty) mean no limit. */
  limits: { minQty: number; maxQty?: number; maxDeckle: number; maxCut: number; minSide?: number };
  grades: Grade[];
}

export interface CustomBoxInput {
  /** Inner size in mm. */
  length: number;
  width: number;
  height: number;
  gradeId: string;
  qty: number;
  /** Printed colours (0 = plain). */
  colours?: number;
}

export type PriceProblem = 'bad-size' | 'unknown-grade' | 'no-paper-rate' | 'too-big' | 'qty-too-low' | 'qty-too-high' | 'too-many-colours' | 'no-slab';

export type CustomBoxPrice =
  | {
      ok: true;
      spec: BoxSpec;
      grade: Grade;
      box: BoxResult;
      /** Board weight of one box in kg (for freight). */
      weightKg: number;
      paper: number;
      conversion: number;
      printing: number;
      base: number;
      marginPct: number;
      /** Price per box before GST. */
      unitPrice: number;
      qty: number;
      /** unitPrice × qty, before GST. */
      amount: number;
    }
  | { ok: false; problem: PriceProblem; message: string };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const fail = (problem: PriceProblem, message: string): CustomBoxPrice => ({ ok: false, problem, message });

/** Margin slab for a quantity: the slab with the highest minQty that the quantity reaches. */
export function slabFor(qty: number, slabs: Slab[]): Slab | undefined {
  return [...slabs].sort((a, b) => b.minQty - a.minQty).find((s) => qty >= s.minQty);
}

/** Box spec (BoxSpec, 9 layers) for a grade with paper prices filled in from the price list; null if a rate is missing. */
export function specForGrade(input: Pick<CustomBoxInput, 'length' | 'width' | 'height'>, grade: Grade, paper: PaperRate[]): BoxSpec | null {
  const perLayer = grade.layers.length > 1;
  const wanted = perLayer ? grade.layers.slice(0, grade.ply) : [grade.layers[0]];
  if (!wanted[0] || (perLayer && wanted.length !== grade.ply)) return null;
  const layers = emptyLayers();
  for (let i = 0; i < wanted.length; i++) {
    const { gsm, bf } = wanted[i];
    const rate = paper.find((p) => p.gsm === gsm && p.bf === bf);
    if (!rate) return null;
    layers[i] = { gsm, bf, price: rate.pricePerKg };
  }
  return { length: input.length, width: input.width, height: input.height, ply: grade.ply, perLayer, layers };
}

/** Price of a custom box at one quantity. */
export function priceCustomBox(input: CustomBoxInput, rules: PriceRules): CustomBoxPrice {
  const { length, width, height } = input;
  const qty = Math.floor(input.qty);
  const colours = Math.max(0, Math.floor(input.colours ?? 0));
  const minSide = rules.limits.minSide ?? 50;
  if (![length, width, height].every((v) => Number.isFinite(v) && v >= minSide)) {
    return fail('bad-size', `Each side must be at least ${minSide} mm.`);
  }
  const grade = rules.grades.find((g) => g.id === input.gradeId);
  if (!grade) return fail('unknown-grade', 'Choose a board grade.');
  if (!Number.isFinite(qty) || qty < rules.limits.minQty) {
    return fail('qty-too-low', `Minimum order is ${rules.limits.minQty} boxes.`);
  }
  if (rules.limits.maxQty && qty > rules.limits.maxQty) {
    return fail('qty-too-high', `For more than ${rules.limits.maxQty} boxes, please ask for a quote.`);
  }
  if (colours > rules.printing.maxColours) {
    return fail('too-many-colours', `Up to ${rules.printing.maxColours} colours can be printed.`);
  }
  const spec = specForGrade(input, grade, rules.paper);
  if (!spec) return fail('no-paper-rate', 'This grade has no paper rate yet, please ask for a quote.');

  const box = calcBox(spec);
  const { maxDeckle, maxCut } = rules.limits; // 0 = no limit set
  if ((maxDeckle > 0 && box.deckleSize > maxDeckle) || (maxCut > 0 && box.cutSize > maxCut)) {
    return fail('too-big', 'This size is larger than our machines take, please ask for a quote.');
  }
  const slab = slabFor(qty, rules.slabs);
  if (!slab) return fail('no-slab', 'No price for this quantity, please ask for a quote.');

  const weightKg = Math.round(box.weight * 100) / 100_000; // grams (2 dp) → kg without float noise
  const convRate = rules.conversionPerKg[String(grade.ply)] ?? 0;
  const conversion = weightKg * convRate;
  const printing = colours > 0 ? colours * rules.printing.perColourPerBox + (colours * rules.printing.plateCharge) / qty : 0;
  const base = box.paperCost + conversion + printing;
  const unitPrice = round2(base * (1 + slab.marginPct / 100));
  return {
    ok: true,
    spec,
    grade,
    box,
    weightKg,
    paper: box.paperCost,
    conversion: round2(conversion),
    printing: round2(printing),
    base: round2(base),
    marginPct: slab.marginPct,
    unitPrice,
    qty,
    amount: round2(unitPrice * qty),
  };
}

/** Price per box at the start of every slab, for the "buy more, pay less" table. */
export function slabTable(input: Omit<CustomBoxInput, 'qty'>, rules: PriceRules): { minQty: number; unitPrice: number }[] {
  return [...rules.slabs]
    .sort((a, b) => a.minQty - b.minQty)
    .map((s) => ({ s, p: priceCustomBox({ ...input, qty: Math.max(s.minQty, rules.limits.minQty) }, rules) }))
    .filter((x): x is { s: Slab; p: Extract<CustomBoxPrice, { ok: true }> } => x.p.ok)
    .map(({ s, p }) => ({ minQty: Math.max(s.minQty, rules.limits.minQty), unitPrice: p.unitPrice }));
}

/* ------------------------------------ delivery ------------------------------------ */

export interface DeliveryZone {
  id?: string;
  name: string;
  pincodeFrom: number;
  pincodeTo: number;
  mode: 'own' | 'courier' | 'pickup';
  ratePerKg: number;
  minCharge: number;
  freeAbove?: number | null;
  days: number;
  active?: boolean;
  sort?: number;
}

/** The zone for a pincode: active zones only, the narrowest matching range wins. */
export function findZone(zones: DeliveryZone[], pincode: string | number): DeliveryZone | undefined {
  const pin = typeof pincode === 'number' ? pincode : Number(String(pincode).replace(/\s/g, ''));
  if (!Number.isInteger(pin) || pin < 100000 || pin > 999999) return undefined;
  return zones
    .filter((z) => z.active !== false && pin >= z.pincodeFrom && pin <= z.pincodeTo)
    .sort((a, b) => a.pincodeTo - a.pincodeFrom - (b.pincodeTo - b.pincodeFrom) || (a.sort ?? 0) - (b.sort ?? 0))[0];
}

/**
 * Delivery charge before GST for an own-vehicle or pickup zone.
 * Returns null for courier zones: those are priced by the courier's rate API at checkout.
 */
export function deliveryCharge(zone: DeliveryZone, weightKg: number, goodsAmount: number): number | null {
  if (zone.mode === 'pickup') return 0;
  if (zone.mode === 'courier') return null;
  if (zone.freeAbove != null && goodsAmount >= zone.freeAbove) return 0;
  return round2(Math.max(zone.minCharge, weightKg * zone.ratePerKg));
}

/* ------------------------------------ checkout ------------------------------------ */

/** Order total for checkout. Delivery is taxed at the goods' rate (composite supply). */
export function checkoutTotals(goodsAmount: number, delivery: number, taxPct: number) {
  const taxable = round2(goodsAmount + delivery);
  const tax = round2((taxable * taxPct) / 100);
  return { goods: round2(goodsAmount), delivery: round2(delivery), taxable, tax, total: round2(taxable + tax) };
}

/** Amount to pay now for a given advance % (100 = full payment upfront). */
export const advanceAmount = (total: number, advancePct: number) => round2((total * Math.min(100, Math.max(0, advancePct))) / 100);

/* ------------------------------------ the whole web price list ------------------------------------ */

/** Everything the owner sets for the website (Supabase: price_rules + delivery_zones). */
export interface WebShop {
  rules: PriceRules;
  zones: DeliveryZone[];
  /** % of the order paid at checkout for custom boxes (100 = full payment upfront). */
  advancePct: number;
  /** Smallest order value (before GST) the website accepts; 0 = none. */
  minOrderValue: number;
  /** Show prices on the website. */
  showPrices: boolean;
}

export const defaultWebShop = (): WebShop => ({
  rules: {
    paper: [],
    conversionPerKg: {},
    printing: { perColourPerBox: 0, plateCharge: 0, maxColours: 4 },
    slabs: [],
    limits: { minQty: 100, maxQty: 0, maxDeckle: 0, maxCut: 0, minSide: 50 },
    grades: [],
  },
  zones: [],
  advancePct: 100,
  minOrderValue: 0,
  showPrices: true,
});

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const PLIES: Ply[] = [3, 5, 7, 9];

/** Reads a stored / downloaded web price list, filling anything missing so older or partial data still loads. */
export function normalizeWebShop(raw: unknown): WebShop {
  const d = defaultWebShop();
  if (!raw || typeof raw !== 'object') return d;
  const w = raw as Partial<WebShop>;
  const r = (w.rules || {}) as Partial<PriceRules>;
  const conv: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.conversionPerKg || {})) if (typeof v === 'number' && Number.isFinite(v)) conv[k] = v;
  return {
    rules: {
      paper: arr<PaperRate>(r.paper).map((p) => ({ gsm: num(p?.gsm), bf: num(p?.bf), pricePerKg: num(p?.pricePerKg) })),
      conversionPerKg: conv,
      printing: { ...d.rules.printing, ...(r.printing || {}) },
      slabs: arr<Slab>(r.slabs).map((x) => ({ minQty: num(x?.minQty), marginPct: num(x?.marginPct) })),
      limits: { ...d.rules.limits, ...(r.limits || {}) },
      grades: arr<Grade>(r.grades)
        .filter((g) => g && typeof g.id === 'string' && PLIES.includes(g.ply))
        .map((g) => ({ id: g.id, label: String(g.label ?? ''), ply: g.ply, layers: arr<Grade['layers'][number]>(g.layers).map((l) => ({ gsm: num(l?.gsm), bf: num(l?.bf) })) })),
    },
    zones: arr<DeliveryZone>(w.zones).filter((z) => z && typeof z === 'object'),
    advancePct: num(w.advancePct, d.advancePct),
    minOrderValue: num(w.minOrderValue, d.minOrderValue),
    showPrices: typeof w.showPrices === 'boolean' ? w.showPrices : d.showPrices,
  };
}

/** What still has to be filled in before the website can show prices (empty list = ready). */
export function setupProblems(rules: PriceRules): string[] {
  const out: string[] = [];
  if (!rules.grades.length) out.push('Add at least one board grade.');
  if (!rules.slabs.length) out.push('Add at least one quantity slab with a margin.');
  else if (!rules.slabs.some((s) => s.minQty <= rules.limits.minQty)) out.push(`No slab starts at or below the minimum order of ${rules.limits.minQty} boxes.`);
  for (const g of rules.grades) {
    const name = g.label || `${g.ply} ply grade`;
    const layers = g.layers.length > 1 ? g.layers.slice(0, g.ply) : g.layers.slice(0, 1);
    if (!layers.length || (g.layers.length > 1 && g.layers.length < g.ply)) {
      out.push(`${name}: paper for every layer is not filled in.`);
      continue;
    }
    for (const l of layers) {
      if (!rules.paper.some((p) => p.gsm === l.gsm && p.bf === l.bf && p.pricePerKg > 0)) {
        out.push(`${name}: no paper rate for ${l.gsm} GSM / ${l.bf} BF.`);
        break;
      }
    }
    if (!(rules.conversionPerKg[String(g.ply)] && rules.conversionPerKg[String(g.ply)]! > 0)) out.push(`${name}: conversion cost for ${g.ply} ply is not set.`);
  }
  return [...new Set(out)];
}

/** Short default label for a grade, e.g. "3 ply · 120 GSM · 18 BF" or "5 ply · mixed paper". */
export function gradeLabel(g: Pick<Grade, 'ply' | 'layers'>): string {
  const ls = g.layers.length > 1 ? g.layers.slice(0, g.ply) : g.layers;
  const same = ls.every((l) => l.gsm === ls[0]?.gsm && l.bf === ls[0]?.bf);
  return same && ls[0] ? `${g.ply} ply · ${ls[0].gsm} GSM · ${ls[0].bf} BF` : `${g.ply} ply · mixed paper`;
}

/* ------------------------------------ standard products (cart) ------------------------------------ */

export interface CartLine {
  productId: string;
  /** Pack size chosen (boxes per pack). */
  packQty: number;
  /** Number of packs. */
  count: number;
}

export interface PricedCartLine {
  product: Product;
  pack: ProductPack;
  count: number;
  boxes: number;
  /** pack price × count, before GST. */
  amount: number;
  /** Board weight of all boxes in this line (kg). */
  weightKg: number;
}

export interface PricedCart {
  lines: PricedCartLine[];
  /** Lines that could not be priced (product gone / switched off, pack removed, not enough stock). */
  problems: { productId: string; message: string }[];
  goods: number;
  weightKg: number;
}

/** kg rounded to whole grams. */
const grams = (kg: number) => Math.round(kg * 1000) / 1000;

/** Prices a cart from the product list (the server runs this again with the products from the database). */
export function priceCart(cart: CartLine[], products: Product[]): PricedCart {
  const lines: PricedCartLine[] = [];
  const problems: PricedCart['problems'] = [];
  for (const c of cart) {
    const count = Math.floor(Number(c.count));
    const product = products.find((p) => p.id === c.productId && p.active);
    if (!product) {
      problems.push({ productId: c.productId, message: 'This box is no longer sold online.' });
      continue;
    }
    const pack = product.packs.find((p) => p.qty === Number(c.packQty) && p.price > 0);
    if (!pack) {
      problems.push({ productId: c.productId, message: `${product.name}: this pack size is no longer available.` });
      continue;
    }
    if (!(count >= 1 && count <= 1000)) {
      problems.push({ productId: c.productId, message: `${product.name}: choose between 1 and 1000 packs.` });
      continue;
    }
    const boxes = pack.qty * count;
    const already = lines.filter((l) => l.product.id === product.id).reduce((n, l) => n + l.boxes, 0);
    if (product.stockQty != null && already + boxes > product.stockQty) {
      problems.push({ productId: c.productId, message: `${product.name}: only ${product.stockQty} boxes in stock.` });
      continue;
    }
    const perBoxKg = Math.round(calcBox(product.spec).weight * 100) / 100_000;
    lines.push({ product, pack, count, boxes, amount: round2(pack.price * count), weightKg: grams(perBoxKg * boxes) });
  }
  return {
    lines,
    problems,
    goods: round2(lines.reduce((n, l) => n + l.amount, 0)),
    weightKg: grams(lines.reduce((n, l) => n + l.weightKg, 0)),
  };
}

/** URL-friendly id for a product, e.g. "3 ply 300×200×150" → "3-ply-300x200x150". */
export const productSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'box';
