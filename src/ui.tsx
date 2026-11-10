import { useEffect, useState, type ReactNode, type InputHTMLAttributes } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
  Sheet as HubSheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Switch,
  useIsMobile,
} from '@rajesh-hub/ui';
import { useNav } from './nav';
import type { OrderStatus } from './lib/types';

export function Header({ title, subtitle, back, onBack, actions, large }: { title: string; subtitle?: string; back?: boolean; /** Replaces the default back action (e.g. to ask about unsaved changes). */ onBack?: () => void; actions?: ReactNode; large?: boolean }) {
  const nav = useNav();
  return (
    <header className="pt-safe sticky top-0 z-20 border-b border-border/60 bg-background/90 backdrop-blur-xl">
      <div className={`mx-auto flex w-full max-w-2xl items-center gap-2 px-4 lg:max-w-5xl lg:px-8 ${large ? 'h-16' : 'h-14'}`}>
        {back && (
          <button aria-label="Back" onClick={onBack ?? nav.back} className="-ml-2 grid h-10 w-10 place-items-center rounded-full active:bg-muted">
            <ChevronLeft size={24} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className={`truncate font-bold tracking-tight ${large ? 'text-[26px]' : 'text-[18px]'}`}>{title}</h1>
          {subtitle && <p className="-mt-0.5 truncate text-[12px] text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
    </header>
  );
}

export function IconBtn({ label, onClick, children, tone }: { label: string; onClick: () => void; children: ReactNode; tone?: 'kraft' }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-10 w-10 place-items-center rounded-full active:bg-muted ${tone === 'kraft' ? 'text-primary' : 'text-foreground'}`}
    >
      {children}
    </button>
  );
}

export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-2xl px-4 pb-32 pt-4 lg:max-w-5xl lg:px-8 lg:pb-12 lg:pt-6 ${className}`}>{children}</main>;
}

export function Section({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      {(title || action) && (
        <div className="mb-2 flex items-end justify-between px-1">
          {title && <h2 className="text-[13px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

// The hub Input is desktop-sized; phones get the larger touch size BoxBook's forms use.
const INPUT = 'h-12 rounded-xl bg-card px-3.5 py-3 text-[15px] dark:bg-card';

type NumProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number;
  onValue: (n: number) => void;
  suffix?: string;
};

/** Numeric input that keeps what the user typed (e.g. "12.") while exposing a number. */
export function NumInput({ value, onValue, suffix, className = '', ...rest }: NumProps) {
  const [text, setText] = useState(value ? String(value) : '');
  useEffect(() => {
    if ((parseFloat(text) || 0) !== (value || 0)) setText(value ? String(value) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      <Input
        {...rest}
        inputMode="decimal"
        className={`${INPUT} tnum ${suffix ? 'pr-12' : ''} ${className}`}
        value={text}
        placeholder={rest.placeholder ?? '0'}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.]/g, '');
          setText(t);
          onValue(parseFloat(t) || 0);
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl bg-muted p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg py-2 text-[14px] font-semibold transition ${value === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <div className="flex w-full items-center gap-3 py-1">
      <span className="flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {desc && <span className="block text-[12.5px] text-muted-foreground">{desc}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} className="h-7 w-12 data-[size=default]:h-7 data-[size=default]:w-12 [&>span]:data-[size=default]:size-6" />
    </div>
  );
}

export function Row({ icon, title, sub, right, onClick, chevron = true }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; onClick?: () => void; chevron?: boolean }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-muted/70 disabled:active:bg-transparent">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{title}</div>
        {sub && <div className="truncate text-[13px] text-muted-foreground">{sub}</div>}
      </div>
      {right}
      {onClick && chevron && <ChevronRight size={18} className="shrink-0 text-muted-foreground/70" />}
    </button>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <div className="card divide-y divide-border/60 overflow-hidden">{children}</div>;
}

export function Avatar({ text, tone = 0 }: { text: string; tone?: number }) {
  const tones = ['bg-primary/15 text-primary', 'bg-good/15 text-good', 'bg-warn/15 text-warn', 'bg-bad/12 text-bad', 'bg-foreground/10 text-foreground'];
  return <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[14px] font-bold ${tones[tone % tones.length]}`}>{text}</span>;
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-primary/15 text-primary">{icon}</div>
      <h3 className="text-[17px] font-bold">{title}</h3>
      <p className="mt-1 max-w-xs text-[14px] text-muted-foreground">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const nav = useNav();
  useEffect(() => {
    if (!open) return;
    return nav.onBack(() => {
      onClose();
      return true;
    });
  }, [open, onClose, nav]);
  // Phones get a bottom sheet; tablets and desktops get a panel sliding in from the right.
  const phone = useIsMobile();
  return (
    <HubSheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={phone ? 'bottom' : 'right'}
        className={phone ? 'pb-safe mx-auto max-h-[88vh] max-w-2xl gap-0 overflow-y-auto rounded-t-3xl' : 'w-full gap-0 overflow-y-auto sm:max-w-md'}
      >
        <SheetHeader className="px-5 pb-2 pt-5">
          <SheetTitle className="text-[18px] font-bold">{title}</SheetTitle>
          <SheetDescription className="sr-only">{title}</SheetDescription>
        </SheetHeader>
        <div className="px-5 pb-6 pt-2">{children}</div>
      </SheetContent>
    </HubSheet>
  );
}

export function Confirm({ open, title, text, confirmLabel = 'Delete', danger = true, onConfirm, onClose }: { open: boolean; title: string; text: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onClose: () => void }) {
  const nav = useNav();
  useEffect(() => {
    if (!open) return;
    return nav.onBack(() => {
      onClose();
      return true;
    });
  }, [open, onClose, nav]);
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">{text}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={danger ? 'destructive' : 'default'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export const STATUS: Record<OrderStatus, { label: string; cls: string; dot: string }> = {
  quote: { label: 'Quotation', cls: 'bg-foreground/8 text-muted-foreground', dot: 'bg-muted-foreground' },
  confirmed: { label: 'Confirmed', cls: 'bg-primary/15 text-primary', dot: 'bg-primary' },
  production: { label: 'In production', cls: 'bg-warn/15 text-warn', dot: 'bg-warn' },
  ready: { label: 'Ready', cls: 'bg-good/15 text-good', dot: 'bg-good' },
  delivered: { label: 'Delivered', cls: 'bg-good/10 text-good/80', dot: 'bg-good/70' },
  cancelled: { label: 'Cancelled', cls: 'bg-bad/10 text-bad', dot: 'bg-bad' },
};
export const STATUS_FLOW: OrderStatus[] = ['quote', 'confirmed', 'production', 'ready', 'delivered'];

export function StatusChip({ s }: { s: OrderStatus }) {
  return (
    <span className={`chip ${STATUS[s].cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS[s].dot}`} />
      {STATUS[s].label}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'kraft' | 'bad' | 'good' }) {
  const c = tone === 'kraft' ? 'text-primary' : tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-foreground';
  return (
    <div className="card p-4">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tnum mt-1 truncate text-[22px] font-bold tracking-tight ${c}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <Input className={`${INPUT} pl-10`} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function Fab({ label, onClick, icon }: { label: string; onClick: () => void; icon: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-4 z-30 lg:bottom-8 lg:right-8 flex items-center gap-2 rounded-2xl bg-primary px-5 py-3.5 text-[15px] font-bold text-white shadow-lift active:scale-95"
    >
      {icon}
      {label}
    </button>
  );
}
