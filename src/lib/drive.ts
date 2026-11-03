/**
 * Google Drive backup. Files go to a "BoxBook Backups" folder in the user's own Drive; the app only sees
 * files it created itself (scope drive.file), so nothing else in their Drive is readable.
 *
 * Sign-in:
 *  - web: Google Identity Services token flow (popup). Tokens last an hour and cannot be refreshed silently.
 *  - phone: system browser + OAuth code flow with PKCE and a custom-scheme redirect, which gives a refresh
 *    token, so the daily backup can upload without asking again.
 *
 * The OAuth client ids are public values supplied at build time (see CLAUDE.md → Google Drive backup).
 */
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { normalize } from './storage';
import type { AppData } from './types';

const SCOPE = 'https://www.googleapis.com/auth/drive.file email';
const FOLDER_NAME = 'BoxBook Backups';
const AUTH_KEY = 'boxbook-drive-auth';
const FOLDER_KEY = 'boxbook-drive-folder';
const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export class DriveError extends Error {
  constructor(
    message: string,
    public code: 'not-configured' | 'not-signed-in' | 'cancelled' | 'api' = 'api',
  ) {
    super(message);
  }
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size: number;
}

interface Auth {
  access: string;
  /** ms since epoch */
  expires: number;
  refresh?: string;
  email?: string;
}

// ---------- configuration ----------

type Platform = 'web' | 'android' | 'ios';
const platform = (): Platform => {
  const p = Capacitor.getPlatform();
  return p === 'android' || p === 'ios' ? p : 'web';
};

export function clientId(p: Platform = platform()): string {
  const env = import.meta.env;
  const id = p === 'android' ? env.VITE_GOOGLE_ANDROID_CLIENT_ID : p === 'ios' ? env.VITE_GOOGLE_IOS_CLIENT_ID : env.VITE_GOOGLE_WEB_CLIENT_ID;
  return (id || '').trim();
}
export const driveConfigured = () => !!clientId();

/** com.googleusercontent.apps.1234-abcd  (the scheme Google uses to hand the result back to the app) */
export const redirectScheme = (id: string) => 'com.googleusercontent.apps.' + id.replace(/\.apps\.googleusercontent\.com$/, '');
export const redirectUri = (id: string) => `${redirectScheme(id)}:/oauth2redirect`;

// ---------- stored session ----------

function readAuth(): Auth | null {
  try {
    const s = localStorage.getItem(AUTH_KEY);
    return s ? (JSON.parse(s) as Auth) : null;
  } catch {
    return null;
  }
}
function writeAuth(a: Auth | null) {
  try {
    if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a));
    else localStorage.removeItem(AUTH_KEY);
  } catch {
    /* storage blocked */
  }
}

/** The connected Google account, or null. A session with a refresh token (phone) stays connected. */
export function driveSession(): { email: string; canRefresh: boolean; active: boolean } | null {
  const a = readAuth();
  if (!a) return null;
  return { email: a.email || 'Google account', canRefresh: !!a.refresh, active: !!a.refresh || a.expires > Date.now() + 60_000 };
}

export function disconnectDrive() {
  const a = readAuth();
  writeAuth(null);
  try {
    localStorage.removeItem(FOLDER_KEY);
  } catch {
    /* ignore */
  }
  const token = a?.refresh || a?.access;
  if (token) fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${encodeURIComponent(token)}` }).catch(() => undefined);
}

// ---------- PKCE helpers ----------

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomString(bytes = 48): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}
export async function pkceChallenge(verifier: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(d));
}

export function authUrl(id: string, challenge: string, state: string): string {
  const q = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(id),
    response_type: 'code',
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${GOOGLE_AUTH}?${q}`;
}

// ---------- sign in ----------

interface TokenReply {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenReply> {
  const r = await fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const j = (await r.json().catch(() => ({}))) as TokenReply;
  if (!r.ok || !j.access_token) throw new DriveError(j.error_description || j.error || `Google sign-in failed (${r.status})`, j.error === 'invalid_grant' ? 'not-signed-in' : 'api');
  return j;
}

async function emailOf(access: string): Promise<string | undefined> {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${access}` } });
    return r.ok ? ((await r.json()) as { email?: string }).email : undefined;
  } catch {
    return undefined;
  }
}

/** Phone: opens Google's sign-in in the system browser and waits for the redirect back into the app. */
async function signInNative(): Promise<Auth> {
  const id = clientId();
  const verifier = randomString(48);
  const state = randomString(16);
  const uri = redirectUri(id);
  const url = authUrl(id, await pkceChallenge(verifier), state);

  const code = await new Promise<string>((resolve, reject) => {
    const handles: { remove: () => Promise<void> }[] = [];
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handles.forEach((h) => void h.remove());
      Browser.close().catch(() => undefined);
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new DriveError('Sign-in timed out', 'cancelled'))), 5 * 60_000);
    CapApp.addListener('appUrlOpen', ({ url: u }) => {
      if (!u.startsWith(redirectScheme(id) + ':')) return;
      const p = new URLSearchParams(u.split('?')[1] || '');
      if (p.get('state') !== state) return done(() => reject(new DriveError('Sign-in was interrupted, please try again')));
      const c = p.get('code');
      if (c) done(() => resolve(c));
      else done(() => reject(new DriveError(p.get('error') === 'access_denied' ? 'Sign-in cancelled' : `Google said: ${p.get('error') || 'no code'}`, 'cancelled')));
    }).then((h) => {
      if (settled) void h.remove();
      else handles.push(h);
    });
    Browser.addListener('browserFinished', () => setTimeout(() => done(() => reject(new DriveError('Sign-in cancelled', 'cancelled'))), 1500)).then((h) => {
      if (settled) void h.remove();
      else handles.push(h);
    });
    Browser.open({ url }).catch((e) => done(() => reject(e)));
  });

  const t = await tokenRequest({ client_id: id, code, code_verifier: verifier, redirect_uri: uri, grant_type: 'authorization_code' });
  return { access: t.access_token!, expires: Date.now() + (t.expires_in || 3600) * 1000, refresh: t.refresh_token, email: await emailOf(t.access_token!) };
}

interface GisTokenClient {
  requestAccessToken: (o?: { prompt?: string }) => void;
}
interface GisWindow {
  google?: {
    accounts: {
      oauth2: {
        initTokenClient: (c: {
          client_id: string;
          scope: string;
          callback: (r: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => void;
          error_callback?: (e: { type: string; message?: string }) => void;
        }) => GisTokenClient;
      };
    };
  };
}

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if ((window as unknown as GisWindow).google?.accounts) return Promise.resolve();
  gisLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoading = null;
      reject(new DriveError('Could not reach Google. Check your internet connection.'));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/** Web: Google's popup. `prompt: ''` re-uses the signed-in session without asking again when it can. */
async function signInWeb(prompt: '' | 'select_account'): Promise<Auth> {
  await loadGis();
  const gis = (window as unknown as GisWindow).google!.accounts.oauth2;
  const r = await new Promise<{ access_token: string; expires_in?: number }>((resolve, reject) => {
    const client = gis.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
      callback: (res) => (res.access_token ? resolve({ access_token: res.access_token, expires_in: res.expires_in }) : reject(new DriveError(res.error_description || res.error || 'Google sign-in failed'))),
      error_callback: (e) => reject(new DriveError(e.type === 'popup_closed' ? 'Sign-in cancelled' : e.message || 'Google sign-in failed', e.type === 'popup_closed' ? 'cancelled' : 'api')),
    });
    client.requestAccessToken({ prompt });
  });
  return { access: r.access_token, expires: Date.now() + (Number(r.expires_in) || 3600) * 1000, email: await emailOf(r.access_token) };
}

/** Connects a Google account (asks the user). */
export async function connectDrive(): Promise<string> {
  if (!driveConfigured()) throw new DriveError('Google Drive is not set up in this build', 'not-configured');
  const a = platform() === 'web' ? await signInWeb('select_account') : await signInNative();
  writeAuth(a);
  return a.email || 'Google account';
}

/**
 * A usable access token. With `interactive: false` (the daily backup) it never opens a window and
 * throws not-signed-in instead.
 */
export async function accessToken(interactive: boolean): Promise<string> {
  if (!driveConfigured()) throw new DriveError('Google Drive is not set up in this build', 'not-configured');
  const a = readAuth();
  if (!a) throw new DriveError('Connect Google Drive first', 'not-signed-in');
  if (a.expires > Date.now() + 60_000) return a.access;
  if (a.refresh) {
    try {
      const t = await tokenRequest({ client_id: clientId(), refresh_token: a.refresh, grant_type: 'refresh_token' });
      writeAuth({ ...a, access: t.access_token!, expires: Date.now() + (t.expires_in || 3600) * 1000 });
      return t.access_token!;
    } catch (e) {
      if (e instanceof DriveError && e.code === 'not-signed-in') writeAuth(null); // access was revoked in the Google account
      throw e;
    }
  }
  if (platform() === 'web' && interactive) {
    const n = await signInWeb('');
    writeAuth({ ...n, email: n.email || a.email });
    return n.access;
  }
  throw new DriveError('Google Drive needs you to sign in again', 'not-signed-in');
}

// ---------- Drive REST ----------

async function api<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (r.status === 401) {
    writeAuth(null);
    throw new DriveError('Google Drive needs you to sign in again', 'not-signed-in');
  }
  if (!r.ok) {
    let msg = `Google Drive error (${r.status})`;
    try {
      const j = (await r.json()) as { error?: { message?: string } };
      if (j.error?.message) msg = j.error.message;
    } catch {
      /* not JSON */
    }
    throw new DriveError(msg);
  }
  if (r.status === 204) return undefined as T;
  const ct = r.headers.get('content-type') || '';
  return (ct.includes('json') ? r.json() : r.text()) as Promise<T>;
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function folderId(token: string): Promise<string> {
  try {
    const cached = localStorage.getItem(FOLDER_KEY);
    if (cached) return cached;
  } catch {
    /* ignore */
  }
  const found = await api<{ files: { id: string }[] }>(
    token,
    `${API}/files?${new URLSearchParams({ q: `name='${q(FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, fields: 'files(id)', pageSize: '1' })}`,
  );
  let id = found.files[0]?.id;
  if (!id) {
    const made = await api<{ id: string }>(token, `${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    id = made.id;
  }
  try {
    localStorage.setItem(FOLDER_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

export function multipartBody(meta: object, json: string, boundary: string): string {
  return `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
}

const toFile = (f: { id: string; name: string; modifiedTime?: string; size?: string }): DriveFile => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime || '', size: Number(f.size) || 0 });

/** Lists backups in the BoxBook Backups folder, newest first. */
export async function listDriveBackups(interactive = true): Promise<DriveFile[]> {
  const token = await accessToken(interactive);
  const folder = await folderId(token);
  const r = await api<{ files: { id: string; name: string; modifiedTime: string; size: string }[] }>(
    token,
    `${API}/files?${new URLSearchParams({ q: `'${folder}' in parents and trashed=false and name contains 'BoxBook-'`, orderBy: 'modifiedTime desc', pageSize: '100', fields: 'files(id,name,modifiedTime,size)' })}`,
  );
  return r.files.map(toFile);
}

/** Uploads a backup. The same name overwrites (the daily backup is one file per day). */
export async function uploadDriveBackup(name: string, json: string, opts: { interactive?: boolean; keepAuto?: number } = {}): Promise<DriveFile> {
  const token = await accessToken(opts.interactive ?? true);
  const folder = await folderId(token);
  const existing = await api<{ files: { id: string }[] }>(
    token,
    `${API}/files?${new URLSearchParams({ q: `'${folder}' in parents and name='${q(name)}' and trashed=false`, fields: 'files(id)', pageSize: '1' })}`,
  );
  const id = existing.files[0]?.id;
  const boundary = 'boxbook' + randomString(9);
  const meta = id ? { name } : { name, parents: [folder] };
  const f = await api<{ id: string; name: string; modifiedTime: string; size: string }>(
    token,
    `${UPLOAD}/files${id ? `/${id}` : ''}?uploadType=multipart&fields=id,name,modifiedTime,size`,
    { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipartBody(meta, json, boundary) },
  );
  if (opts.keepAuto) await pruneDriveAuto(token, folder, opts.keepAuto).catch((e) => console.warn('Drive prune failed', e));
  return toFile(f);
}

async function pruneDriveAuto(token: string, folder: string, keep: number) {
  const r = await api<{ files: { id: string }[] }>(
    token,
    `${API}/files?${new URLSearchParams({ q: `'${folder}' in parents and trashed=false and name contains 'BoxBook-auto-'`, orderBy: 'name desc', pageSize: '200', fields: 'files(id)' })}`,
  );
  for (const f of r.files.slice(Math.max(1, keep))) await api<void>(token, `${API}/files/${f.id}`, { method: 'DELETE' });
}

export async function downloadDriveBackup(id: string): Promise<AppData> {
  const token = await accessToken(true);
  const text = await api<string>(token, `${API}/files/${encodeURIComponent(id)}?alt=media`);
  let raw: unknown;
  try {
    raw = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new DriveError('That file in Drive is not a valid BoxBook backup');
  }
  return normalize(raw);
}
