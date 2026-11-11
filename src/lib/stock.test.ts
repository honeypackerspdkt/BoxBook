// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { calcBox, layerGrams } from '@honeypackers/box-core/calc';
import { allocationMessage, availableNet, incrementNumber, issuedByGrade, issuedNet, matchingReels, nearestWidth, paperNeed, planAllocation, reelBalance, reelDraw, stockAlerts, stockByGrade, stockByWidth } from './stock';
import { emptyData, normalize } from './storage';
import type { BoxSpec, Order, OrderItem, Reel, StockMove } from './types';

const spec = (over: Partial<BoxSpec> = {}): BoxSpec => ({
  length: 300,
  width: 200,
  height: 150,
  ply: 3,
  perLayer: true,
  layers: [
    { gsm: 150, bf: 18, price: 42 },
    { gsm: 120, bf: 16, price: 36 },
    { gsm: 150, bf: 18, price: 42 },
    ...Array.from({ length: 6 }, () => ({ gsm: 0, bf: 0, price: 0 })),
  ],
  ...over,
});
const item = (qty: number, s = spec(), description = 'Box'): OrderItem => ({ id: 'i' + qty, description, qty, rate: 10, spec: s });
const reel = (id: string, gsm: number, bf: number, width: number, kg: number): Reel => ({ id, number: id, gsm, bf, width, supplier: '', receivedAt: '2026-11-01', weightIn: kg, rate: 40, note: '', createdAt: '', updatedAt: '' });
const move = (reelId: string, kg: number, orderId?: string): StockMove => ({ id: reelId + kg, reelId, date: '', kind: kg < 0 ? 'issue' : 'return', kg, orderId, note: '' });

describe('paper per layer', () => {
  it('adds up to the box weight', () => {
    const s = spec();
    expect(layerGrams(s).reduce((t, l) => t + l.grams, 0)).toBeCloseTo(calcBox(s).weight, 1);
  });
  it('gives the hand-worked figures for 300×200×150, 3-ply (area 1050 × 370 mm)', () => {
    const [top, flute, bottom] = layerGrams(spec());
    expect(top.grams).toBeCloseTo(58.275, 3);
    expect(flute.grams).toBeCloseTo(65.268, 3); // 120 GSM × 1.4 take-up
    expect(bottom.grams).toBeCloseTo(58.275, 3);
  });
});

describe('paper an order needs', () => {
  it('groups layers of the same grade and scales by quantity', () => {
    const need = paperNeed([item(1000)]);
    expect(need).toHaveLength(2);
    expect(need[0]).toMatchObject({ gsm: 150, bf: 18, kg: 116.55, minWidth: 370 }); // two liners
    expect(need[1]).toMatchObject({ gsm: 120, bf: 16, kg: 65.268 });
  });
  it('counts boxes on website pack lines (qty = packs × boxes per pack)', () => {
    // 2 packs of 500 = 1000 boxes: the same paper as a 1000-box line
    expect(paperNeed([{ ...item(2), packQty: 500 }])).toEqual(paperNeed([item(1000)]).map((n) => ({ ...n })));
  });
  it('adds several items and keeps the widest deckle', () => {
    const wide = spec({ width: 300 }); // deckle 470
    const need = paperNeed([item(1000, spec(), 'A'), item(500, wide, 'B')]);
    const liner = need.find((n) => n.gsm === 150)!;
    expect(liner.minWidth).toBe(470);
    expect(liner.items).toEqual(['A', 'B']);
    expect(liner.kg).toBeGreaterThan(116.55);
  });
  it('skips items without a box spec or quantity', () => {
    expect(paperNeed([{ id: 'x', description: 'Tape', qty: 5, rate: 1 }, item(0)])).toEqual([]);
  });
});

describe('reel balance and matching', () => {
  const reels = [reel('a', 150, 18, 400, 200), reel('b', 150, 18, 380, 50), reel('c', 150, 18, 350, 300), reel('d', 150, 20, 372, 100), reel('e', 120, 16, 400, 80), reel('f', 150, 18, 390, 0)];
  const need = { gsm: 150, bf: 18, minWidth: 370 };

  it('balance = received + movements', () => {
    expect(reelBalance(reels[0], [move('a', -60.5, 'o1'), move('a', 10), move('b', -5)])).toBe(149.5);
  });
  it('offers only wide-enough, same-GSM reels with paper left, least trim first, higher BF last', () => {
    const got = matchingReels(need, reels, []).map((c) => c.reel.id);
    expect(got).toEqual(['b', 'a', 'd']); // c too narrow, e other GSM, f empty; d has higher BF
  });
  it('an emptied reel drops out', () => {
    expect(matchingReels(need, reels, [move('b', -50, 'o1')]).map((c) => c.reel.id)).toEqual(['a', 'd']);
  });
  it('counts issued paper per grade for one order, net of returns', () => {
    const moves = [move('a', -100, 'o1'), move('a', 20, 'o1'), move('e', -30, 'o1'), move('a', -999, 'o2')];
    const m = issuedByGrade('o1', reels, moves);
    expect(m.get('150-18')).toBe(80);
    expect(m.get('120-16')).toBe(30);
  });
  it('totals stock by grade', () => {
    const g = stockByGrade(reels, []);
    const g150 = g.find((x) => x.key === '150-18')!;
    expect(g150.kg).toBe(550);
    expect(g150.value).toBe(550 * 40);
    expect(g150.reels.map((r) => r.reel.width)).toEqual([350, 380, 400]);
    expect(g.some((x) => x.reels.some((r) => r.reel.id === 'f'))).toBe(false);
  });
});

describe('side trim', () => {
  const reels = [reel('a', 150, 18, 400, 200), reel('b', 150, 18, 370, 100)];
  const need = { gsm: 150, bf: 18, minWidth: 370 };
  it('takes more off a wider reel for the same usable paper', () => {
    expect(reelDraw(92.5, 400, 370)).toBe(100);
    expect(reelDraw(50, 370, 370)).toBe(50);
    expect(reelDraw(50, 300, 370)).toBe(50); // never less than asked
  });
  it('counts only the usable share of what was issued, and ignores waste', () => {
    const moves: StockMove[] = [move('a', -100, 'o1'), move('b', -20, 'o1'), { ...move('a', -5, 'o1'), kind: 'waste' }, move('a', -40, 'o2')];
    expect(issuedNet('o1', need, reels, moves)).toBe(112.5); // 100×370/400 + 20
  });
  it('adds up the usable paper left in matching reels', () => {
    expect(availableNet({ ...need, key: '', kg: 0, items: [] }, reels, [])).toBe(285); // 200×0.925 + 100
  });
});

const order = (status: Order['status'] = 'confirmed', qty = 1000, id = 'o1'): Order => ({
  id, number: 'ORD-1', customerId: 'c', date: '2026-11-10', dueDate: '', status, items: [item(qty)], discount: 0, taxPct: 0, payments: [], notes: '', createdAt: '', updatedAt: '',
});
const asMoves = (a: { moves: { reelId: string; kg: number }[] }, orderId = 'o1'): StockMove[] => a.moves.map((m, i) => ({ id: 'm' + i, reelId: m.reelId, date: '', kind: 'issue', kg: m.kg, orderId, note: '' }));

describe('automatic issue', () => {
  const reels = [reel('a', 150, 18, 400, 200), reel('b', 150, 18, 370, 100), reel('e', 120, 16, 380, 150)];

  it('issues every grade from the best reels when stock covers it', () => {
    const a = planAllocation(order(), reels, [], 5);
    expect(a.short).toEqual([]);
    expect(a.issued.map((n) => n.key)).toEqual(['150-18', '120-16']);
    // 122.4 kg usable liner: all 100 kg of the 370 reel (no trim) then 22.4 usable from the 400 reel (÷ 0.925)
    expect(a.moves[0]).toEqual({ reelId: 'b', kg: -100 });
    expect(a.moves[1].reelId).toBe('a');
    expect(-a.moves[1].kg).toBeCloseTo(22.4 / 0.925, 2);
    expect(a.moves[2].reelId).toBe('e');
    expect(-a.moves[2].kg).toBeCloseTo(68.5 / (370 / 380), 2);
  });

  it('is safe to run again: nothing more is issued', () => {
    const first = planAllocation(order(), reels, [], 5);
    const second = planAllocation(order(), reels, asMoves(first), 5);
    expect(second.moves).toEqual([]);
    expect(second.short).toEqual([]);
  });

  it('tops up when the quantity is raised later', () => {
    const first = planAllocation(order('confirmed', 1000), reels, [], 5);
    const more = planAllocation(order('confirmed', 1200), reels, asMoves(first), 5);
    expect(more.moves.length).toBeGreaterThan(0);
  });

  it('issues nothing for a grade that stock cannot cover, but does for the others', () => {
    const small = [reel('b', 150, 18, 370, 60), reel('e', 120, 16, 380, 150)];
    const a = planAllocation(order(), small, [], 5);
    expect(a.short).toHaveLength(1);
    expect(a.short[0]).toMatchObject({ available: 60 });
    expect(a.short[0].missing).toBeCloseTo(62.4, 1);
    expect(a.moves.every((m) => m.reelId === 'e')).toBe(true);
    const msg = allocationMessage(a);
    expect(msg).toContain('Issued');
    expect(msg).toContain('Not enough 18 BF · 150 GSM in stock: need 62.4 kg more (60 kg available)');
  });

  it('reports everything short when there are no reels', () => {
    const a = planAllocation(order(), [], [], 5);
    expect(a.moves).toEqual([]);
    expect(a.short).toHaveLength(2);
    expect(allocationMessage(a)).not.toContain('Issued');
  });

  it('never takes more than a reel holds', () => {
    const a = planAllocation(order(), [reel('a', 150, 18, 400, 200), reel('b', 150, 18, 370, 100), reel('e', 120, 16, 380, 150)], [], 5);
    const used = new Map<string, number>();
    for (const m of a.moves) used.set(m.reelId, (used.get(m.reelId) ?? 0) - m.kg);
    for (const [id, kg] of used) expect(kg).toBeLessThanOrEqual(reels.find((r) => r.id === id)!.weightIn + 1e-9);
  });
});

describe('stock alerts', () => {
  const reels = [reel('a', 150, 18, 400, 200), reel('b', 150, 18, 370, 100)];
  it('flags a grade under its reorder level, including grades with no reels left', () => {
    const al = stockAlerts(reels, [], [], { '150-18': 400, '120-16': 50, '90-12': 0 }, 5);
    expect(al.low.map((l) => [l.key, l.kg, l.min])).toEqual([
      ['120-16', 0, 50],
      ['150-18', 300, 400],
    ]);
  });
  it('is quiet when stock is above the level', () => {
    expect(stockAlerts(reels, [], [], { '150-18': 250 }, 5).low).toEqual([]);
  });
  it('flags grades the open orders still need more of than is in stock', () => {
    const al = stockAlerts(reels, [], [order()], {}, 5);
    expect(al.short.map((s) => s.key)).toEqual(['120-16']); // no 120 GSM reel at all
    expect(al.short[0].missing).toBeCloseTo(68.5, 1);
  });
  it('ignores quotes and paper already issued', () => {
    expect(stockAlerts([], [], [order('quote')], {}, 5).short).toEqual([]);
    const full = [reel('a', 150, 18, 400, 200), reel('b', 150, 18, 370, 100), reel('e', 120, 16, 380, 150)];
    const issued = asMoves(planAllocation(order(), full, [], 5));
    expect(stockAlerts(full, issued, [order()], {}, 5).short).toEqual([]);
  });
});

describe('common reel sizes', () => {
  const reels = [reel('a', 150, 18, 1200, 200), reel('b', 120, 16, 1200, 100), reel('c', 150, 18, 1000, 80), reel('d', 150, 18, 950, 60), reel('e', 150, 18, 1200, 0)];
  const moves = [move('a', -50, 'o1')];

  it('groups by width: common sizes first-class, other widths that have reels, empty common sizes kept', () => {
    const g = stockByWidth(reels, moves, [1200, 1000, 1100]);
    expect(g.map((x) => [x.width, x.common])).toEqual([[950, false], [1000, true], [1100, true], [1200, true]]);
    const w1200 = g.find((x) => x.width === 1200)!;
    expect(w1200.kg).toBe(250); // 200-50 + 100, used-up reel left out
    expect(w1200.reels).toHaveLength(2);
    expect(g.find((x) => x.width === 1100)!.kg).toBe(0);
  });
  it('counts what was bought at a size, including reels already used up', () => {
    const w1200 = stockByWidth(reels, moves, [1200]).find((x) => x.width === 1200)!;
    expect(w1200.purchased).toBe(300); // 200 + 100 + 0
  });
  it('can include used-up reels', () => {
    expect(stockByWidth(reels, moves, [1200], true).find((x) => x.width === 1200)!.reels).toHaveLength(3);
  });
  it('finds the narrowest common size that fits', () => {
    expect(nearestWidth([1200, 1000, 1100], 1050)).toBe(1100);
    expect(nearestWidth([1200, 1000], 1300)).toBeUndefined();
    expect(nearestWidth([], 370)).toBeUndefined();
  });
  it('numbers a batch of reels', () => {
    expect(incrementNumber('R-009')).toBe('R-010');
    expect(incrementNumber('A12')).toBe('A13');
    expect(incrementNumber('99')).toBe('100');
    expect(incrementNumber('xyz')).toBe('xyz-2');
  });
});

describe('older backups', () => {
  it('load with no reels', () => {
    const d = emptyData() as unknown as Record<string, unknown>;
    delete d.reels;
    delete d.stockMoves;
    const n = normalize(d);
    expect(n.reels).toEqual([]);
    expect(n.stockMoves).toEqual([]);
    expect(n.settings.stockWastePct).toBe(5);
    expect(n.settings.autoIssue).toBe(true);
    expect(n.settings.stockMin).toEqual({});
    expect(n.settings.reelWidths).toEqual([]);
  });
  it('keep reels and movements', () => {
    const d = emptyData();
    d.reels = [reel('a', 150, 18, 400, 200)];
    d.stockMoves = [move('a', -10, 'o1')];
    const n = normalize(JSON.parse(JSON.stringify(d)));
    expect(n.reels).toHaveLength(1);
    expect(n.stockMoves[0].kg).toBe(-10);
  });
});
