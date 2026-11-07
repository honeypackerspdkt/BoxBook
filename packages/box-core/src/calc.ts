import type { BoxResult, BoxSpec, Order, PaperLayer, Ply, Pricing } from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Flute take-up factor applied to fluting layers (same as the original eBox app). */
export const FLUTE_FACTOR = 1.4;

/** Extra deckle allowance by ply. */
export function deckleAllowance(ply: Ply): number {
  if (ply === 7) return 30;
  if (ply === 9) return 50;
  return 20;
}

/** Human name of a layer (0-based index) in a box of the given ply. */
export function layerName(index: number, ply: Ply): string {
  if (index === 0) return 'Top liner';
  if (index === ply - 1) return 'Bottom liner';
  if (index % 2 === 1) return `Flute ${(index + 1) / 2}`;
  return `Middle liner ${index / 2}`;
}

export const isFlute = (index: number) => index % 2 === 1;

export function emptyLayers(): PaperLayer[] {
  return Array.from({ length: 9 }, () => ({ gsm: 0, bf: 0, price: 0 }));
}

export function effectiveLayers(spec: BoxSpec): PaperLayer[] {
  const n = spec.ply;
  if (!spec.perLayer) return Array.from({ length: n }, () => ({ ...spec.layers[0] }));
  return spec.layers.slice(0, n);
}

/**
 * Corrugated box calculation.
 * - Cut size  = 2L + 2W + 50 mm (split into 2 sheets of L + W + 50 when ≥ 1600 mm)
 * - Deckle    = W + H + allowance (20 / 30 / 50 mm)
 * - Weight    = board area × GSM, flutes × 1.4 take-up
 * - BS        = Σ GSM × BF / 1000 (flutes count half)
 * - Paper cost= Σ layer weight (kg) × price per kg
 */
export function calcBox(spec: BoxSpec): BoxResult {
  const L = Math.max(0, spec.length || 0);
  const W = Math.max(0, spec.width || 0);
  const H = Math.max(0, spec.height || 0);

  let cutSize = 2 * L + 2 * W + 50;
  let totalLength = cutSize;
  let sheets = 1;
  if (cutSize >= 1600) {
    cutSize = L + W + 50;
    totalLength = cutSize * 2;
    sheets = 2;
  }
  const deckleSize = W + H + deckleAllowance(spec.ply);
  const area = totalLength * deckleSize; // mm²

  let weight = 0;
  let cost = 0;
  let bs = 0;
  effectiveLayers(spec).forEach((layer, i) => {
    const factor = isFlute(i) ? FLUTE_FACTOR : 1;
    const g = (area * (layer.gsm || 0) * factor) / 1_000_000; // grams
    weight += g;
    cost += (g / 1000) * (layer.price || 0);
    bs += ((layer.gsm || 0) * (layer.bf || 0) * (isFlute(i) ? 0.5 : 1)) / 1000;
  });

  return {
    cutSize,
    deckleSize,
    sheets,
    weight: round2(weight),
    bs: round2(bs),
    paperCost: round2(cost),
  };
}

export interface Estimate {
  paperCost: number;
  overhead: number;
  unitCost: number;
  unitPrice: number;
  profitPerBox: number;
  qty: number;
  totalCost: number;
  total: number;
  profit: number;
  tax: number;
  totalWithTax: number;
}

export function estimate(paperCost: number, pricing: Pricing, qty: number): Estimate {
  const overhead = pricing.overhead || 0;
  const unitCost = paperCost + overhead;
  const unitPrice = unitCost * (1 + (pricing.profitPct || 0) / 100);
  const q = Math.max(0, qty || 0);
  const totalCost = unitCost * q;
  const total = unitPrice * q;
  const tax = total * ((pricing.taxPct || 0) / 100);
  return {
    paperCost,
    overhead,
    unitCost,
    unitPrice,
    profitPerBox: unitPrice - unitCost,
    qty: q,
    totalCost,
    total,
    profit: total - totalCost,
    tax,
    totalWithTax: total + tax,
  };
}

export function orderTotals(o: Order) {
  const subtotal = o.items.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0), 0);
  const afterDiscount = Math.max(0, subtotal - (o.discount || 0));
  const tax = afterDiscount * ((o.taxPct || 0) / 100);
  const total = afterDiscount + tax;
  const paid = o.payments.reduce((s, p) => s + (p.amount || 0), 0);
  const balance = o.status === 'cancelled' ? 0 : total - paid;
  return { subtotal, afterDiscount, tax, total, paid, balance };
}

export function specLabel(s: BoxSpec): string {
  return `${s.length}×${s.width}×${s.height} mm · ${s.ply}-ply`;
}

/** Orders that are confirmed but not yet delivered. */
export const isOpen = (o: Order) => o.status === 'confirmed' || o.status === 'production' || o.status === 'ready';
