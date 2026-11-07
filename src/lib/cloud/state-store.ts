import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { isNative } from '../storage';
import type { SyncState } from './engine';

// Sync bookkeeping (outbox, last server copies) lives next to the data file, in its own file,
// so backups stay a plain copy of the business data.
const FILE = 'boxbook-sync.json';
const KEY = 'boxbook-sync';

export async function loadSyncState(): Promise<SyncState | null> {
  try {
    if (isNative) {
      const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
      return JSON.parse(r.data as string) as SyncState;
    }
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as SyncState) : null;
  } catch {
    return null;
  }
}

export async function saveSyncState(s: SyncState): Promise<void> {
  const json = JSON.stringify(s);
  if (isNative) {
    await Filesystem.writeFile({ path: FILE + '.tmp', directory: Directory.Data, data: json, encoding: Encoding.UTF8 });
    await Filesystem.rename({ from: FILE + '.tmp', to: FILE, directory: Directory.Data, toDirectory: Directory.Data });
    return;
  }
  try {
    localStorage.setItem(KEY, json);
  } catch (e) {
    console.warn('saveSyncState', e);
  }
}

export async function clearSyncState(): Promise<void> {
  if (isNative) await Filesystem.deleteFile({ path: FILE, directory: Directory.Data }).catch(() => {});
  else localStorage.removeItem(KEY);
}
