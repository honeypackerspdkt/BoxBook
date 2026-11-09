import { describe, expect, it } from 'vitest';
import { artworkSummary, cleanArtwork, printColours, printedSides, printKindOf, printKindsFor } from './artwork';

const box = { length: 300, width: 200, height: 150 };

describe('print kinds', () => {
  it('prices plain 0, one colour 1 and multicolour at the most colours allowed', () => {
    expect(printColours('plain', 4)).toBe(0);
    expect(printColours('one', 4)).toBe(1);
    expect(printColours('multi', 4)).toBe(4);
    expect(printColours('multi', 1)).toBe(0);
  });
  it('offers only what the price list allows', () => {
    expect(printKindsFor(4)).toEqual(['plain', 'one', 'multi']);
    expect(printKindsFor(1)).toEqual(['plain', 'one']);
    expect(printKindsFor(0)).toEqual(['plain']);
  });
  it('reads old colour counts', () => {
    expect(printKindOf(0)).toBe('plain');
    expect(printKindOf(1)).toBe('one');
    expect(printKindOf(3)).toBe('multi');
  });
});

describe('cleanArtwork', () => {
  it('keeps known fields, clamps numbers and uses one ink for one-colour print', () => {
    const a = cleanArtwork(
      { ink: '#C62828', elements: [{ id: 'a', kind: 'logo', x: 2, y: -1, w: 9, ratio: 0.5, evil: 1 }, { id: 'b', kind: 'text', text: '  Honey   Packers ', size: 0.2, color: '#1f4e9c' }] },
      'one', 1, box,
    )!;
    expect(a.ink).toBe('#c62828');
    expect(a.elements[0]).toEqual({ id: 'a', kind: 'logo', side: 'front', x: 1, y: 0, w: 1, ratio: 0.5 });
    expect(a.elements[1]).toMatchObject({ kind: 'text', text: 'Honey Packers', color: '#c62828' });
  });
  it('keeps each colour in multicolour, drops bad colours, empty texts and extra elements', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), kind: 'text', text: `T${i}`, color: i ? '#2e7d32' : 'red' }));
    const a = cleanArtwork({ elements: [{ kind: 'text', text: '   ' }, ...many] }, 'multi', 4, box)!;
    expect(a.elements).toHaveLength(15); // 16 kept, minus the empty text
    expect(a.elements[0].color).toBe('#1a1a1a');
    expect(a.elements[1].color).toBe('#2e7d32');
  });
  it('is null for plain boxes or an empty design', () => {
    expect(cleanArtwork({ elements: [{ kind: 'text', text: 'x' }] }, 'plain', 0, box)).toBeNull();
    expect(cleanArtwork({ elements: [] }, 'one', 1, box)).toBeNull();
  });
  it('keeps the side of each item (unknown sides go on the front)', () => {
    const a = cleanArtwork({ elements: [{ kind: 'text', text: 'A', side: 'top' }, { kind: 'text', text: 'B', side: 'inside' }] }, 'one', 1, box)!;
    expect(a.elements.map((e) => e.side)).toEqual(['top', 'front']);
  });
  it('summarises the design side by side, in mm', () => {
    const a = cleanArtwork(
      { elements: [{ kind: 'logo', x: 0.5, y: 0.5, w: 0.4, ratio: 1 }, { kind: 'text', text: 'Fragile', size: 0.1, x: 0.5, y: 0.9, side: 'right' }] },
      'one', 1, box,
    )!;
    expect(artworkSummary(a)).toEqual([
      '1 colour print, Black ink',
      'Front (300 × 150 mm):',
      '  Logo, 120 mm wide, centre at 50% across, 50% down',
      'Right (200 × 150 mm):',
      '  Text “Fragile”, 15 mm high, centre at 50% across, 90% down',
    ]);
    expect(printedSides(a)).toEqual(['front', 'right']);
  });
});
