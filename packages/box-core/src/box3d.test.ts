import { describe, expect, it } from 'vitest';
import { clampPitch, dimensionLines, project, rotate, MAX_PITCH, BOX_SIDES, SIDE_VIEW, sideOnScreen, sideSize } from './box3d';

const dims = { length: 300, width: 200, height: 150 };

describe('3D box geometry', () => {
  it('rotation keeps lengths', () => {
    const r = rotate([0.3, -0.4, 0.5], { yaw: 1.1, pitch: -0.7 });
    expect(Math.hypot(...r)).toBeCloseTo(Math.hypot(0.3, 0.4, 0.5), 10);
  });

  it('shows only the front face when looking straight at it', () => {
    const p = project(dims, { yaw: 0, pitch: 0 }, 100, 0, 0);
    expect(p.faces.filter((f) => f.visible)).toHaveLength(1);
    expect(p.faces.find((f) => f.visible)).toMatchObject({ axis: 2, side: 1 });
  });

  it('shows three faces from a corner view and hides three edges', () => {
    const p = project(dims, { yaw: -0.6, pitch: 0.5 }, 100, 0, 0);
    expect(p.faces.filter((f) => f.visible)).toHaveLength(3);
    expect(p.edges).toHaveLength(12);
    expect(p.edges.filter((e) => e.hidden)).toHaveLength(3);
  });

  it('keeps the box inside its bounding circle', () => {
    for (const yaw of [0, 0.7, 2, -2.5]) {
      for (const pitch of [-1, 0, 0.5, 1.4]) {
        const p = project(dims, { yaw, pitch }, 100, 0, 0);
        for (const v of p.pts) expect(Math.hypot(v.x, v.y)).toBeLessThan(100 * 1.25);
      }
    }
  });

  it('gives each axis the right edge length when viewed side-on', () => {
    const p = project(dims, { yaw: 0, pitch: 0 }, 100, 0, 0);
    const len = (axis: number) => {
      const e = p.edges.find((x) => x.axis === axis)!;
      return Math.hypot(p.pts[e.a].x - p.pts[e.b].x, p.pts[e.a].y - p.pts[e.b].y);
    };
    expect(len(0) / len(1)).toBeCloseTo(300 / 150, 1); // length : height
    expect(len(2)).toBeLessThan(len(1) / 4); // width points at the viewer, only perspective shows
  });

  it('places a dimension line for every visible axis, outside the box', () => {
    const p = project(dims, { yaw: -0.6, pitch: 0.5 }, 90, 180, 140);
    const lines = dimensionLines(p, { x: 180, y: 140 }, 14);
    expect(lines.every(Boolean)).toBe(true);
    for (const l of lines) {
      const mid = { x: (l!.p1.x + l!.p2.x) / 2, y: (l!.p1.y + l!.p2.y) / 2 };
      const off = Math.hypot(l!.q1.x - l!.p1.x, l!.q1.y - l!.p1.y);
      expect(off).toBeCloseTo(14, 5);
      // the line is farther from the centre than the edge it measures
      expect(Math.hypot(l!.label.x - 180, l!.label.y - 140)).toBeGreaterThan(Math.hypot(mid.x - 180, mid.y - 140));
    }
  });

  it('skips an axis that points at the viewer', () => {
    const p = project(dims, { yaw: 0, pitch: 0 }, 90, 180, 140);
    const lines = dimensionLines(p, { x: 180, y: 140 }, 14);
    expect(lines[0]).not.toBeNull();
    expect(lines[1]).not.toBeNull();
    expect(lines[2]).toBeNull();
  });

  it('limits the tilt', () => {
    expect(clampPitch(5)).toBe(MAX_PITCH);
    expect(clampPitch(-5)).toBe(-MAX_PITCH);
  });
});

describe('box sides for artwork', () => {
  const d = { length: 300, width: 200, height: 150 };
  it('gives each side its size in mm', () => {
    expect(sideSize(d, 'front')).toEqual({ width: 300, height: 150 });
    expect(sideSize(d, 'right')).toEqual({ width: 200, height: 150 });
    expect(sideSize(d, 'top')).toEqual({ width: 300, height: 200 });
  });
  it('shows the chosen side to the viewer, upright and not mirrored', () => {
    for (const s of BOX_SIDES) {
      const pr = project(d, SIDE_VIEW[s], 100, 0, 0);
      const o = sideOnScreen(pr, s);
      expect(o.visible, s).toBe(true);
      // top-left → top-right goes right on screen, and a 2D cross product > 0 means the picture is not mirrored
      const ux = o.tr.x - o.tl.x, uy = o.tr.y - o.tl.y, vx = o.bl.x - o.tl.x, vy = o.bl.y - o.tl.y;
      expect(ux * vy - uy * vx, s).toBeGreaterThan(0);
      if (s !== 'top' && s !== 'bottom') expect(o.bl.y, s).toBeGreaterThan(o.tl.y); // bottom edge is lower on screen
    }
  });
});
