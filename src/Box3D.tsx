import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { AXIS_NAMES, clampPitch, defaultView, dimensionLines, project, type View } from '@honeypackers/box-core/box3d';
import { num } from './lib/format';

const W = 360;
const H = 290;
const CX = W / 2;
const CY = H / 2;
const RADIUS = 96;

const SAMPLE = { length: 300, width: 200, height: 150 };

// Faces are tints of the theme's brown, lit from the upper left, so they follow light / dark mode.
const faceFill = (shade: number) =>
  `color-mix(in oklab, color-mix(in oklab, var(--primary) 52%, white) ${Math.round(shade * 100)}%, color-mix(in oklab, var(--primary) 78%, black))`;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A box you can turn with a finger or the mouse. The length, width and height stay drawn outside the box
 * (always upright and readable) while it rotates.
 */
export function Box3D({ length, width, height, unit = 'mm' }: { length: number; width: number; height: number; unit?: string }) {
  const [view, setView] = useState<View>(defaultView);
  const [spin, setSpin] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const empty = !(length > 0 && width > 0 && height > 0);
  const dims = empty ? SAMPLE : { length, width, height };

  useEffect(() => {
    if (!spin || reducedMotion()) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(50, t - last);
      last = t;
      if (!drag.current) setView((v) => ({ ...v, yaw: v.yaw + dt * 0.0006 }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spin]);

  const scene = useMemo(() => {
    const pr = project(dims, view, RADIUS, CX, CY);
    return { pr, dim: dimensionLines(pr, { x: CX, y: CY }, 15) };
  }, [dims.length, dims.width, dims.height, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ yaw: v.yaw + dx * 0.012, pitch: clampPitch(v.pitch + dy * 0.012) }));
  };
  const up = () => {
    drag.current = null;
  };
  const key = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = 0.12;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const k = d[e.key];
    if (!k) return;
    e.preventDefault();
    setView((v) => ({ yaw: v.yaw + k[0], pitch: clampPitch(v.pitch + k[1]) }));
  };

  const { pr, dim } = scene;
  const values = [length, height, width];
  const faces = pr.faces.filter((f) => f.visible);
  const hidden = pr.edges.filter((e) => e.hidden);
  const outline = (idx: number[]) => idx.map((i) => `${pr.pts[i].x.toFixed(1)},${pr.pts[i].y.toFixed(1)}`).join(' ');

  return (
    <div className="card overflow-hidden">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className={`block w-full select-none ${empty ? 'opacity-40' : ''}`}
          style={{ touchAction: 'none', cursor: drag.current ? 'grabbing' : 'grab' }}
          role="img"
          tabIndex={0}
          aria-label={empty ? '3D box preview. Enter length, width and height.' : `3D box ${num(length)} by ${num(width)} by ${num(height)} ${unit}. Drag or use arrow keys to rotate.`}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onKeyDown={key}
        >
          <ellipse cx={CX} cy={CY + RADIUS * 0.92} rx={RADIUS * 1.05} ry={RADIUS * 0.17} style={{ fill: 'var(--foreground)', opacity: 0.08 }} />

          {hidden.map((e, i) => (
            <line
              key={i}
              x1={pr.pts[e.a].x}
              y1={pr.pts[e.a].y}
              x2={pr.pts[e.b].x}
              y2={pr.pts[e.b].y}
              strokeDasharray="3 4"
              style={{ stroke: 'var(--muted-foreground)', opacity: 0.5, strokeWidth: 1 }}
            />
          ))}

          {faces.map((f) => (
            <polygon key={f.axis * 2 + f.side} points={outline(f.idx)} strokeLinejoin="round" style={{ fill: faceFill(f.shade), stroke: 'color-mix(in oklab, var(--primary) 45%, black)', strokeWidth: 1.4 }} />
          ))}

          {/* where the top / bottom flaps meet */}
          {faces
            .filter((f) => f.axis === 1)
            .map((f) => {
              const [a, b, c, d] = f.idx.map((i) => pr.pts[i]);
              // the seam runs along the length: join the midpoints of the two width-wise sides (a-b and d-c)
              const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              const m2 = { x: (d.x + c.x) / 2, y: (d.y + c.y) / 2 };
              return <line key={f.side} x1={m1.x} y1={m1.y} x2={m2.x} y2={m2.y} style={{ stroke: 'color-mix(in oklab, var(--primary) 45%, black)', strokeWidth: 1, opacity: 0.7 }} />;
            })}

          {!empty &&
            dim.map((l) =>
              l ? (
                <g key={l.axis} style={{ stroke: 'var(--foreground)', strokeWidth: 1, opacity: 0.85 }}>
                  <line x1={l.p1.x} y1={l.p1.y} x2={l.q1.x} y2={l.q1.y} strokeDasharray="2 2" />
                  <line x1={l.p2.x} y1={l.p2.y} x2={l.q2.x} y2={l.q2.y} strokeDasharray="2 2" />
                  <line x1={l.q1.x} y1={l.q1.y} x2={l.q2.x} y2={l.q2.y} />
                  <circle cx={l.q1.x} cy={l.q1.y} r={2.2} style={{ fill: 'var(--foreground)', stroke: 'none' }} />
                  <circle cx={l.q2.x} cy={l.q2.y} r={2.2} style={{ fill: 'var(--foreground)', stroke: 'none' }} />
                  <text
                    x={l.label.x}
                    y={l.label.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    style={{ fill: 'var(--foreground)', stroke: 'var(--card)', strokeWidth: 4, paintOrder: 'stroke', strokeLinejoin: 'round', fontSize: 12.5, fontWeight: 700, opacity: 1 }}
                  >
                    {AXIS_NAMES[l.axis]} {num(values[l.axis])}
                  </text>
                </g>
              ) : null,
            )}
        </svg>
        {empty && <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 px-8 text-center text-[13.5px] font-medium text-muted-foreground">Enter length, width and height to see the box.</p>}
        <div className="absolute right-2 top-2 flex gap-1">
          <button type="button" className="grid size-9 place-items-center rounded-full bg-card/80 text-foreground ring-1 ring-border backdrop-blur active:bg-muted" aria-label={spin ? 'Stop turning' : 'Turn automatically'} aria-pressed={spin} onClick={() => setSpin((s) => !s)}>
            {spin ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-full bg-card/80 text-foreground ring-1 ring-border backdrop-blur active:bg-muted"
            aria-label="Reset view"
            onClick={() => {
              setSpin(false);
              setView(defaultView);
            }}
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
      <div className="tnum flex items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5 text-[12.5px] text-muted-foreground">
        <span>
          <b className="text-foreground">{empty ? '—' : `${num(length)} × ${num(width)} × ${num(height)}`}</b> {unit} (L × W × H, inside)
        </span>
        <span className="shrink-0">Drag to rotate</span>
      </div>
    </div>
  );
}
