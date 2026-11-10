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
