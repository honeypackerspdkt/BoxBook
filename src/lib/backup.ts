import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative, normalize } from './storage';
import type { AppData } from './types';
import { todayISO } from './format';

export interface BackupEntry {
  name: string;
  dir: Directory | 'web';
  path: string;
  mtime: number;
  size: number;
}

const FOLDER = 'BoxBook/Backups';
const DATA_FOLDER = 'backups';
const WEB_KEY = 'boxbook-auto-backups';

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${todayISO()}_${p(d.getHours())}${p(d.getMinutes())}`;
};

/** File name for a backup: one per day for the automatic copy, time-stamped for manual ones. */
export const backupName = (kind: 'auto' | 'manual') => (kind === 'auto' ? `BoxBook-auto-${todayISO()}.json` : `BoxBook-backup-${stamp()}.json`);

export const toJson = (data: AppData) => JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 1);

/** Writes a backup file to the phone. Tries the public Documents folder first (survives uninstall on Android),
 *  falls back to the app's private storage. */
async function writeToDevice(name: string, json: string): Promise<BackupEntry> {
  const targets: [Directory, string][] = [
    [Directory.Documents, FOLDER],
    [Directory.Data, DATA_FOLDER],
  ];
  let lastErr: unknown;
  for (const [dir, folder] of targets) {
    try {
      const path = `${folder}/${name}`;
      await Filesystem.writeFile({ path, directory: dir, data: json, encoding: Encoding.UTF8, recursive: true });
      return { name, dir, path, mtime: Date.now(), size: json.length };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export async function listBackups(): Promise<BackupEntry[]> {
  if (!isNative) {
    const list = readWebBackups();
    return list.map((b) => ({ name: b.name, dir: 'web' as const, path: b.name, mtime: b.mtime, size: b.json.length })).sort((a, b) => b.mtime - a.mtime);
  }
  const out: BackupEntry[] = [];
  for (const [dir, folder] of [[Directory.Documents, FOLDER], [Directory.Data, DATA_FOLDER]] as [Directory, string][]) {
    try {
      const r = await Filesystem.readdir({ path: folder, directory: dir });
      for (const f of r.files) {
        if (f.type === 'file' && f.name.endsWith('.json')) {
          out.push({ name: f.name, dir, path: `${folder}/${f.name}`, mtime: Number(f.mtime) || 0, size: f.size || 0 });
        }
      }
    } catch {
      /* folder does not exist yet */
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
}

export async function readBackup(entry: BackupEntry): Promise<AppData> {
  if (entry.dir === 'web') {
    const b = readWebBackups().find((x) => x.name === entry.name);
    if (!b) throw new Error('Backup not found');
    return normalize(JSON.parse(b.json));
  }
  const r = await Filesystem.readFile({ path: entry.path, directory: entry.dir, encoding: Encoding.UTF8 });
  return normalize(JSON.parse(r.data as string));
}

export async function deleteBackup(entry: BackupEntry) {
  if (entry.dir === 'web') {
    writeWebBackups(readWebBackups().filter((b) => b.name !== entry.name));
    return;
  }
  await Filesystem.deleteFile({ path: entry.path, directory: entry.dir });
}

async function prune(keep: number) {
  const autos = (await listBackups()).filter((b) => b.name.startsWith('BoxBook-auto-'));
  for (const b of autos.slice(Math.max(1, keep))) {
    try {
      await deleteBackup(b);
    } catch {
      /* ignore */
    }
  }
}

/** Saves a backup on the phone. kind=auto is used for the once-a-day automatic copy. */
export async function saveBackupOnDevice(data: AppData, kind: 'auto' | 'manual', keep: number): Promise<BackupEntry> {
  const name = backupName(kind);
  const json = toJson(data);
  let entry: BackupEntry;
  if (isNative) {
    entry = await writeToDevice(name, json);
  } else {
    const list = readWebBackups().filter((b) => b.name !== name);
    list.push({ name, mtime: Date.now(), json });
    writeWebBackups(list);
    entry = { name, dir: 'web', path: name, mtime: Date.now(), size: json.length };
  }
  if (kind === 'auto') await prune(keep);
  return entry;
}

/** Exports a backup file and opens the share sheet (save to Drive, Files, WhatsApp, e-mail…). */
export async function exportBackup(data: AppData) {
  const name = `BoxBook-backup-${stamp()}.json`;
  const json = toJson(data);
  if (!isNative) {
    downloadText(name, json);
    return;
  }
  const w = await Filesystem.writeFile({ path: name, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 });
  await Share.share({ title: 'BoxBook backup', files: [w.uri], dialogTitle: 'Save or send backup' });
}

export async function shareBackupEntry(entry: BackupEntry) {
  if (entry.dir === 'web') {
    const b = readWebBackups().find((x) => x.name === entry.name);
    if (b) downloadText(b.name, b.json);
    return;
  }
  const { uri } = await Filesystem.getUri({ path: entry.path, directory: entry.dir });
  await Share.share({ title: entry.name, files: [uri], dialogTitle: 'Save or send backup' });
}

export async function parseBackupFile(file: File): Promise<AppData> {
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a valid backup (could not read JSON)');
  }
  return normalize(raw);
}

export function backupLocationLabel(entry: BackupEntry) {
  if (entry.dir === Directory.Documents) return 'Documents/BoxBook/Backups';
  if (entry.dir === 'web') return 'Browser storage';
  return 'App storage';
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

interface WebBackup {
  name: string;
  mtime: number;
  json: string;
}
function readWebBackups(): WebBackup[] {
  try {
    return JSON.parse(localStorage.getItem(WEB_KEY) || '[]');
  } catch {
    return [];
  }
}
function writeWebBackups(list: WebBackup[]) {
  try {
    localStorage.setItem(WEB_KEY, JSON.stringify(list.slice(-10)));
  } catch {
    /* storage full or blocked */
  }
}
