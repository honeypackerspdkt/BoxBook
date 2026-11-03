// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData } from './storage';
import { accessToken, authUrl, downloadDriveBackup, driveConfigured, listDriveBackups, multipartBody, pkceChallenge, redirectUri, redirectScheme, uploadDriveBackup } from './drive';

const ID = '1234-abcd.apps.googleusercontent.com';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const signedIn = (extra: object = {}) => localStorage.setItem('boxbook-drive-auth', JSON.stringify({ access: 'tok', expires: Date.now() + 3600_000, email: 'a@b.c', ...extra }));

let calls: { url: string; init: RequestInit }[];
const mockFetch = (...replies: Response[]) => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const r = replies.shift();
      if (!r) throw new Error('unexpected request ' + url);
      return r;
    }),
  );
};

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubEnv('VITE_GOOGLE_WEB_CLIENT_ID', ID);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Google sign-in helpers', () => {
  it('computes the PKCE challenge from RFC 7636', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('uses the reversed client id as the redirect scheme', () => {
    expect(redirectScheme(ID)).toBe('com.googleusercontent.apps.1234-abcd');
    expect(redirectUri(ID)).toBe('com.googleusercontent.apps.1234-abcd:/oauth2redirect');
  });
  it('asks for Drive file access, offline, with PKCE', () => {
    const u = new URL(authUrl(ID, 'CHAL', 'ST'));
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('scope')).toContain('drive.file');
    expect(u.searchParams.get('code_challenge')).toBe('CHAL');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('state')).toBe('ST');
  });
  it('knows whether a client id was supplied', () => {
    expect(driveConfigured()).toBe(true);
    vi.stubEnv('VITE_GOOGLE_WEB_CLIENT_ID', '');
    expect(driveConfigured()).toBe(false);
  });
});

describe('tokens', () => {
  it('refuses to open a window for the daily upload when signed out', async () => {
    await expect(accessToken(false)).rejects.toMatchObject({ code: 'not-signed-in' });
  });
  it('re-uses a valid token without calling Google', async () => {
    signedIn();
    mockFetch();
    expect(await accessToken(false)).toBe('tok');
    expect(calls).toHaveLength(0);
  });
  it('refreshes an expired token with the refresh token', async () => {
    signedIn({ expires: 1, refresh: 'r1' });
    mockFetch(json({ access_token: 'new', expires_in: 3600 }));
    expect(await accessToken(false)).toBe('new');
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(String(calls[0].init.body)).toContain('grant_type=refresh_token');
    expect(JSON.parse(localStorage.getItem('boxbook-drive-auth')!)).toMatchObject({ access: 'new', refresh: 'r1', email: 'a@b.c' });
  });
  it('forgets the account when Google says access was revoked', async () => {
    signedIn({ expires: 1, refresh: 'r1' });
    mockFetch(json({ error: 'invalid_grant' }, 400));
    await expect(accessToken(false)).rejects.toMatchObject({ code: 'not-signed-in' });
    expect(localStorage.getItem('boxbook-drive-auth')).toBeNull();
  });
});

describe('Drive calls', () => {
  it('builds a multipart body with metadata then the file', () => {
    const b = multipartBody({ name: 'x.json' }, '{"a":1}', 'BND');
    expect(b).toBe('--BND\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"x.json"}\r\n--BND\r\nContent-Type: application/json\r\n\r\n{"a":1}\r\n--BND--');
  });

  it('creates the folder and uploads a new file into it', async () => {
    signedIn();
    mockFetch(json({ files: [] }), json({ id: 'F1' }), json({ files: [] }), json({ id: 'D1', name: 'BoxBook-auto-2026-11-03.json', modifiedTime: '2026-11-03T10:00:00Z', size: '123' }));
    const f = await uploadDriveBackup('BoxBook-auto-2026-11-03.json', '{"x":1}', { interactive: false });
    expect(f).toEqual({ id: 'D1', name: 'BoxBook-auto-2026-11-03.json', modifiedTime: '2026-11-03T10:00:00Z', size: 123 });
    expect(calls[1].init.method).toBe('POST');
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ name: 'BoxBook Backups', mimeType: 'application/vnd.google-apps.folder' });
    const up = calls[3];
    expect(up.url).toContain('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
    expect(up.init.method).toBe('POST');
    expect((up.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(String(up.init.body)).toContain('"parents":["F1"]');
    expect(String(up.init.body)).toContain('{"x":1}');
  });

  it('overwrites the file of the same name instead of adding another', async () => {
    signedIn();
    localStorage.setItem('boxbook-drive-folder', 'F1');
    mockFetch(json({ files: [{ id: 'OLD' }] }), json({ id: 'OLD', name: 'n', modifiedTime: '', size: '5' }));
    await uploadDriveBackup('n', '{}');
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain('/files/OLD?uploadType=multipart');
    expect(calls[1].init.method).toBe('PATCH');
    expect(String(calls[1].init.body)).not.toContain('parents');
  });

  it('keeps only the newest daily backups in Drive', async () => {
    signedIn();
    localStorage.setItem('boxbook-drive-folder', 'F1');
    mockFetch(
      json({ files: [] }),
      json({ id: 'N', name: 'BoxBook-auto-3', modifiedTime: '', size: '1' }),
      json({ files: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
      new Response(null, { status: 204 }),
      new Response(null, { status: 204 }),
    );
    await uploadDriveBackup('BoxBook-auto-3', '{}', { keepAuto: 1 });
    expect(calls.slice(3).map((c) => [c.init.method, c.url.split('/').pop()])).toEqual([
      ['DELETE', 'b'],
      ['DELETE', 'c'],
    ]);
  });

  it('lists backups newest first', async () => {
    signedIn();
    localStorage.setItem('boxbook-drive-folder', 'F1');
    mockFetch(json({ files: [{ id: '1', name: 'BoxBook-backup-x.json', modifiedTime: '2026-11-03T10:00:00Z', size: '2048' }] }));
    expect(await listDriveBackups()).toEqual([{ id: '1', name: 'BoxBook-backup-x.json', modifiedTime: '2026-11-03T10:00:00Z', size: 2048 }]);
    const u = new URL(calls[0].url);
    expect(u.searchParams.get('orderBy')).toBe('modifiedTime desc');
    expect(u.searchParams.get('q')).toContain("'F1' in parents");
  });

  it('downloads and validates a backup', async () => {
    signedIn();
    const d = { ...emptyData(), customers: [{ id: 'c1', name: 'Ravi' }] };
    mockFetch(new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } }));
    expect((await downloadDriveBackup('abc')).customers).toHaveLength(1);
    expect(calls[0].url).toContain('/files/abc?alt=media');
    mockFetch(json({ hello: 'world' }));
    await expect(downloadDriveBackup('abc')).rejects.toThrow(/not a BoxBook backup/);
  });

  it('asks to sign in again when Google rejects the token', async () => {
    signedIn();
    localStorage.setItem('boxbook-drive-folder', 'F1');
    mockFetch(json({ error: { message: 'Invalid Credentials' } }, 401));
    await expect(listDriveBackups()).rejects.toMatchObject({ code: 'not-signed-in' });
    expect(localStorage.getItem('boxbook-drive-auth')).toBeNull();
  });
});
