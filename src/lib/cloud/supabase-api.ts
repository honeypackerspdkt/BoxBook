import type { SupabaseClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';
import { createHubClient } from '@rajesh-hub/supabase-kit';
import type { CloudApi, PullResult, PushResult, SaveResult } from './engine';

/** Cloud sync is available in this build when the Supabase project is set (.env.local). */
export const cloudUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
export const cloudConfigured = Boolean(cloudUrl && anonKey);

// Same idea as @rajesh-hub/native capacitorSupabaseStorage (that package targets Capacitor 8; BoxBook is on 7):
// keep the sign-in in native storage, which survives the WebView clearing localStorage.
const sessionStorage = {
  getItem: async (key: string) => (await Preferences.get({ key })).value,
  setItem: (key: string, value: string) => Preferences.set({ key, value }),
  removeItem: (key: string) => Preferences.remove({ key }),
};

let client: SupabaseClient | null = null;
export function getClient(): SupabaseClient {
  if (!cloudConfigured) throw new Error('Cloud sync is not set up in this build');
  client ??= createHubClient(cloudUrl, anonKey, { storage: sessionStorage, passkeys: false }) as unknown as SupabaseClient;
  return client;
}

const fail = (e: { message?: string } | null | undefined): never => {
  throw new Error(e?.message || 'Cloud request failed');
};

/* ───────────── sign-in with a 6-digit e-mail code ───────────── */

export async function sendCode(email: string) {
  const { error } = await getClient().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
  if (error) fail(error);
}

export async function verifyCode(email: string, code: string) {
  const { data, error } = await getClient().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
  if (error) fail(error);
  return data.user;
}

export async function currentUser(): Promise<{ id: string; email: string } | null> {
  if (!cloudConfigured) return null;
  const { data } = await getClient().auth.getSession();
  const u = data.session?.user;
  return u ? { id: u.id, email: u.email || u.phone || '' } : null;
}

export async function signOut() {
  await getClient().auth.signOut();
}

export interface Profile {
  orgId: string;
  orgName: string;
  role: string;
  name: string;
}

/** The signed-in person's staff profile, or null if they have no business yet. */
export async function myProfile(): Promise<Profile | null> {
  const sb = getClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await sb.from('user_profiles').select('organization_id, role, display_name, is_active, organizations(name)').eq('id', auth.user.id).maybeSingle();
  if (error) fail(error);
  if (!data || !data.is_active) return null;
  const org = data.organizations as unknown as { name: string } | null;
  return { orgId: data.organization_id, orgName: org?.name || '', role: data.role, name: data.display_name };
}

export async function createOrganization(name: string, displayName: string): Promise<string> {
  const { data, error } = await getClient().rpc('create_organization', { p_name: name, p_display_name: displayName });
  if (error) fail(error);
  return data as string;
}

/* ───────────── the sync API (same calls as pg-api.ts in the integration test) ───────────── */

async function saveOrgRow(sb: SupabaseClient, table: 'org_settings' | 'price_rules', orgId: string, row: Record<string, unknown>, rev: number): Promise<SaveResult> {
  const { data, error } = await sb.from(table).update({ ...row, rev }).eq('org_id', orgId).eq('rev', rev).select().maybeSingle();
  if (error) fail(error);
  if (data) return { status: 'ok', row: data };
  const cur = await sb.from(table).select().eq('org_id', orgId).maybeSingle();
  if (cur.error) fail(cur.error);
  if (!cur.data) throw new Error(`${table}: not allowed`);
  return { status: 'conflict', row: cur.data };
}

export function supabaseApi(sb: SupabaseClient = getClient()): CloudApi {
  const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) fail(error);
    return data as T;
  };
  return {
    push: (changes) => rpc<PushResult[]>('sync_push', { changes }),
    pull: (since) => rpc<PullResult>('sync_pull', { p_since: since }),
    saveSettings: (orgId, row, rev) => saveOrgRow(sb, 'org_settings', orgId, row, rev),
    saveWebRules: (orgId, row, rev) => saveOrgRow(sb, 'price_rules', orgId, row, rev),
    assignOrderNo: (id) => rpc<string>('assign_order_no', { p_order: id }),
    assignInvoiceNo: (id) => rpc<string>('assign_invoice_no', { p_order: id }),
    setCounter: async (kind, next) => void (await rpc('set_counter', { p_kind: kind, p_next: next })),
  };
}
