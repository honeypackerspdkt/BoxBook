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
