import { calcBox, emptyLayers } from './calc';
import type { BoxResult, BoxSpec, Ply } from './types';

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
  if (box.deckleSize > rules.limits.maxDeckle || box.cutSize > rules.limits.maxCut) {
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
