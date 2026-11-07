import { describe, expect, it } from 'vitest';
import { calcBox, emptyLayers, estimate } from './calc';
import type { BoxSpec, Ply } from './types';

/** Literal port of the original eBox BoxWeight.onCreate maths, used as the oracle. */
function original(L: number, W: number, H: number, plyIdx: number, sameGsm: boolean, gsm: number[], bf: number[], price: number[]) {
  const F = [0, ...gsm], G = [0, ...bf], Hh = [0, ...price];
  let v = L * 2 + W * 2 + 50, w: number, sheets: number;
  if (v >= 1600) { w = L + W + 50; v = w * 2; sheets = 2; } else { w = v; sheets = 1; }
  const y = plyIdx === 2 ? 30 : plyIdx === 3 ? 50 : 20;
  const x = W + H + y;
  const B = v * x;
  if (!sameGsm) for (let i = 2; i <= 9; i++) { F[i] = F[1]; G[i] = G[1]; Hh[i] = Hh[1]; }
  const f = [0]; for (let i = 1; i <= 9; i++) f.push(i % 2 === 0 ? (F[i] * B / 100) * 1.4 : F[i] * B / 100);
  const n = plyIdx * 2 + 3; let D = 0, E = 0, bs = 0;
  for (let i = 1; i <= n; i++) { D += f[i]; E += f[i] / 10000 * Hh[i]; bs += i % 2 === 0 ? F[i] * G[i] * 0.5 / 1000 : F[i] * G[i] / 1000; }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { cutSize: w, deckleSize: x, sheets, weight: r(D / 10000), paperCost: r(E / 1000), bs: r(bs) };
}

function spec(L: number, W: number, H: number, ply: Ply, perLayer: boolean, gsm: number[], bf: number[], price: number[]): BoxSpec {
  const layers = emptyLayers().map((_, i) => ({ gsm: gsm[i] ?? 0, bf: bf[i] ?? 0, price: price[i] ?? 0 }));
  return { length: L, width: W, height: H, ply, perLayer, layers };
}

describe('calcBox matches original eBox maths', () => {
  const plies: Ply[] = [3, 5, 7, 9];
  const gsm = [180, 120, 150, 120, 150, 120, 150, 120, 200];
  const bf = [18, 16, 18, 16, 18, 16, 18, 16, 20];
  const price = [38, 32, 35, 32, 35, 32, 35, 32, 42];
  for (const [L, W, H] of [[300, 200, 150], [500, 400, 300], [800, 600, 400], [120, 80, 60]]) {
    plies.forEach((ply, idx) => {
      for (const per of [false, true]) {
        it(`${L}x${W}x${H} ${ply}-ply perLayer=${per}`, () => {
          const a = calcBox(spec(L, W, H, ply, per, gsm, bf, price));
          const b = original(L, W, H, idx, per, gsm, bf, price);
          expect(a.cutSize).toBe(b.cutSize);
          expect(a.deckleSize).toBe(b.deckleSize);
          expect(a.sheets).toBe(b.sheets);
          expect(a.weight).toBeCloseTo(b.weight, 1);
          expect(a.paperCost).toBeCloseTo(b.paperCost, 1);
          expect(a.bs).toBeCloseTo(b.bs, 1);
        });
      }
    });
  }
});

describe('estimate', () => {
  it('applies overhead, profit and tax like eBox', () => {
    const e = estimate(10, { overhead: 2, profitPct: 25, taxPct: 18 }, 100);
    expect(e.unitCost).toBe(12);
    expect(e.unitPrice).toBe(15);
    expect(e.total).toBe(1500);
    expect(e.profit).toBe(300);
    expect(e.tax).toBeCloseTo(270);
    expect(e.totalWithTax).toBeCloseTo(1770);
  });
});
