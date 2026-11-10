import { useState, type ReactNode } from 'react';
import { AlertTriangle, LayoutGrid, List as ListIcon, Plus } from 'lucide-react';
import { Fab, Header, Page } from './ui';

/**
 * The one layout every list page uses (owner's choice, 10 Nov 2026), modelled on Paper stock:
 *   header (title, count) · summary cards · alert box · search + filters + Tiles/List switch · groups of tiles or rows
 * Adding: the round + button on phones, a "+ Add …" button in the header on computers. Tapping an item opens a full page.
 */

export type Layout = 'tiles' | 'list';

/** Tiles/List choice for one page, remembered on this device. */
export function useLayout(key: string, initial: Layout = 'tiles'): [Layout, (l: Layout) => void] {
  const storageKey = `boxbook-layout-${key}`;
  const [layout, setState] = useState<Layout>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v === 'tiles' || v === 'list' ? v : initial;
    } catch {
      return initial;
    }
  });
  const set = (l: Layout) => {
    setState(l);
    try {
      localStorage.setItem(storageKey, l);
    } catch {
      /* private mode: just not remembered */
    }
  };
  return [layout, set];
}

export interface AddAction {
  label: string;
  onClick: () => void;
}

/** Header + page body + the add action, the same on every list page. */
export function ListPage({ title, subtitle, back, large, add, actions, children }: { title: string; subtitle?: string; back?: boolean; large?: boolean; add?: AddAction | false; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <Header
        title={title}
        subtitle={subtitle}
        back={back}
        large={large}
        actions={
          (actions || add) && (
            <>
              {actions}
              {add && (
                <button className="btn-primary hidden !min-h-0 !px-3.5 !py-2 text-[14px] lg:inline-flex" onClick={add.onClick}>
                  <Plus size={17} /> {add.label}
                </button>
              )}
            </>
          )
        }
      />
      <Page>{children}</Page>
      {add && <Fab label={add.label} icon={<Plus size={20} />} onClick={add.onClick} className="lg:hidden" />}
    </>
  );
}

export interface Stat {
  label: string;
  value: string;
  tone?: 'primary' | 'bad' | 'warn';
}

/** Two to four big numbers at the top of a list page. */
export function StatCards({ items }: { items: Stat[] }) {
  const tone = { primary: 'text-primary', bad: 'text-bad', warn: 'text-warn' };
  return (
    <div className={`mb-5 grid gap-3 ${items.length >= 4 ? 'grid-cols-2 sm:grid-cols-4' : items.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {items.map((s) => (
        <div key={s.label} className="card px-3 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</div>
          <div className={`tnum mt-1 truncate text-[19px] font-bold leading-tight tracking-tight sm:text-[22px] ${s.tone ? tone[s.tone] : ''}`}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

/** "Needs attention" box. Red for things that are wrong or missing, amber for things to look at soon. */
export function AlertBox({ title, lines, tone = 'bad', icon, onClick }: { title: string; lines: ReactNode[]; tone?: 'bad' | 'warn'; icon?: ReactNode; onClick?: () => void }) {
  if (!lines.length) return null;
  const cls = tone === 'bad' ? 'bg-bad/10 text-bad' : 'bg-warn/12 text-warn';
  const body = (
    <>
      <div className="flex items-center gap-2 text-[14px] font-bold">
        {icon ?? <AlertTriangle size={18} />} {title}
      </div>
      {lines.map((l, i) => (
        <p key={i} className="text-[13.5px]">
          {l}
        </p>
      ))}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`mb-5 block w-full space-y-1.5 rounded-2xl p-4 text-left ${cls}`}>
      {body}
    </button>
  ) : (
    <div className={`mb-5 space-y-1.5 rounded-2xl p-4 ${cls}`}>{body}</div>
  );
}

/** Tiles / List switch. */
export function LayoutSwitch({ value, onChange }: { value: Layout; onChange: (l: Layout) => void }) {
  return (
    <div className="flex shrink-0 rounded-xl bg-muted p-1" role="group" aria-label="Layout">
      {(
        [
          ['tiles', 'Tiles', LayoutGrid],
          ['list', 'List', ListIcon],
        ] as const
      ).map(([v, label, Icon]) => (
        <button
          key={v}
          type="button"
          aria-label={label}
          aria-pressed={value === v}
          title={label}
          onClick={() => onChange(v)}
          className={`grid h-9 w-9 place-items-center rounded-lg transition ${value === v ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground'}`}
        >
          <Icon size={18} />
        </button>
      ))}
    </div>
  );
}

/** Search box, then filters, with the Tiles/List switch at the end of the first row. */
export function Toolbar({ search, layout, onLayout, children }: { search?: ReactNode; layout?: Layout; onLayout?: (l: Layout) => void; children?: ReactNode }) {
  const sw = layout && onLayout ? <LayoutSwitch value={layout} onChange={onLayout} /> : null;
  return (
    <div className="mb-4 space-y-2">
      {(search || sw) && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">{search}</div>
          {sw}
        </div>
      )}
      {children}
    </div>
  );
}

/** Filter chips with counts (scroll sideways on phones). */
export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0" style={{ scrollbarWidth: 'none' }}>
      {options.map((x) => (
        <button
          key={x.value}
          type="button"
          onClick={() => onChange(x.value)}
          aria-pressed={value === x.value}
          className={`chip shrink-0 px-3.5 py-2 text-[13px] ${value === x.value ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'}`}
        >
          {x.label}
          {x.count != null && <span className={`tnum ${value === x.value ? 'opacity-80' : 'opacity-60'}`}>{x.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TileGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

/**
 * One item as a tile: a badge (size, number…), a flag (Low, Due…), the big value, an optional level bar, two small
 * figures under it and a caption line. The same tile for reels, boxes, orders, customers and products.
 */
export function Tile({
  onClick,
  badge,
  flag,
  flagTone = 'warn',
  big,
  unit,
  pct,
  barTone = 'primary',
  left,
  right,
  caption,
  dim,
}: {
  onClick?: () => void;
  badge?: ReactNode;
  flag?: ReactNode;
  flagTone?: 'warn' | 'bad' | 'good' | 'muted';
  big: ReactNode;
  unit?: string;
  pct?: number;
  barTone?: 'primary' | 'warn' | 'bad' | 'muted';
  left?: ReactNode;
  right?: ReactNode;
  caption?: ReactNode;
  dim?: boolean;
}) {
  const flagCls = { warn: 'text-warn', bad: 'text-bad', good: 'text-good', muted: 'text-muted-foreground' }[flagTone];
  const barCls = { primary: 'bg-primary', warn: 'bg-warn', bad: 'bg-bad', muted: 'bg-muted-foreground/40' }[barTone];
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={`card flex min-w-0 flex-col p-3.5 text-left transition active:scale-[0.98] ${dim ? 'opacity-70' : ''}`}>
      <div className="flex min-w-0 items-center justify-between gap-2">
        {badge != null ? <span className="tnum inline-block max-w-full shrink-0 truncate rounded-md bg-primary/12 px-1.5 py-0.5 text-[12px] font-bold text-primary">{badge}</span> : <span />}
        {flag && <span className={`min-w-0 truncate text-right text-[11px] font-bold uppercase tracking-wide ${flagCls}`}>{flag}</span>}
      </div>
      <div className="tnum mt-3 truncate text-[24px] font-bold leading-none tracking-tight">
        {big}
        {unit && <span className="ml-1 text-[13px] font-semibold text-muted-foreground">{unit}</span>}
      </div>
      {pct != null && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full ${barCls}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
      )}
      {(left || right) && (
        <div className="tnum mt-1.5 flex justify-between gap-2 text-[11.5px] text-muted-foreground">
          <span className="truncate">{left}</span>
          <span className="shrink-0">{right}</span>
        </div>
      )}
      {caption && <div className="mt-2 truncate text-[12px] text-muted-foreground">{caption}</div>}
    </button>
  );
}

/** Dashed "add" tile at the end of a tile grid. */
export function AddTile({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="grid min-h-[140px] place-items-center rounded-2xl border-2 border-dashed border-border p-3 text-primary transition active:scale-[0.98] active:bg-muted/60">
      <span className="flex flex-col items-center gap-1.5 text-center text-[13.5px] font-semibold">
        <Plus size={22} />
        {label}
      </span>
    </button>
  );
}

/** "No results" line under the toolbar when filters hide everything. */
export function NoMatch({ text = 'Nothing matches.' }: { text?: string }) {
  return <p className="py-10 text-center text-muted-foreground">{text}</p>;
}
