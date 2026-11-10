import type { Product } from './types';

/** Pure helpers for the Box stock screen (ready-made boxes of the website's standard products). */
export type BoxStockLevel = 'out' | 'low' | 'ok' | 'untracked';

export function boxStockLevel(p: Pick<Product, 'stockQty' | 'stockMin'>): BoxStockLevel {
  if (p.stockQty == null) return 'untracked';
  if (p.stockQty <= 0) return 'out';
  if (p.stockMin != null && p.stockQty <= p.stockMin) return 'low';
  return 'ok';
}

/** Tracked products first (out, low, then the rest by name), then the made-to-order ones. */
export function boxStockList<T extends Pick<Product, 'name' | 'stockQty' | 'stockMin' | 'active'>>(products: T[]): { tracked: T[]; untracked: T[] } {
  const rank: Record<BoxStockLevel, number> = { out: 0, low: 1, ok: 2, untracked: 3 };
  const tracked = products.filter((p) => p.stockQty != null).sort((a, b) => rank[boxStockLevel(a)] - rank[boxStockLevel(b)] || a.name.localeCompare(b.name));
  const untracked = products.filter((p) => p.stockQty == null).sort((a, b) => a.name.localeCompare(b.name));
  return { tracked, untracked };
}

/** "3 low · 1 out" for the More screen, or the boxes on hand. */
export function boxStockSummary(products: Pick<Product, 'stockQty' | 'stockMin'>[]): string {
  const tracked = products.filter((p) => p.stockQty != null);
  if (!tracked.length) return 'Keep ready-made boxes for online orders';
  const out = tracked.filter((p) => boxStockLevel(p) === 'out').length;
  const low = tracked.filter((p) => boxStockLevel(p) === 'low').length;
  const total = tracked.reduce((n, p) => n + Math.max(0, p.stockQty || 0), 0);
  const warn = [low && `${low} low`, out && `${out} out`].filter(Boolean).join(' · ');
  return warn || `${total.toLocaleString('en-IN')} boxes in stock`;
}

export const KIND_LABEL = { made: 'Made', sold: 'Website order', returned: 'Order cancelled', correction: 'Correction' } as const;

/** Per-box price of the smallest pack (before GST), to value the stock. */
export const perBoxPrice = (p: Pick<Product, 'packs'>): number => {
  const k = [...(p.packs || [])].filter((x) => x.qty > 0 && x.price > 0).sort((a, b) => a.qty - b.qty)[0];
  return k ? k.price / k.qty : 0;
};

/** Totals for the summary cards: boxes on hand, box types kept in stock, value at website price. */
export function boxStockTotals(products: Pick<Product, 'stockQty' | 'packs'>[]) {
  const kept = products.filter((p) => p.stockQty != null);
  const boxes = kept.reduce((n, p) => n + Math.max(0, p.stockQty || 0), 0);
  const value = kept.reduce((n, p) => n + Math.max(0, p.stockQty || 0) * perBoxPrice(p), 0);
  return { boxes, kept: kept.length, value: Math.round(value) };
}

/** How full the level bar is: against twice the alert level, else against the fullest box of the group. */
export function boxFillPct(p: Pick<Product, 'stockQty' | 'stockMin'>, groupMax: number): number {
  const q = Math.max(0, p.stockQty || 0);
  const full = p.stockMin != null && p.stockMin > 0 ? p.stockMin * 2 : groupMax;
  return full > 0 ? Math.min(100, Math.round((q / full) * 100)) : 0;
}

/** Kept-in-stock products by ply (3, 5, 7 …), each group out/low first. */
export function boxStockByPly<T extends Pick<Product, 'name' | 'ply' | 'stockQty' | 'stockMin' | 'active'>>(products: T[]) {
  const { tracked } = boxStockList(products);
  const plies = [...new Set(tracked.map((p) => p.ply))].sort((a, b) => a - b);
  return plies.map((ply) => {
    const items = tracked.filter((p) => p.ply === ply);
    return { ply, items, boxes: items.reduce((n, p) => n + Math.max(0, p.stockQty || 0), 0), max: Math.max(0, ...items.map((p) => p.stockQty || 0)) };
  });
}
