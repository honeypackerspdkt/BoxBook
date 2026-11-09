/**
 * Geometry for the rotatable 3D box: a cuboid with vertices numbered by bits
 * (bit0 = x/length, bit1 = y/height, bit2 = z/width), projected to the screen for a given view.
 * Pure maths so it can be tested without a browser.
 */

export type V3 = [number, number, number];
export interface View {
  /** Turn around the vertical axis, radians. */
  yaw: number;
  /** Tilt: positive looks down on the box from above, radians. */
  pitch: number;
}
export interface Dims {
  length: number;
  width: number;
  height: number;
}
export interface Pt {
  x: number;
  y: number;
  z: number;
}
export interface Face {
  axis: number;
  side: 0 | 1;
  /** Vertex indices, in order around the face. */
  idx: [number, number, number, number];
  visible: boolean;
  /** 0 (dark) … 1 (lit). */
  shade: number;
}
export interface Edge {
  a: number;
  b: number;
  /** 0 = length (x), 1 = height (y), 2 = width (z). */
  axis: number;
  /** The two faces that meet along this edge (indices into Projected.faces). */
  faces: [number, number];
  hidden: boolean;
  visibleFaces: number;
}
export interface Projected {
  pts: Pt[];
  faces: Face[];
  edges: Edge[];
}
export interface DimLine {
  axis: number;
  /** The measured edge on screen. */
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  /** The dimension line, drawn outside the box. */
  q1: { x: number; y: number };
  q2: { x: number; y: number };
  /** Where the number goes. */
  label: { x: number; y: number };
}

export const AXIS_NAMES = ['L', 'H', 'W'] as const;
export const defaultView: View = { yaw: -0.62, pitch: 0.5 };
export const MAX_PITCH = 1.5;

export function rotate(p: V3, v: View): V3 {
  const [x, y, z] = p;
  const cy = Math.cos(v.yaw);
  const sy = Math.sin(v.yaw);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cp = Math.cos(v.pitch);
  const sp = Math.sin(v.pitch);
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

export const clampPitch = (p: number) => Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p));

const LIGHT: V3 = (() => {
  const l: V3 = [-0.35, 0.75, 0.55];
  const m = Math.hypot(...l);
  return [l[0] / m, l[1] / m, l[2] / m];
})();

const bit = (i: number, k: number) => (i >> k) & 1;
const withBit = (i: number, k: number, v: number) => (i & ~(1 << k)) | (v << k);
const faceIndex = (axis: number, side: number) => axis * 2 + side;

/** Projects the box so that its bounding sphere has the given pixel radius, centred on (cx, cy). */
export function project(d: Dims, view: View, radius: number, cx: number, cy: number): Projected {
  const diag = Math.hypot(d.length, d.width, d.height) || 1;
  const ext: V3 = [d.length / diag, d.height / diag, d.width / diag]; // half-extents, bounding sphere radius = 1
  const D = 6; // camera distance, in sphere radii (mild perspective)

  const pts: Pt[] = [];
  for (let i = 0; i < 8; i++) {
    const r = rotate([(bit(i, 0) ? 1 : -1) * ext[0], (bit(i, 1) ? 1 : -1) * ext[1], (bit(i, 2) ? 1 : -1) * ext[2]], view);
    const f = D / (D - r[2]);
    pts.push({ x: cx + r[0] * radius * f, y: cy - r[1] * radius * f, z: r[2] });
  }

  const faces: Face[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const b = (axis + 1) % 3;
    const c = (axis + 2) % 3;
    for (const side of [0, 1] as const) {
      const at = (u: number, v: number) => withBit(withBit(withBit(0, axis, side), b, u), c, v);
      const n: V3 = [0, 0, 0];
      n[axis] = side ? 1 : -1;
      const rn = rotate(n, view);
      faces.push({
        axis,
        side,
        idx: [at(0, 0), at(1, 0), at(1, 1), at(0, 1)],
        visible: rn[2] > 1e-6,
        shade: Math.max(0, rn[0] * LIGHT[0] + rn[1] * LIGHT[1] + rn[2] * LIGHT[2]),
      });
    }
  }

  const edges: Edge[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const b = (axis + 1) % 3;
    const c = (axis + 2) % 3;
    for (let u = 0; u < 2; u++) {
      for (let v = 0; v < 2; v++) {
        const base = withBit(withBit(0, b, u), c, v);
        const fs: [number, number] = [faceIndex(b, u), faceIndex(c, v)];
        const visibleFaces = (faces[fs[0]].visible ? 1 : 0) + (faces[fs[1]].visible ? 1 : 0);
        edges.push({ a: withBit(base, axis, 0), b: withBit(base, axis, 1), axis, faces: fs, hidden: visibleFaces === 0, visibleFaces });
      }
    }
  }
  return { pts, faces, edges };
}

/**
 * One dimension line per axis, set outside the outline of the box so the numbers stay readable
 * from any angle. An axis is skipped when it points (almost) straight at the viewer.
 */
export function dimensionLines(pr: Projected, centre: { x: number; y: number }, offset: number, minLen = 18): (DimLine | null)[] {
  return [0, 1, 2].map((axis) => {
    const all = pr.edges.filter((e) => e.axis === axis && e.visibleFaces > 0);
    const outline = all.filter((e) => e.visibleFaces === 1);
    const pool = outline.length ? outline : all;
    let best: Edge | null = null;
    let bestScore = -Infinity;
    for (const e of pool) {
      const p = pr.pts[e.a];
      const q = pr.pts[e.b];
      const mx = (p.x + q.x) / 2 - centre.x;
      const my = (p.y + q.y) / 2 - centre.y;
      // the outermost edge; flat edges prefer the lower side, like a drawing
      const score = Math.hypot(mx, my) + (axis === 1 ? 0 : my * 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best) return null;
    const p1 = pr.pts[best.a];
    const p2 = pr.pts[best.b];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < minLen) return null;
    let nx = -dy / len;
    let ny = dx / len;
    const mx = (p1.x + p2.x) / 2 - centre.x;
    const my = (p1.y + p2.y) / 2 - centre.y;
    if (nx * mx + ny * my < 0) {
      nx = -nx;
      ny = -ny;
    }
    const q1 = { x: p1.x + nx * offset, y: p1.y + ny * offset };
    const q2 = { x: p2.x + nx * offset, y: p2.y + ny * offset };
    return {
      axis,
      p1: { x: p1.x, y: p1.y },
      p2: { x: p2.x, y: p2.y },
      q1,
      q2,
      label: { x: (q1.x + q2.x) / 2 + nx * 11, y: (q1.y + q2.y) / 2 + ny * 11 },
    };
  });
}

/* ───────── sides of the box, for print artwork ───────── */

/** The six sides a design can go on. Front / back are length × height, left / right width × height, top / bottom length × width. */
export type BoxSide = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export const BOX_SIDES: BoxSide[] = ['front', 'right', 'back', 'left', 'top', 'bottom'];
export const SIDE_LABEL: Record<BoxSide, string> = { front: 'Front', back: 'Back', left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom' };

const vtx = (x: number, y: number, z: number) => x | (y << 1) | (z << 2);
/** Per side: the face (axis, side) and its top-left, top-right and bottom-left corners as seen from outside. */
const SIDES: Record<BoxSide, { axis: number; side: 0 | 1; tl: number; tr: number; bl: number }> = {
  front: { axis: 2, side: 1, tl: vtx(0, 1, 1), tr: vtx(1, 1, 1), bl: vtx(0, 0, 1) },
  back: { axis: 2, side: 0, tl: vtx(1, 1, 0), tr: vtx(0, 1, 0), bl: vtx(1, 0, 0) },
  right: { axis: 0, side: 1, tl: vtx(1, 1, 1), tr: vtx(1, 1, 0), bl: vtx(1, 0, 1) },
  left: { axis: 0, side: 0, tl: vtx(0, 1, 0), tr: vtx(0, 1, 1), bl: vtx(0, 0, 0) },
  // top seen from above with the front towards you; bottom seen from below with the front at the top
  top: { axis: 1, side: 1, tl: vtx(0, 1, 0), tr: vtx(1, 1, 0), bl: vtx(0, 1, 1) },
  bottom: { axis: 1, side: 0, tl: vtx(0, 0, 1), tr: vtx(1, 0, 1), bl: vtx(0, 0, 0) },
};

/** Size of a side in mm (width × height as you look at it). */
export function sideSize(d: Dims, s: BoxSide): { width: number; height: number } {
  if (s === 'front' || s === 'back') return { width: d.length, height: d.height };
  if (s === 'left' || s === 'right') return { width: d.width, height: d.height };
  return { width: d.length, height: d.width };
}

/** Where a side is on screen: its corners, whether it faces the viewer, and its face polygon. */
export function sideOnScreen(pr: Projected, s: BoxSide) {
  const g = SIDES[s];
  const face = pr.faces[g.axis * 2 + g.side];
  const p = (i: number) => ({ x: pr.pts[i].x, y: pr.pts[i].y });
  return { tl: p(g.tl), tr: p(g.tr), bl: p(g.bl), visible: face.visible, poly: face.idx.map(p) };
}

/** A view that shows this side well (with a little of its neighbours, so it still looks like a box). */
export const SIDE_VIEW: Record<BoxSide, View> = {
  front: { yaw: -0.45, pitch: 0.35 },
  right: { yaw: -1.15, pitch: 0.35 },
  back: { yaw: 2.7, pitch: 0.35 },
  left: { yaw: 1.15, pitch: 0.35 },
  top: { yaw: -0.5, pitch: 1.05 },
  bottom: { yaw: -0.5, pitch: -1.05 },
};
