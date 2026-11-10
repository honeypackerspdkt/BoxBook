import { describe, expect, it } from 'vitest';
import { boxStockLevel, boxStockList, boxStockSummary } from './box-stock';

const p = (name: string, stockQty: number | null, stockMin: number | null = null) => ({ name, stockQty, stockMin, active: true });

describe('box stock', () => {
  it('levels', () => {
    expect(boxStockLevel(p('a', null))).toBe('untracked');
    expect(boxStockLevel(p('a', 0))).toBe('out');
    expect(boxStockLevel(p('a', 40, 50))).toBe('low');
    expect(boxStockLevel(p('a', 50, 50))).toBe('low');
    expect(boxStockLevel(p('a', 51, 50))).toBe('ok');
    expect(boxStockLevel(p('a', 5))).toBe('ok');
  });
  it('lists out and low first, made to order apart', () => {
    const { tracked, untracked } = boxStockList([p('Zed', 100), p('Mid', 10, 20), p('Made', null), p('Gone', 0)]);
    expect(tracked.map((x) => x.name)).toEqual(['Gone', 'Mid', 'Zed']);
    expect(untracked.map((x) => x.name)).toEqual(['Made']);
  });
  it('summarises for the More screen', () => {
    expect(boxStockSummary([p('a', null)])).toBe('Keep ready-made boxes for online orders');
    expect(boxStockSummary([p('a', 1200), p('b', 300)])).toBe('1,500 boxes in stock');
    expect(boxStockSummary([p('a', 0), p('b', 10, 20), p('c', 5, 20)])).toBe('2 low · 1 out');
  });
});

import { boxFillPct, boxStockByPly, boxStockTotals, perBoxPrice } from './box-stock';

describe('box stock tiles and totals', () => {
  const packs = [{ qty: 200, price: 1160 }, { qty: 50, price: 290 }];
  it('values stock at the smallest pack price per box', () => {
    expect(perBoxPrice({ packs })).toBeCloseTo(5.8);
    expect(perBoxPrice({ packs: [] })).toBe(0);
    expect(boxStockTotals([{ stockQty: 100, packs }, { stockQty: null, packs }, { stockQty: -3, packs }])).toEqual({ boxes: 100, kept: 2, value: 580 });
  });
  it('fills the bar against twice the alert level, else the fullest box', () => {
    expect(boxFillPct({ stockQty: 50, stockMin: 50 }, 999)).toBe(50);
    expect(boxFillPct({ stockQty: 300, stockMin: 50 }, 999)).toBe(100);
    expect(boxFillPct({ stockQty: 25, stockMin: null }, 100)).toBe(25);
    expect(boxFillPct({ stockQty: 0, stockMin: null }, 0)).toBe(0);
  });
  it('groups kept boxes by ply', () => {
    const g = boxStockByPly([
      { name: 'b', ply: 5, stockQty: 10, stockMin: null, active: true },
      { name: 'a', ply: 3, stockQty: 40, stockMin: null, active: true },
      { name: 'c', ply: 3, stockQty: 0, stockMin: null, active: true },
      { name: 'd', ply: 3, stockQty: null, stockMin: null, active: true },
    ] as never[]);
    expect(g.map((x) => [x.ply, x.items.map((i: { name: string }) => i.name), x.boxes, x.max])).toEqual([
      [3, ['c', 'a'], 40, 40],
      [5, ['b'], 10, 10],
    ]);
  });
});
