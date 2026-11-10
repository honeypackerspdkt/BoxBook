import type { AppData } from '../types';
import { SyncEngine, newSyncState, type CloudApi, type Conflict, type SyncState } from './engine';
import { withUuidIds } from './migrate';
import { clearSyncState, loadSyncState, saveSyncState } from './state-store';
import type * as Sb from './supabase-api';

// The Supabase client is large: load it only when cloud sync is set up and used.
import { cloudConfigured } from './config';
const load = () => import('./supabase-api');
const lazyApi = (): CloudApi => {
  const api = async () => (await load()).supabaseApi();
  return {
    push: async (changes) => (await api()).push(changes),
    pull: async (since) => (await api()).pull(since),
    saveSettings: async (org, row, rev) => (await api()).saveSettings(org, row, rev),
    saveWebRules: async (org, row, rev) => (await api()).saveWebRules(org, row, rev),
    assignOrderNo: async (id) => (await api()).assignOrderNo(id),
    assignInvoiceNo: async (id) => (await api()).assignInvoiceNo(id),
    setCounter: async (kind, next) => (await api()).setCounter(kind, next),
  };
};
const supabaseDeps = {
  cloudConfigured,
  currentUser: async () => (await load()).currentUser(),
  myProfile: async () => (await load()).myProfile(),
  sendCode: async (email: string) => (await load()).sendCode(email),
  verifyCode: async (email: string, code: string) => (await load()).verifyCode(email, code),
  sendPhoneCode: async (mobile: string) => (await load()).sendPhoneCode(mobile),
  verifyPhoneCode: async (mobile: string, code: string) => (await load()).verifyPhoneCode(mobile, code),
  createOrganization: async (name: string, you: string) => (await load()).createOrganization(name, you),
  signOut: async () => (await load()).signOut(),
  accessToken: async () => (await load()).accessToken(),
  shopUrl: (import.meta.env.VITE_SHOP_URL || '').trim().replace(/\/+$/, ''),
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
  myInvitation: async () => (await load()).myInvitation(),
  acceptInvitation: async (name: string) => (await load()).acceptInvitation(name),
  team: async (orgId: string) => (await load()).team(orgId),
  invite: async (orgId: string, email: string, role: string, name: string) => (await load()).invite(orgId, email, role, name),
  revokeInvite: async (id: string) => (await load()).revokeInvite(id),
  updateMember: async (id: string, patch: { role?: string; is_active?: boolean }) => (await load()).updateMember(id, patch),
  setOrderStatus: async (id: string, status: string, delivery?: Record<string, unknown>) => (await load()).setOrderStatus(id, status, delivery),
  api: lazyApi,
};

/**
 * Cloud sync for the app, outside React. The store gives it the data; it runs the engine and tells the
 * screens what state it is in:
 *   off          not set up in this build (no Supabase project in .env.local)
 *   signed-out   set up, nobody signed in on this phone
 *   no-business  signed in, but this account has no business yet → "Create your business" (moves the phone's data)
 *   join         signed in to an existing business, this phone has not synced yet → download (and optionally upload)
 *   ready        syncing
 */
export type Phase = 'off' | 'signed-out' | 'no-business' | 'join' | 'ready';

export interface CloudStatus {
  phase: Phase;
  email: string;
  orgName: string;
  role: string;
  /** Open invitation for this e-mail (phase no-business). */
  invitation: { orgName: string; role: string } | null;
  pending: number;
  failing: number;
  conflicts: Conflict[];
  lastSyncAt: string | null;
  syncing: boolean;
  lastError: string;
}

export interface CloudHost {
  getData(): AppData;
  /** Replace the data without recording it as a local change (it came from the server or a migration). */
  setDataUntracked(next: AppData): void;
  /** Safety copy on the phone before big changes. */
  backupNow(): Promise<void>;
}

type Deps = typeof supabaseDeps & { loadSyncState: typeof loadSyncState; saveSyncState: typeof saveSyncState; clearSyncState: typeof clearSyncState };

export class CloudController {
  status: CloudStatus = { phase: 'off', email: '', orgName: '', role: '', invitation: null, pending: 0, failing: 0, conflicts: [], lastSyncAt: null, syncing: false, lastError: '' };
  private engine: SyncEngine | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private profile: Sb.Profile | null = null;
  private deps: Deps;

  constructor(
    private host: CloudHost,
    deps: Partial<Deps> = {},
  ) {
    this.deps = { ...supabaseDeps, loadSyncState, saveSyncState, clearSyncState, ...deps };
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private set(patch: Partial<CloudStatus>) {
    this.status = { ...this.status, ...patch };
    if (this.engine) {
      const s = this.engine.state;
      this.status = { ...this.status, pending: this.engine.pending, failing: this.engine.failing, conflicts: s.conflicts, lastSyncAt: s.lastSyncAt, role: s.role || this.status.role };
    }
    this.listeners.forEach((f) => f());
  }

  get active() {
    return this.status.phase === 'ready' && !!this.engine;
  }

  /** Draft number for an order made while cloud sync is on (the server gives the real one after upload). */
  draftOrderNumber(n: number): string | null {
    return this.active ? `D-${this.engine!.state.device}-${n}` : null;
  }

  private api(): CloudApi {
    return this.deps.api();
  }

  private startEngine(state: SyncState) {
    this.engine = new SyncEngine(this.api(), state, {
      getData: () => this.host.getData(),
      setData: (next) => this.host.setDataUntracked(next),
      saveState: (s) => this.deps.saveSyncState(s),
    });
  }

  /** At app start. Works offline: a phone that synced before goes straight to "ready". */
  async init() {
    if (!this.deps.cloudConfigured) return this.set({ phase: 'off' });
    const user = await this.deps.currentUser().catch(() => null);
    if (!user) return this.set({ phase: 'signed-out' });
    this.set({ email: user.email });
    const saved = await this.deps.loadSyncState();
    if (saved) {
      this.startEngine(saved);
      this.set({ phase: 'ready', role: saved.role });
      this.schedule(500);
      return;
    }
    await this.refreshProfile();
  }

  private async refreshProfile() {
    try {
      this.profile = await this.deps.myProfile();
      if (this.profile) return this.set({ phase: 'join', orgName: this.profile.orgName, role: this.profile.role, invitation: null, lastError: '' });
      const inv = await this.deps.myInvitation();
      this.set({ phase: 'no-business', invitation: inv ? { orgName: inv.orgName, role: inv.role } : null, lastError: '' });
    } catch (e) {
      // Could not reach the server: stay signed in, show the error and a "Try again" (Cloud screen).
      this.set({ phase: 'no-business', invitation: null, lastError: friendly(msg(e)) });
    }
  }

  /** Look up this account's business / invitation again (after an error). */
  retry() {
    return this.refreshProfile();
  }

  sendCode(email: string) {
    return this.deps.sendCode(email);
  }

  sendPhoneCode(mobile: string) {
    return this.deps.sendPhoneCode(mobile);
  }

  async verifyPhoneCode(mobile: string, code: string) {
    const user = await this.deps.verifyPhoneCode(mobile, code);
    this.set({ email: user?.phone ? `+${user.phone.replace(/^\+/, '')}` : mobile });
    await this.refreshProfile();
  }

  async verifyCode(email: string, code: string) {
    const user = await this.deps.verifyCode(email, code);
    this.set({ email: user?.email || email });
    await this.refreshProfile();
  }

  /** First time: create the business in the cloud and move everything on this phone there. */
  async createBusiness(name: string, yourName: string) {
    await this.host.backupNow();
    const orgId = await this.deps.createOrganization(name, yourName);
    const { data } = withUuidIds(this.host.getData());
    this.host.setDataUntracked(data);
    const api = this.api();
    await api.setCounter('order', Math.max(1, data.settings.nextOrderNo));
    await api.setCounter('invoice', Math.max(1, data.settings.nextInvoiceNo));
    const state = newSyncState(orgId, 'Administrator');
    this.startEngine(state);
    this.engine!.queueAll();
    await this.deps.saveSyncState(state);
    this.set({ phase: 'ready', orgName: name, role: 'Administrator' });
    await this.syncNow();
  }

  /** Accept the owner's invitation (signed in with the invited e-mail), then join that business. */
  async acceptInvitation(yourName: string) {
    await this.deps.acceptInvitation(yourName);
    await this.refreshProfile();
  }

  /* ───────────── staff (owner) ───────────── */
  private org() {
    if (!this.engine) throw new Error('Cloud sync is off');
    return this.engine.state.orgId;
  }
  team() {
    return this.deps.team(this.org());
  }
  invite(email: string, role: string, name: string) {
    return this.deps.invite(this.org(), email, role, name);
  }
  revokeInvite(id: string) {
    return this.deps.revokeInvite(id);
  }
  updateMember(id: string, patch: { role?: string; is_active?: boolean }) {
    return this.deps.updateMember(id, patch);
  }

  /**
   * Razorpay payment link for the amount due on an order, made by the website's server (payment-link function).
   * The order is uploaded first; the server works out the amount. Returns the link to send to the customer.
   */
  async paymentLink(orderId: string): Promise<{ url: string; amount: number; orderNumber: string }> {
    if (!this.engine) throw new Error('Turn on cloud sync first (More → Cloud sync).');
    if (!this.deps.shopUrl) throw new Error('Online payment is not set up in this build.');
    await this.syncNow();
    if (this.engine.state.outbox[`orders:${orderId}`] || !this.engine.state.base[`orders:${orderId}`]) throw new Error('The order has not reached the cloud yet. Check the internet connection and try again.');
    const token = await this.deps.accessToken();
    if (!token) throw new Error('Please sign in again (More → Cloud sync).');
    const r = await this.deps.fetch(`${this.deps.shopUrl}/.netlify/functions/payment-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ orderId }),
    });
    const out = (await r.json().catch(() => ({}))) as { url?: string; amount?: number; orderNumber?: string; error?: string };
    if (!r.ok || !out.url) throw new Error(out.error || 'Could not make the payment link.');
    return { url: out.url, amount: out.amount || 0, orderNumber: out.orderNumber || '' };
  }

  /** Production / dispatch move an order on through the server's checked function, then pull the result. */
  async setOrderStatus(orderId: string, status: string, delivery?: Record<string, unknown>) {
    await this.deps.setOrderStatus(orderId, status, delivery);
    await this.syncNow();
  }

  /**
   * This phone joins a business that is already in the cloud.
   * 'replace': start from the cloud data (this phone's data is backed up first). 'merge': also upload this phone's records.
   */
  async join(mode: 'replace' | 'merge') {
    if (!this.profile) throw new Error('Not signed in to a business');
    await this.host.backupNow();
    const d = this.host.getData();
    const next = mode === 'replace' ? { ...d, customers: [], orders: [], boxes: [], web: { ...d.web, zones: [] } } : withUuidIds(d).data;
    this.host.setDataUntracked(next);
    const state = newSyncState(this.profile.orgId, this.profile.role);
    this.startEngine(state);
    if (mode === 'merge') {
      this.engine!.queueAll();
      // Company settings and the price list come from the cloud, not from this phone.
      delete state.outbox.org_settings;
      delete state.outbox.price_rules;
    }
    await this.deps.saveSyncState(state);
    this.set({ phase: 'ready', orgName: this.profile.orgName, role: this.profile.role });
    await this.syncNow();
  }

  /** Called by the store after every local change. */
  track(prev: AppData, next: AppData) {
    if (!this.engine) return;
    this.engine.track(prev, next);
    this.set({});
    this.schedule();
  }

  schedule(ms = 2000) {
    if (!this.active) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), ms);
  }

  async syncNow() {
    if (!this.engine) return;
    this.set({ syncing: true });
    try {
      const r = await this.engine.sync();
      this.set({ syncing: false, lastError: r.errors[0] ? friendly(r.errors[0]) : '' });
    } catch (e) {
      this.set({ syncing: false, lastError: friendly(msg(e)) });
    }
  }

  async assignInvoiceNo(orderId: string) {
    if (!this.engine) throw new Error('Cloud sync is off');
    try {
      return await this.engine.assignInvoiceNo(orderId);
    } finally {
      this.set({});
    }
  }

  clearConflicts() {
    if (!this.engine) return;
    this.engine.state.conflicts = [];
    void this.deps.saveSyncState(this.engine.state);
    this.set({});
  }

  /** Sign out on this phone. Its business data is removed only when `wipe` is set (after a backup). */
  async signOut(wipe: boolean) {
    clearTimeout(this.timer);
    if (wipe) {
      await this.host.backupNow();
      const d = this.host.getData();
      this.host.setDataUntracked({ ...d, customers: [], orders: [], boxes: [], web: { ...d.web, zones: [] } });
    }
    this.engine = null;
    await this.deps.clearSyncState();
    await this.deps.signOut().catch(() => {});
    this.profile = null;
    this.set({ phase: 'signed-out', email: '', orgName: '', role: '', invitation: null, pending: 0, failing: 0, conflicts: [], lastSyncAt: null, lastError: '' });
  }
}

const msg = (e: unknown) => String((e as Error)?.message || e);
const friendly = (m: string) => (/fetch|network|load failed|offline/i.test(m) ? 'No internet connection. Changes are saved on this phone and will sync later.' : m);
