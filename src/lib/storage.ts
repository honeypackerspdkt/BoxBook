import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { defaultCompany } from '@honeypackers/box-core/company';
import { defaultWebShop, normalizeWebShop } from '@honeypackers/box-core/pricing';
import type { AppData, Settings } from './types';

export const isNative = Capacitor.isNativePlatform();
const DATA_FILE = 'boxbook-data.json';
const WEB_KEY = 'boxbook-data';

export const defaultSettings: Settings = {
  ...defaultCompany,
  theme: 'system',
  nextOrderNo: 1,
  autoBackup: true,
  keepBackups: 14,
  lastAutoBackup: '',
  lastBackupAt: '',
  driveAuto: false,
  lastDriveBackupAt: '',
  lastDriveAutoBackup: '',
  inboxSeen: [],
};

export function emptyData(): AppData {
  return {
    app: 'boxbook',
    schema: 1,
    savedAt: new Date().toISOString(),
    customers: [],
    orders: [],
    boxes: [],
    settings: { ...defaultSettings },
    web: defaultWebShop(),
    enquiries: [],
    products: [],
  };
}

/** Validates and fills in anything missing so older/partial files still load. */
export function normalize(raw: unknown): AppData {
  if (!raw || typeof raw !== 'object') throw new Error('Not a BoxBook data file');
  const d = raw as Partial<AppData>;
  if (d.app !== 'boxbook') throw new Error('This file is not a BoxBook backup');
  if (!Array.isArray(d.customers) || !Array.isArray(d.orders)) throw new Error('Backup file is damaged');
  return {
    app: 'boxbook',
    schema: 1,
    savedAt: d.savedAt || new Date().toISOString(),
    customers: d.customers,
    orders: d.orders.map((o) => ({ ...o, items: o.items || [], payments: o.payments || [] })),
    boxes: Array.isArray(d.boxes) ? d.boxes : [],
    settings: {
      ...defaultSettings,
      ...(d.settings || {}),
      defaults: { ...defaultSettings.defaults, ...(d.settings?.defaults || {}) },
    },
    web: normalizeWebShop(d.web),
    enquiries: Array.isArray(d.enquiries) ? d.enquiries : [],
    products: Array.isArray(d.products) ? d.products : [],
  };
}

export async function loadData(): Promise<AppData> {
  try {
    if (isNative) {
      const r = await Filesystem.readFile({ path: DATA_FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
      return normalize(JSON.parse(r.data as string));
    }
    const s = localStorage.getItem(WEB_KEY);
    if (s) return normalize(JSON.parse(s));
  } catch (e) {
    // Fall back to the temp copy if the main file was interrupted mid-write.
    if (isNative) {
      try {
        const r = await Filesystem.readFile({ path: DATA_FILE + '.tmp', directory: Directory.Data, encoding: Encoding.UTF8 });
        return normalize(JSON.parse(r.data as string));
      } catch {
        /* first launch */
      }
    }
    console.warn('loadData', e);
  }
  return emptyData();
}

export async function saveData(data: AppData): Promise<void> {
  const json = JSON.stringify({ ...data, savedAt: new Date().toISOString() });
  if (isNative) {
    // Write to a temp file then rename so a crash never leaves a half-written data file.
    await Filesystem.writeFile({ path: DATA_FILE + '.tmp', directory: Directory.Data, data: json, encoding: Encoding.UTF8 });
    await Filesystem.rename({ from: DATA_FILE + '.tmp', to: DATA_FILE, directory: Directory.Data, toDirectory: Directory.Data });
    return;
  }
  try {
    localStorage.setItem(WEB_KEY, json);
  } catch (e) {
    console.warn('saveData', e);
  }
}
