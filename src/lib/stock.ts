/**
 * Paper-reel stock. A reel's balance is what came in plus every movement against it (issue, return, waste, adjust).
 * The paper an order needs comes from the box spec on its items: kg per layer grade, and the narrowest reel that can be cut.
 */
import { deckleAllowance, isOpen, layerGrams } from '@honeypackers/box-core/calc';
import type { Order, OrderItem, Reel, StockMove } from './types';

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const gradeKey = (gsm: number, bf: number) => `${gsm}-${bf}`;
export const gradeLabel = (gsm: number, bf: number) => `${bf} BF · ${gsm} GSM`;

/** Kg left on a reel. */
export function reelBalance(reel: Reel, moves: StockMove[]): number {
  let kg = reel.weightIn || 0;
  for (const m of moves) if (m.reelId === reel.id) kg += m.kg;
  return r3(kg);
}

export interface PaperNeed {
  key: string;
  gsm: number;
  bf: number;
  /** Calculated kg for the whole order. */
  kg: number;
  /** Narrowest reel (mm) the biggest-deckle item can be cut from. */
  minWidth: number;
  /** Items that use this grade. */
  items: string[];
}

/** Paper an order needs, grouped by grade (GSM + BF). Items without a box spec are skipped. */
export function paperNeed(items: OrderItem[]): PaperNeed[] {
  const map = new Map<string, PaperNeed>();
  for (const it of items) {
    if (!it.spec || !(it.qty > 0)) continue;
    const deckle = it.spec.width + it.spec.height + deckleAllowance(it.spec.ply);
    for (const l of layerGrams(it.spec)) {
      if (!(l.gsm > 0)) continue;
      const key = gradeKey(l.gsm, l.bf);
      const cur = map.get(key) ?? { key, gsm: l.gsm, bf: l.bf, kg: 0, minWidth: 0, items: [] };
      cur.kg += (l.grams * it.qty) / 1000;
      cur.minWidth = Math.max(cur.minWidth, deckle);
      const name = it.description || 'Item';
      if (!cur.items.includes(name)) cur.items.push(name);
      map.set(key, cur);
    }
  }
  return [...map.values()].map((n) => ({ ...n, kg: r3(n.kg) })).sort((a, b) => b.kg - a.kg);
}

/** Kg already issued to an order for each grade (returns and waste count too). */
export function issuedByGrade(orderId: string, reels: Reel[], moves: StockMove[]): Map<string, number> {
  const byReel = new Map(reels.map((r) => [r.id, r]));
  const out = new Map<string, number>();
  for (const m of moves) {
    if (m.orderId !== orderId) continue;
    const r = byReel.get(m.reelId);
    if (!r) continue;
    const key = gradeKey(r.gsm, r.bf);
    out.set(key, r3((out.get(key) ?? 0) - m.kg));
  }
  return out;
}

export interface ReelChoice {
  reel: Reel;
  balance: number;
  /** Side trim in mm when cut for the order's widest deckle. */
  trim: number;
  /** Higher BF than asked for (stronger, fine to use). */
  higherBf: boolean;
}

/**
 * Reels that can serve a need: same GSM, same or higher BF, wide enough, something left.
 * Best first: the exact BF, then the least side trim, then the part-used reel (so butt-rolls get used up).
 */
export function matchingReels(need: Pick<PaperNeed, 'gsm' | 'bf' | 'minWidth'>, reels: Reel[], moves: StockMove[]): ReelChoice[] {
  return reels
    .filter((r) => r.gsm === need.gsm && r.bf >= need.bf && r.width >= need.minWidth)
    .map((reel) => ({ reel, balance: reelBalance(reel, moves), trim: reel.width - need.minWidth, higherBf: reel.bf > need.bf }))
    .filter((c) => c.balance > 0.001)
    .sort((a, b) => Number(a.higherBf) - Number(b.higherBf) || a.trim - b.trim || a.balance - b.balance);
}

/** Paper the order really uses is the deckle's share of the reel; the rest of the width is side trim. */
const usable = (reelWidth: number, minWidth: number) => (reelWidth > 0 ? Math.min(1, minWidth / reelWidth) : 1);

/** Kg to take off a reel of this width to get `netKg` of usable paper at the given deckle. */
export const reelDraw = (netKg: number, reelWidth: number, minWidth: number) => r3(netKg / usable(reelWidth, minWidth));

/** Usable paper (kg) already issued to an order for a grade: issues less returns, after side trim. Waste and corrections do not count. */
export function issuedNet(orderId: string, need: Pick<PaperNeed, 'gsm' | 'bf' | 'minWidth'>, reels: Reel[], moves: StockMove[]): number {
  const byReel = new Map(reels.map((r) => [r.id, r]));
  let kg = 0;
  for (const m of moves) {
    if (m.orderId !== orderId || (m.kind !== 'issue' && m.kind !== 'return')) continue;
    const r = byReel.get(m.reelId);
    if (r && r.gsm === need.gsm && r.bf === need.bf) kg -= m.kg * usable(r.width, need.minWidth);
  }
  return r3(kg);
}

/** Usable paper (kg) the matching reels in stock could give for a need. */
export const availableNet = (need: PaperNeed, reels: Reel[], moves: StockMove[]) =>
  r3(matchingReels(need, reels, moves).reduce((s, c) => s + c.balance * usable(c.reel.width, need.minWidth), 0));

export interface GradeStock {
  key: string;
  gsm: number;
  bf: number;
  kg: number;
  value: number;
  reels: { reel: Reel; balance: number }[];
}

/** Stock grouped by grade; empty reels are left out unless `includeEmpty`. */
export function stockByGrade(reels: Reel[], moves: StockMove[], includeEmpty = false): GradeStock[] {
  const map = new Map<string, GradeStock>();
  for (const reel of reels) {
    const balance = reelBalance(reel, moves);
    if (!includeEmpty && balance <= 0.001) continue;
    const key = gradeKey(reel.gsm, reel.bf);
    const g = map.get(key) ?? { key, gsm: reel.gsm, bf: reel.bf, kg: 0, value: 0, reels: [] };
    g.kg = r3(g.kg + balance);
    g.value += balance * (reel.rate || 0);
    g.reels.push({ reel, balance });
    map.set(key, g);
  }
  for (const g of map.values()) g.reels.sort((a, b) => a.reel.width - b.reel.width || a.balance - b.balance);
  return [...map.values()].sort((a, b) => a.gsm - b.gsm || a.bf - b.bf);
}

export function gradeFromKey(key: string): { gsm: number; bf: number } {
  const [gsm, bf] = key.split('-').map(Number);
  return { gsm: gsm || 0, bf: bf || 0 };
}

export interface Allocation {
  /** Take-offs to record: negative kg per reel, one grade after another. */
  moves: { reelId: string; kg: number }[];
  /** Grades that could be issued in full. */
  issued: PaperNeed[];
  /** Grades that could not: what is still missing and what is in stock. */
  short: { need: PaperNeed; missing: number; available: number }[];
  /** Kg taken off reels in total (includes side trim). */
  drawKg: number;
}

/**
 * Works out how to issue the paper an order still needs, grade by grade, from the best-fitting reels.
 * A grade is issued only when the stock can cover all of it; otherwise it is reported as short and nothing is taken for it.
 * Safe to run again: it only plans what is still missing after earlier issues.
 */
export function planAllocation(order: Pick<Order, 'id' | 'items'>, reels: Reel[], moves: StockMove[], wastePct: number): Allocation {
  const out: Allocation = { moves: [], issued: [], short: [], drawKg: 0 };
  const extra = 1 + (wastePct || 0) / 100;
  let local = moves;
  for (const need of paperNeed(order.items)) {
    const plan = Math.round(need.kg * extra * 10) / 10;
    let remaining = r3(plan - issuedNet(order.id, need, reels, local));
    if (remaining <= 0.05) continue;
    const choices = matchingReels(need, reels, local);
    const available = r3(choices.reduce((s, c) => s + c.balance * usable(c.reel.width, need.minWidth), 0));
    if (available < remaining - 0.05) {
      out.short.push({ need, missing: r3(remaining - available), available });
      continue;
    }
    const taken: StockMove[] = [];
    for (const c of choices) {
      if (remaining <= 0.001) break;
      const net = Math.min(remaining, c.balance * usable(c.reel.width, need.minWidth));
      const draw = Math.min(c.balance, reelDraw(net, c.reel.width, need.minWidth));
      out.moves.push({ reelId: c.reel.id, kg: -draw });
      out.drawKg += draw;
      taken.push({ id: '', reelId: c.reel.id, date: '', kind: 'issue', kg: -draw, orderId: order.id, note: '' });
      remaining = r3(remaining - net);
    }
    local = [...taken, ...local];
    out.issued.push(need);
  }
  out.drawKg = r3(out.drawKg);
  return out;
}

export interface StockAlerts {
  /** Grades under their reorder level. */
  low: { key: string; gsm: number; bf: number; kg: number; min: number }[];
  /** Grades the open orders still need more of than is in stock. */
  short: { key: string; gsm: number; bf: number; missing: number; available: number }[];
}

export function stockAlerts(reels: Reel[], moves: StockMove[], orders: Order[], minLevels: Record<string, number>, wastePct: number): StockAlerts {
  const have = new Map(stockByGrade(reels, moves).map((g) => [g.key, g.kg]));
  const low = Object.entries(minLevels || {})
    .filter(([, min]) => min > 0)
    .map(([key, min]) => ({ key, ...gradeFromKey(key), kg: have.get(key) ?? 0, min }))
    .filter((x) => x.kg < x.min)
    .sort((a, b) => a.gsm - b.gsm || a.bf - b.bf);

  const extra = 1 + (wastePct || 0) / 100;
  const total = new Map<string, PaperNeed>();
  for (const o of orders) {
    if (!isOpen(o)) continue;
    for (const n of paperNeed(o.items)) {
      const left = Math.round(n.kg * extra * 10) / 10 - issuedNet(o.id, n, reels, moves);
      if (left <= 0.05) continue;
      const cur = total.get(n.key);
      total.set(n.key, cur ? { ...cur, kg: cur.kg + left, minWidth: Math.max(cur.minWidth, n.minWidth) } : { ...n, kg: left });
    }
  }
  const short = [...total.values()]
    .map((n) => ({ n, available: availableNet(n, reels, moves) }))
    .filter(({ n, available }) => available < n.kg - 0.05)
    .map(({ n, available }) => ({ key: n.key, gsm: n.gsm, bf: n.bf, missing: r3(n.kg - available), available }));
  return { low, short };
}

/** One-line result of an automatic issue, for a toast. Empty when there was nothing to do. */
export function allocationMessage(a: Allocation, lowAfter: StockAlerts['low'] = []): string {
  const parts: string[] = [];
  if (a.issued.length) parts.push(`Issued ${num1(a.drawKg)} kg of paper from the reels`);
  for (const s of a.short) parts.push(`Not enough ${gradeLabel(s.need.gsm, s.need.bf)} in stock: need ${num1(s.missing)} kg more${s.available > 0 ? ` (${num1(s.available)} kg available)` : ''}. Nothing issued for it`);
  if (lowAfter.length) parts.push(`Low stock: ${lowAfter.map((l) => `${gradeLabel(l.gsm, l.bf)} ${num1(l.kg)} kg`).join(', ')}`);
  return parts.join('. ');
}
const num1 = (n: number) => String(Math.round(n * 10) / 10);

export interface SizeStock {
  width: number;
  /** In the list of common sizes (shown even when empty). */
  common: boolean;
  /** Kg in stock. */
  kg: number;
  /** Kg ever bought at this width (all reels, used up or not). */
  purchased: number;
  value: number;
  reels: { reel: Reel; balance: number }[];
}

/** Stock grouped by reel width: every common size, plus any other width that has reels. Used-up reels only when `includeEmpty`. */
export function stockByWidth(reels: Reel[], moves: StockMove[], common: number[], includeEmpty = false): SizeStock[] {
  const map = new Map<number, SizeStock>();
  const get = (width: number, isCommon: boolean) => {
    const g = map.get(width) ?? { width, common: isCommon, kg: 0, purchased: 0, value: 0, reels: [] };
    map.set(width, g);
    return g;
  };
  for (const w of common) get(w, true);
  for (const reel of reels) {
    const g = get(reel.width, map.get(reel.width)?.common ?? false);
    const balance = reelBalance(reel, moves);
    g.purchased = r3(g.purchased + (reel.weightIn || 0));
    if (!includeEmpty && balance <= 0.001) continue;
    g.kg = r3(g.kg + balance);
    g.value += balance * (reel.rate || 0);
    g.reels.push({ reel, balance });
  }
  for (const g of map.values()) g.reels.sort((a, b) => a.reel.gsm - b.reel.gsm || a.reel.bf - b.reel.bf || a.balance - b.balance);
  return [...map.values()].filter((g) => g.common || g.reels.length > 0).sort((a, b) => a.width - b.width);
}

/** The narrowest common size that can be cut for a deckle, if any. */
export const nearestWidth = (common: number[], minWidth: number): number | undefined => [...common].sort((a, b) => a - b).find((w) => w >= minWidth);

/** 'R-009' → 'R-010', 'A12' → 'A13', 'xyz' → 'xyz-2'. For numbering a batch of reels. */
export function incrementNumber(n: string): string {
  const m = n.match(/^(.*?)(\d+)$/);
  if (!m) return `${n}-2`;
  return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0');
}
