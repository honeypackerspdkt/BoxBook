import type { AppData } from '../types';
import { uid } from '../format';
import { applyRow, applySettingsRow, applyWebRulesRow, keyOf, rowsOf, sameRow, settingsRow, splitKey, TABLES, webRulesRow, type Entry, type Row } from './mapping';
import { merge3 } from './merge';

/* ─────────────────────────────── server interface ─────────────────────────────── */

export interface PushResult {
  id: string;
  status: 'ok' | 'conflict' | 'error';
  row?: Row;
  message?: string;
}
export interface PullResult {
  server_time: string;
  org_id: string;
  role: string;
  settings: Record<string, unknown> | null;
  price_rules: Record<string, unknown> | null;
  [table: string]: unknown;
}
export type SaveResult = { status: 'ok'; row: Record<string, unknown> } | { status: 'conflict'; row: Record<string, unknown> };

/** What the engine needs from Supabase (supabase-api.ts), or from Postgres directly in the integration test. */
export interface CloudApi {
  push(changes: { table: string; row: Record<string, unknown> }[]): Promise<PushResult[]>;
  pull(since: string | null): Promise<PullResult>;
  saveSettings(orgId: string, row: Record<string, unknown>, rev: number): Promise<SaveResult>;
  saveWebRules(orgId: string, row: Record<string, unknown>, rev: number): Promise<SaveResult>;
  assignOrderNo(orderId: string): Promise<string>;
  assignInvoiceNo(orderId: string): Promise<string>;
  setCounter(kind: 'order' | 'invoice', next: number): Promise<void>;
}

/* ─────────────────────────────── state kept on the device ─────────────────────────────── */

export interface Conflict {
  at: string;
  key: string;
  field: string;
  kept: unknown;
  lost: unknown;
}

export interface SyncState {
  v: 1;
  orgId: string;
  role: string;
  /** Short tag for this device, used in draft order numbers made offline. */
  device: string;
  lastPulledAt: string | null;
  lastSyncAt: string | null;
  /** Last copy agreed with the server, per row key (includes rev). */
  base: Record<string, Record<string, unknown>>;
  /** Rows changed here and not yet accepted by the server. seq goes up on every new local change. */
  outbox: Record<string, { seq: number; op: 'upsert' | 'delete'; error?: string; tries?: number }>;
  seq: number;
  conflicts: Conflict[];
}

export const SETTINGS_KEY = 'org_settings';
export const RULES_KEY = 'price_rules';
const OFFICE = ['Administrator', 'Sales', 'Accounts'];
const MAX_CONFLICTS = 200;

export function newSyncState(orgId: string, role: string): SyncState {
  return { v: 1, orgId, role, device: uid().slice(0, 4), lastPulledAt: null, lastSyncAt: null, base: {}, outbox: {}, seq: 0, conflicts: [] };
}

/** Rows that differ between two versions of the app data (what to push). */
export function changedKeys(prev: AppData, next: AppData): { key: string; op: 'upsert' | 'delete' }[] {
  const out: { key: string; op: 'upsert' | 'delete' }[] = [];
  const a = rowsOf(prev);
  const b = rowsOf(next);
  for (const [k, e] of b) {
    const old = a.get(k);
    if (!old || !sameRow(e.row, old.row)) out.push({ key: k, op: 'upsert' });
  }
  for (const k of a.keys()) if (!b.has(k)) out.push({ key: k, op: 'delete' });
  if (!sameRow(settingsRow(next.settings), settingsRow(prev.settings))) out.push({ key: SETTINGS_KEY, op: 'upsert' });
  if (!sameRow(webRulesRow(next.web), webRulesRow(prev.web))) out.push({ key: RULES_KEY, op: 'upsert' });
  return out;
}

/* ─────────────────────────────── the engine ─────────────────────────────── */

export interface EngineIO {
  getData(): AppData;
  /** Replace the app data with a version that includes changes from the server (must not be tracked again). */
  setData(next: AppData): void;
  saveState(s: SyncState): Promise<void>;
  now?: () => string;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
}

const tableOrder = (key: string) => {
  if (key === SETTINGS_KEY || key === RULES_KEY) return -1;
  return TABLES.indexOf(splitKey(key).table as (typeof TABLES)[number]);
};

export class SyncEngine {
  private running: Promise<SyncReport> | null = null;

  constructor(
    private api: CloudApi,
    public state: SyncState,
    private io: EngineIO,
  ) {}

  private now() {
    return this.io.now ? this.io.now() : new Date().toISOString();
  }

  get canWrite() {
    return OFFICE.includes(this.state.role);
  }
  get pending() {
    return Object.keys(this.state.outbox).length;
  }
  get failing() {
    return Object.values(this.state.outbox).filter((e) => e.error).length;
  }

  /** Called after every local change: queue what changed. */
  track(prev: AppData, next: AppData) {
    const keys = changedKeys(prev, next);
    if (!keys.length) return;
    for (const { key, op } of keys) {
      this.state.seq += 1;
      this.state.outbox[key] = { seq: this.state.seq, op };
    }
    void this.io.saveState(this.state);
  }

  /** Queue every record (first upload after moving the phone's data to the cloud). */
  queueAll() {
    const d = this.io.getData();
    for (const key of [...rowsOf(d).keys(), SETTINGS_KEY, RULES_KEY]) {
      this.state.seq += 1;
      this.state.outbox[key] = { seq: this.state.seq, op: 'upsert' };
    }
  }

  /** Push, pull, and push again if the pull merged anything. One run at a time. */
  sync(): Promise<SyncReport> {
    if (this.running) return this.running;
    this.running = (async () => {
      const report: SyncReport = { pushed: 0, pulled: 0, conflicts: 0, errors: [] };
      try {
        await this.push(report);
        await this.pull(report);
        if (this.pending && this.canWrite) await this.push(report);
        this.state.lastSyncAt = this.now();
      } finally {
        await this.io.saveState(this.state);
        this.running = null;
      }
      return report;
    })();
    return this.running;
  }

  private remember(conflicts: { field: string; kept: unknown; lost: unknown }[], key: string, report: SyncReport) {
    if (!conflicts.length) return;
    report.conflicts += conflicts.length;
    const at = this.now();
    this.state.conflicts = [...conflicts.map((c) => ({ ...c, key, at })), ...this.state.conflicts].slice(0, MAX_CONFLICTS);
  }

  private applyServerRow(table: string, row: Row) {
    const d = this.io.getData();
    const next = applyRow(d, table, row);
    if (next !== d) this.io.setData(next);
  }

  /* ───────────── push ───────────── */

  private async push(report: SyncReport) {
    if (!this.canWrite) return;
    for (let round = 0; round < 3 && this.pending; round++) {
      const keys = Object.keys(this.state.outbox).sort((a, b) => tableOrder(a) - tableOrder(b));
      const seqs = new Map(keys.map((k) => [k, this.state.outbox[k].seq]));
      const done = (k: string) => {
        if (this.state.outbox[k]?.seq === seqs.get(k)) delete this.state.outbox[k];
      };
      let retry = false;

      if (keys.includes(SETTINGS_KEY)) retry = (await this.pushOrgRow(SETTINGS_KEY, report, done)) || retry;
      if (keys.includes(RULES_KEY)) retry = (await this.pushOrgRow(RULES_KEY, report, done)) || retry;

      const rows = rowsOf(this.io.getData());
      const changes: { key: string; table: string; row: Record<string, unknown> }[] = [];
      for (const k of keys) {
        if (k === SETTINGS_KEY || k === RULES_KEY) continue;
        const { table, id } = splitKey(k);
        const base = this.state.base[k];
        const rev = Number(base?.rev ?? 0);
        const local: Entry | undefined = rows.get(k);
        if (!local || this.state.outbox[k].op === 'delete') {
          if (!base) {
            done(k); // never reached the server: nothing to delete
            continue;
          }
          changes.push({ key: k, table, row: { id, org_id: this.state.orgId, rev, deleted_at: this.now() } });
        } else {
          const row: Record<string, unknown> = { ...local.row, org_id: this.state.orgId, rev, deleted_at: null };
          if (row.created_at == null) delete row.created_at;
          changes.push({ key: k, table, row });
        }
      }
      if (!changes.length) break;

      let results: PushResult[];
      try {
        results = await this.api.push(changes.map(({ table, row }) => ({ table, row })));
      } catch (e) {
        report.errors.push(String((e as Error)?.message || e));
        return; // offline or server down: keep everything queued
      }
      const draftOrders: string[] = [];
      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        const r = results[i];
        if (!r) continue;
        if (r.status === 'ok' && r.row) {
          this.state.base[c.key] = r.row;
          done(c.key);
          report.pushed += 1;
          if (c.table === 'orders' && String(r.row.number).startsWith('D-') && r.row.deleted_at == null) draftOrders.push(r.row.id);
        } else if (r.status === 'conflict' && r.row) {
          retry = this.resolve(c.key, c.table, r.row as Row, report) || retry;
        } else {
          const e = this.state.outbox[c.key];
          if (e) {
            e.error = r.message || 'error';
            e.tries = (e.tries || 0) + 1;
          }
          report.errors.push(`${c.key}: ${r.message}`);
        }
      }
      for (const id of draftOrders) await this.assignOrderNumber(id, report);
      if (!retry) break;
    }
  }

  /** Server copy differs from what we edited: merge, keep the server's rev for the next push. Returns true to push again. */
  private resolve(key: string, table: string, server: Row, report: SyncReport): boolean {
    const base = this.state.base[key];
    this.state.base[key] = server;
    const local = rowsOf(this.io.getData()).get(key);
    if (server.deleted_at != null) {
      // Deleted elsewhere: the deletion wins; the lost record is listed for the owner.
      if (local) this.remember([{ field: '(deleted on another device)', kept: null, lost: local.row }], key, report);
      this.applyServerRow(table, server);
      delete this.state.outbox[key];
      return false;
    }
    if (!local) {
      // We deleted it, the server changed it: still delete (push again with the server's rev).
      return true;
    }
    const localTime = Date.parse(String(this.findUpdatedAt(table, server.id) ?? 0));
    const serverTime = Date.parse(String(server.updated_at ?? 0));
    const { merged, conflicts } = merge3(base, local.row, server, localTime > serverTime);
    this.remember(conflicts, key, report);
    this.applyServerRow(table, { ...server, ...merged, deleted_at: null } as Row);
    if (sameRow(local.row, server) || sameRow(merged, server)) {
      delete this.state.outbox[key];
      return false;
    }
    return true;
  }

  private findUpdatedAt(table: string, id: string): string | undefined {
    const d = this.io.getData();
    if (table === 'customers') return d.customers.find((x) => x.id === id)?.updatedAt;
    if (table === 'boxes') return d.boxes.find((x) => x.id === id)?.updatedAt;
    if (table === 'reels') return d.reels.find((x) => x.id === id)?.updatedAt;
    if (table === 'stock_moves') return d.stockMoves.find((x) => x.id === id)?.updatedAt;
    const o = table === 'orders' ? d.orders.find((x) => x.id === id) : d.orders.find((x) => x.items.some((i) => i.id === id) || x.payments.some((p) => p.id === id));
    return o?.updatedAt;
  }

  private async pushOrgRow(key: string, report: SyncReport, done: (k: string) => void): Promise<boolean> {
    if (this.state.role !== 'Administrator') {
      done(key); // only the owner changes company settings / web prices; the server copy comes back on pull
      return false;
    }
    const d = this.io.getData();
    const isSettings = key === SETTINGS_KEY;
    const local = isSettings ? settingsRow(d.settings) : webRulesRow(d.web);
    const base = this.state.base[key];
    const rev = Number(base?.rev ?? 1);
    try {
      const res = isSettings ? await this.api.saveSettings(this.state.orgId, local, rev) : await this.api.saveWebRules(this.state.orgId, local, rev);
      this.state.base[key] = res.row;
      if (res.status === 'ok') {
        done(key);
        report.pushed += 1;
        return false;
      }
      const { merged, conflicts } = merge3(base, local, res.row, true);
      this.remember(conflicts, key, report);
      this.applyOrgRow(key, merged);
      return true;
    } catch (e) {
      report.errors.push(`${key}: ${String((e as Error)?.message || e)}`);
      return false;
    }
  }

  private applyOrgRow(key: string, row: Record<string, unknown>) {
    const d = this.io.getData();
    if (key === SETTINGS_KEY) this.io.setData({ ...d, settings: applySettingsRow(d.settings, row) });
    else this.io.setData({ ...d, web: applyWebRulesRow(d.web, row) });
  }

  /* ───────────── pull ───────────── */

  private async pull(report: SyncReport) {
    let res: PullResult;
    try {
      res = await this.api.pull(this.state.lastPulledAt);
    } catch (e) {
      report.errors.push(String((e as Error)?.message || e));
      return;
    }
    this.state.role = res.role || this.state.role;

    for (const [key, row] of [[SETTINGS_KEY, res.settings], [RULES_KEY, res.price_rules]] as const) {
      if (!row) continue;
      const base = this.state.base[key];
      if (base && Number(base.rev) >= Number(row.rev)) continue;
      if (this.state.outbox[key]) {
        const d = this.io.getData();
        const local = key === SETTINGS_KEY ? settingsRow(d.settings) : webRulesRow(d.web);
        const { merged, conflicts } = merge3(base, local, row, true);
        this.remember(conflicts, key, report);
        this.applyOrgRow(key, merged);
      } else this.applyOrgRow(key, row);
      this.state.base[key] = row;
      report.pulled += 1;
    }

    for (const table of TABLES) {
      let rows = (res[table] as Row[] | undefined) || [];
      if (table === 'order_items') rows = [...rows].sort((a, b) => Number(a.position) - Number(b.position));
      for (const row of rows) {
        const key = keyOf(table, row.id);
        const base = this.state.base[key];
        if (base && Number(base.rev) >= Number(row.rev)) continue; // already have it (pull overlaps on purpose)
        if (this.state.outbox[key]) {
          // Changed here too: merge now; the push sends the result with the server's rev.
          this.resolve(key, table, row, report);
          if (this.state.outbox[key]) this.state.outbox[key].seq = ++this.state.seq;
        } else {
          this.applyServerRow(table, row);
          this.state.base[key] = row;
        }
        report.pulled += 1;
      }
    }
    this.state.lastPulledAt = res.server_time;
  }

  /* ───────────── numbers ───────────── */

  private async assignOrderNumber(orderId: string, report: SyncReport) {
    try {
      const number = await this.api.assignOrderNo(orderId);
      this.bumpOrder(orderId, { number });
    } catch (e) {
      report.errors.push(`order number: ${String((e as Error)?.message || e)}`);
    }
  }

  /** The server changed one order field (and its rev); mirror it so the next push is not a conflict. */
  private bumpOrder(orderId: string, patch: { number?: string; invoiceNo?: string }) {
    const key = keyOf('orders', orderId);
    const base = this.state.base[key];
    if (base) this.state.base[key] = { ...base, rev: Number(base.rev) + 1, ...(patch.number ? { number: patch.number } : {}), ...(patch.invoiceNo ? { invoice_no: patch.invoiceNo } : {}) };
    const d = this.io.getData();
    this.io.setData({ ...d, orders: d.orders.map((o) => (o.id === orderId ? { ...o, ...patch } : o)) });
  }

  /** GST invoice number, from the server only (never repeated). Pushes the order first. */
  async assignInvoiceNo(orderId: string): Promise<string> {
    const existing = this.io.getData().orders.find((o) => o.id === orderId)?.invoiceNo;
    if (existing) return existing;
    await this.sync();
    const key = keyOf('orders', orderId);
    if (this.state.outbox[key] || !this.state.base[key]) throw new Error('The order has not reached the cloud yet. Check the internet connection and try again.');
    const no = await this.api.assignInvoiceNo(orderId);
    this.bumpOrder(orderId, { invoiceNo: no });
    await this.io.saveState(this.state);
    return no;
  }
}
