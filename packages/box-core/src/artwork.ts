import type { ArtworkElement, OrderArtwork, PrintKind } from './types';
import { BOX_SIDES, SIDE_LABEL, sideSize, type BoxSide } from './box3d';

/** Inks offered for printing on kraft board. */
export const INKS = [
  { id: '#1a1a1a', label: 'Black' },
  { id: '#6b2a06', label: 'Brown' },
  { id: '#c62828', label: 'Red' },
  { id: '#1f4e9c', label: 'Blue' },
  { id: '#2e7d32', label: 'Green' },
  { id: '#f98104', label: 'Orange' },
] as const;

export const PRINT_KINDS: PrintKind[] = ['plain', 'one', 'multi'];

/** Colours used for the price: plain 0, one 1, multicolour = the most the price list allows (at least 2). */
export function printColours(kind: PrintKind, maxColours: number): number {
  if (kind === 'one') return Math.min(1, Math.max(0, maxColours));
  if (kind === 'multi') return maxColours >= 2 ? maxColours : 0;
  return 0;
}

/** The options the price list allows (multicolour needs at least 2 colours, one colour at least 1). */
export const printKindsFor = (maxColours: number): PrintKind[] => PRINT_KINDS.filter((k) => k === 'plain' || printColours(k, maxColours) > 0);

/** Back from a colour count (older links: ?c=3) to the kind. */
export const printKindOf = (colours: number): PrintKind => (colours <= 0 ? 'plain' : colours === 1 ? 'one' : 'multi');

export function printLabel(kind: PrintKind, colours?: number): string {
  if (kind === 'one') return '1 colour print';
  if (kind === 'multi') return colours && colours > 1 ? `Multicolour print (up to ${colours} colours)` : 'Multicolour print';
  return 'Plain';
}

export const MAX_ELEMENTS = 16;
export const MAX_TEXT = 60;
const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/**
 * A design from the browser, made safe to store: known fields only, numbers clamped, at most 16 elements, known sides,
 * texts trimmed to 60 letters, inks as #rrggbb. Returns null when there is nothing to print.
 */
export function cleanArtwork(input: unknown, kind: PrintKind, colours: number, box: { length: number; width: number; height: number }): OrderArtwork | null {
  if (kind === 'plain' || !input || typeof input !== 'object') return null;
  const a = input as Record<string, unknown>;
  const ink = typeof a.ink === 'string' && HEX.test(a.ink) ? a.ink.toLowerCase() : INKS[0].id;
  const els: ArtworkElement[] = [];
  for (const raw of (Array.isArray(a.elements) ? a.elements : []).slice(0, MAX_ELEMENTS)) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const side: BoxSide = BOX_SIDES.includes(e.side as BoxSide) ? (e.side as BoxSide) : 'front';
    const base = { id: String(e.id || els.length + 1).slice(0, 40), side, x: clamp(e.x, 0, 1, 0.5), y: clamp(e.y, 0, 1, 0.5) };
    const color = kind === 'one' ? ink : typeof e.color === 'string' && HEX.test(e.color) ? e.color.toLowerCase() : ink;
    if (e.kind === 'logo') els.push({ ...base, kind: 'logo', w: clamp(e.w, 0.05, 1, 0.4), ratio: clamp(e.ratio, 0.05, 20, 1) });
    else if (e.kind === 'text') {
      const text = String(e.text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
      if (text) els.push({ ...base, kind: 'text', text, size: clamp(e.size, 0.03, 0.5, 0.1), bold: e.bold !== false, color });
    }
  }
  if (!els.length) return null;
  return { print: kind, colours, box: { length: Math.round(box.length), width: Math.round(box.width), height: Math.round(box.height) }, ...(kind === 'one' ? { ink } : {}), elements: els };
}

/** Plain-language lines for the order (production slip, WhatsApp): the print, then each side with what goes on it. */
export function artworkSummary(a: OrderArtwork): string[] {
  const ink = (c?: string) => INKS.find((i) => i.id === c)?.label || c || '';
  const box = a.box || { length: 0, width: 0, height: 0 };
  const lines = [`${printLabel(a.print, a.colours)}${a.print === 'one' && a.ink ? `, ${ink(a.ink)} ink` : ''}`];
  for (const side of BOX_SIDES) {
    const els = a.elements.filter((e) => (e.side || 'front') === side);
    if (!els.length) continue;
    const sz = sideSize(box, side);
    lines.push(`${SIDE_LABEL[side]} (${sz.width} × ${sz.height} mm):`);
    for (const e of els) {
      const at = `centre at ${Math.round(e.x * 100)}% across, ${Math.round(e.y * 100)}% down`;
      lines.push(
        e.kind === 'logo'
          ? `  Logo, ${Math.round((e.w || 0) * sz.width)} mm wide, ${at}`
          : `  Text “${e.text}”, ${Math.round((e.size || 0) * sz.height)} mm high${a.print === 'multi' ? `, ${ink(e.color)}` : ''}, ${at}`,
      );
    }
  }
  return lines;
}

/** Sides that have something printed on them. */
export const printedSides = (a: OrderArtwork): BoxSide[] => BOX_SIDES.filter((s) => a.elements.some((e) => (e.side || 'front') === s));
