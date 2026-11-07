import { describe, expect, it } from 'vitest';
import { advanceAmount, checkoutTotals, defaultWebShop, deliveryCharge, findZone, gradeLabel, normalizeWebShop, priceCart, priceCustomBox, productSlug, setupProblems, slabFor, slabTable, specForGrade, type DeliveryZone, type PriceRules } from './pricing';

const rules: PriceRules = {
  paper: [
    { gsm: 120, bf: 18, pricePerKg: 42 },
    { gsm: 150, bf: 20, pricePerKg: 46 },
  ],
  conversionPerKg: { 3: 12, 5: 14 },
  printing: { perColourPerBox: 0.6, plateCharge: 1500, maxColours: 4 },
  slabs: [
    { minQty: 100, marginPct: 30 },
    { minQty: 500, marginPct: 22 },
    { minQty: 2000, marginPct: 15 },
  ],
  limits: { minQty: 100, maxQty: 50000, maxDeckle: 1800, maxCut: 1600 },
  grades: [
    { id: '3-120-18', label: '3 ply · 120 GSM · 18 BF', ply: 3, layers: [{ gsm: 120, bf: 18 }] },
    {
      id: '5-mixed',
      label: '5 ply · 150/120',
      ply: 5,
      layers: [
        { gsm: 150, bf: 20 },
        { gsm: 120, bf: 18 },
        { gsm: 120, bf: 18 },
        { gsm: 120, bf: 18 },
        { gsm: 150, bf: 20 },
      ],
    },
    { id: 'no-rate', label: 'missing', ply: 3, layers: [{ gsm: 180, bf: 22 }] },
  ],
};

const box = { length: 300, width: 200, height: 150 };

describe('priceCustomBox', () => {
  it('prices a plain 3 ply box (worked by hand)', () => {
    // cut 2·300+2·200+50 = 1050, deckle 200+150+20 = 370, area 388 500 mm²
    // board 46.62 + 65.268 (flute ×1.4) + 46.62 = 158.508 g → paper 0.158508 kg × ₹42 = ₹6.66
    // conversion 0.15851 kg × ₹12 = ₹1.90212; base ₹8.56212; slab 100+ = 30% → ₹11.13
    const p = priceCustomBox({ ...box, gradeId: '3-120-18', qty: 100 }, rules);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.box).toMatchObject({ cutSize: 1050, deckleSize: 370, sheets: 1, weight: 158.51, paperCost: 6.66 });
    expect(p.weightKg).toBe(0.15851);
    expect(p.conversion).toBe(1.9);
    expect(p.printing).toBe(0);
    expect(p.marginPct).toBe(30);
    expect(p.unitPrice).toBe(11.13);
    expect(p.amount).toBe(1113);
  });

  it('adds printing (per colour + plate spread over qty) and uses the quantity slab', () => {
    // printing 0.6 + 1500/500 = 3.6; base 6.66 + 1.90212 + 3.6 = 12.16212; ×1.22 = 14.84
    const p = priceCustomBox({ ...box, gradeId: '3-120-18', qty: 500, colours: 1 }, rules);
    expect(p.ok && [p.printing, p.marginPct, p.unitPrice, p.amount]).toEqual([3.6, 22, 14.84, 7420]);
  });

  it('uses per-layer paper for mixed grades', () => {
    const spec = specForGrade(box, rules.grades[1], rules.paper)!;
    expect(spec.perLayer).toBe(true);
    expect(spec.layers.slice(0, 5).map((l) => l.price)).toEqual([46, 42, 42, 42, 46]);
    expect(spec.layers).toHaveLength(9);
    const p = priceCustomBox({ ...box, gradeId: '5-mixed', qty: 1000 }, rules);
    expect(p.ok && p.box.deckleSize).toBe(200 + 150 + 20);
  });

  it('says why it cannot price', () => {
    const why = (over: Partial<Parameters<typeof priceCustomBox>[0]>) => {
      const p = priceCustomBox({ ...box, gradeId: '3-120-18', qty: 500, ...over }, rules);
      return p.ok ? 'ok' : p.problem;
    };
    expect(why({ length: 20 })).toBe('bad-size');
    expect(why({ width: NaN })).toBe('bad-size');
    expect(why({ gradeId: 'nope' })).toBe('unknown-grade');
    expect(why({ gradeId: 'no-rate' })).toBe('no-paper-rate');
    expect(why({ qty: 50 })).toBe('qty-too-low');
    expect(why({ qty: 60000 })).toBe('qty-too-high');
    expect(why({ colours: 5 })).toBe('too-many-colours');
    expect(why({ height: 1500 })).toBe('ok'); // deckle 200+1500+20 = 1720 ≤ 1800
    expect(why({ height: 1600 })).toBe('too-big'); // deckle 1820 > 1800
    expect(why({ length: 900, width: 400 })).toBe('ok'); // cut 2650 ≥ 1600 → 2 sheets of 1350
    expect(why({ length: 1300, width: 400 })).toBe('too-big'); // 2 sheets of 1750 > maxCut 1600
  });

  it('price falls as quantity rises', () => {
    const t = slabTable({ ...box, gradeId: '3-120-18', colours: 1 }, rules);
    expect(t.map((r) => r.minQty)).toEqual([100, 500, 2000]);
    expect(t[0].unitPrice).toBeGreaterThan(t[1].unitPrice);
    expect(t[1].unitPrice).toBeGreaterThan(t[2].unitPrice);
  });

  it('picks the highest slab the quantity reaches', () => {
    expect(slabFor(99, rules.slabs)).toBeUndefined();
    expect(slabFor(499, rules.slabs)?.marginPct).toBe(30);
    expect(slabFor(2000, rules.slabs)?.marginPct).toBe(15);
  });
});

describe('delivery', () => {
  const zones: DeliveryZone[] = [
    { name: 'Tamil Nadu', pincodeFrom: 600000, pincodeTo: 643999, mode: 'courier', ratePerKg: 0, minCharge: 0, days: 4 },
    { name: 'Pudukkottai', pincodeFrom: 622001, pincodeTo: 622999, mode: 'own', ratePerKg: 4, minCharge: 300, freeAbove: 25000, days: 1 },
    { name: 'Old zone', pincodeFrom: 622001, pincodeTo: 622010, mode: 'own', ratePerKg: 1, minCharge: 1, days: 1, active: false },
    { name: 'Factory', pincodeFrom: 622002, pincodeTo: 622002, mode: 'pickup', ratePerKg: 0, minCharge: 0, days: 0 },
  ];

  it('finds the narrowest active zone', () => {
    expect(findZone(zones, '622 001')?.name).toBe('Pudukkottai');
    expect(findZone(zones, 622002)?.name).toBe('Factory');
    expect(findZone(zones, '600040')?.name).toBe('Tamil Nadu');
    expect(findZone(zones, '110001')).toBeUndefined();
    expect(findZone(zones, '6220')).toBeUndefined();
  });

  it('charges by weight with a minimum, free above a value, courier priced elsewhere', () => {
    const own = zones[1];
    expect(deliveryCharge(own, 50, 10000)).toBe(300); // 50 kg × ₹4 = 200 → minimum 300
    expect(deliveryCharge(own, 158.51, 10000)).toBe(634.04);
    expect(deliveryCharge(own, 500, 25000)).toBe(0);
    expect(deliveryCharge(zones[0], 10, 1000)).toBeNull();
    expect(deliveryCharge(zones[3], 10, 1000)).toBe(0);
  });
});

describe('checkout', () => {
  it('taxes goods and delivery at the goods rate', () => {
    expect(checkoutTotals(7420, 300, 5)).toEqual({ goods: 7420, delivery: 300, taxable: 7720, tax: 386, total: 8106 });
  });
  it('advance amount, clamped', () => {
    expect(advanceAmount(8106, 100)).toBe(8106);
    expect(advanceAmount(8106, 50)).toBe(4053);
    expect(advanceAmount(8106, 150)).toBe(8106);
  });
});

describe('web price list set-up', () => {
  it('no machine limit when maxDeckle / maxCut are 0', () => {
    const open = { ...rules, limits: { ...rules.limits, maxDeckle: 0, maxCut: 0 } };
    expect(priceCustomBox({ ...box, height: 2000, gradeId: '3-120-18', qty: 500 }, open).ok).toBe(true);
  });

  it('normalizes missing / damaged data to safe defaults', () => {
    const d = defaultWebShop();
    expect(normalizeWebShop(undefined)).toEqual(d);
    expect(normalizeWebShop('junk')).toEqual(d);
    const w = normalizeWebShop({ rules: { paper: [{ gsm: 120, bf: '18', pricePerKg: 42 }], grades: [{ id: 'a', ply: 4, layers: [] }, { id: 'b', ply: 3, layers: [{ gsm: 120, bf: 18 }] }], conversionPerKg: { 3: 12, 5: 'x' } }, advancePct: 50 });
    expect(w.rules.paper).toEqual([{ gsm: 120, bf: 0, pricePerKg: 42 }]);
    expect(w.rules.grades.map((g) => g.id)).toEqual(['b']);
    expect(w.rules.conversionPerKg).toEqual({ 3: 12 });
    expect(w.rules.limits.minQty).toBe(100);
    expect(w.advancePct).toBe(50);
    expect(w.showPrices).toBe(true);
  });

  it('lists what is missing before prices can be shown', () => {
    expect(setupProblems(defaultWebShop().rules)).toEqual(['Add at least one board grade.', 'Add at least one quantity slab with a margin.']);
    expect(setupProblems(rules).filter((p) => !p.startsWith('missing'))).toEqual([]);
    expect(setupProblems({ ...rules, grades: [rules.grades[2]] })).toEqual(['missing: no paper rate for 180 GSM / 22 BF.']);
    expect(setupProblems({ ...rules, grades: [{ id: 'x', label: '', ply: 7, layers: [{ gsm: 120, bf: 18 }] }] })).toEqual(['7 ply grade: conversion cost for 7 ply is not set.']);
    expect(setupProblems({ ...rules, slabs: [{ minQty: 500, marginPct: 20 }] })).toContain('No slab starts at or below the minimum order of 100 boxes.');
  });

  it('labels grades', () => {
    expect(gradeLabel(rules.grades[0])).toBe('3 ply · 120 GSM · 18 BF');
    expect(gradeLabel(rules.grades[1])).toBe('5 ply · mixed paper');
  });
});

describe('standard products cart', () => {
  const spec = specForGrade({ length: 300, width: 200, height: 150 }, rules.grades[0], rules.paper)!;
  const product = (over: Partial<import('./types').Product> = {}): import('./types').Product => ({
    id: 'p1', slug: '3-ply-300x200x150', name: '3 ply 300×200×150', description: '', ply: 3, spec,
    packs: [{ qty: 25, price: 450 }, { qty: 100, price: 1600 }], hsn: '48191010', taxPct: 5, stockQty: null,
    photos: [], active: true, sort: 0, createdAt: '', updatedAt: '', ...over,
  });

  it('prices packs, adds up weight for delivery', () => {
    const c = priceCart([{ productId: 'p1', packQty: 100, count: 2 }, { productId: 'p1', packQty: 25, count: 1 }], [product()]);
    expect(c.problems).toEqual([]);
    expect(c.lines.map((l) => [l.boxes, l.amount])).toEqual([[200, 3200], [25, 450]]);
    expect(c.goods).toBe(3650);
    // 158.51 g per box (hand-worked earlier) × 225 boxes = 35.665 kg
    expect(c.weightKg).toBe(35.665);
  });

  it('refuses switched-off products, removed packs, silly counts and more than the stock', () => {
    const c = priceCart(
      [
        { productId: 'gone', packQty: 25, count: 1 },
        { productId: 'p1', packQty: 50, count: 1 },
        { productId: 'p1', packQty: 25, count: 0 },
        { productId: 'p2', packQty: 25, count: 3 },
      ],
      [product(), product({ id: 'p2', name: 'Small', stockQty: 60 }), product({ id: 'off', active: false })],
    );
    expect(c.lines).toEqual([]);
    expect(c.problems.map((p) => p.message)).toEqual([
      'This box is no longer sold online.',
      '3 ply 300×200×150: this pack size is no longer available.',
      '3 ply 300×200×150: choose between 1 and 1000 packs.',
      'Small: only 60 boxes in stock.',
    ]);
  });

  it('makes slugs', () => {
    expect(productSlug('3 Ply 300×200×150 mm!')).toBe('3-ply-300x200x150-mm');
  });
});
