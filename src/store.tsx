import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { App as CapApp } from '@capacitor/app';
import { emptyData, isNative, loadData, saveData } from './lib/storage';
import { backupName, saveBackupOnDevice, toJson } from './lib/backup';
import { driveSession, uploadDriveBackup } from './lib/drive';
import { todayISO, uid } from './lib/format';
import type { AppData, Customer, Order, SavedBox, Settings } from './lib/types';

interface Store {
  data: AppData;
  ready: boolean;
  upsertCustomer: (c: Partial<Customer> & { name: string }) => Customer;
  deleteCustomer: (id: string) => void;
  upsertOrder: (o: Omit<Order, 'id' | 'number' | 'createdAt' | 'updatedAt'> & Partial<Pick<Order, 'id' | 'number'>>) => Order;
  deleteOrder: (id: string) => void;
  upsertBox: (b: Omit<SavedBox, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => SavedBox;
  deleteBox: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  replaceAll: (d: AppData) => Promise<void>;
  backupNow: () => Promise<void>;
  toast: (msg: string) => void;
  toastMsg: string;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData);
  const [ready, setReady] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const dataRef = useRef(data);
  const saveTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const backupRunning = useRef(false);
  const driveRunning = useRef(false);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 2600);
  }, []);

  const commit = useCallback((fn: (d: AppData) => AppData) => {
    setData((prev) => {
      const next = fn(prev);
      dataRef.current = next;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => saveData(dataRef.current), 250);
      return next;
    });
  }, []);

  /** Once a day, keep a copy of all data on the phone. */
  const autoBackupIfDue = useCallback(async () => {
    const d = dataRef.current;
    const today = todayISO();
    if (!d.settings.autoBackup || d.settings.lastAutoBackup === today || backupRunning.current) return;
    if (!d.customers.length && !d.orders.length && !d.boxes.length) return; // nothing to protect yet
    backupRunning.current = true;
    try {
      await saveBackupOnDevice(d, 'auto', d.settings.keepBackups);
      commit((x) => ({ ...x, settings: { ...x.settings, lastAutoBackup: today, lastBackupAt: new Date().toISOString() } }));
    } catch (e) {
      console.warn('auto backup failed', e);
    } finally {
      backupRunning.current = false;
    }
  }, [commit]);

  /** Once a day, also copy to Google Drive when it is connected and switched on. Never opens a sign-in window. */
  const driveBackupIfDue = useCallback(async () => {
    const d = dataRef.current;
    const today = todayISO();
    if (!d.settings.driveAuto || d.settings.lastDriveAutoBackup === today || driveRunning.current) return;
    if (!d.customers.length && !d.orders.length && !d.boxes.length) return;
    if (!driveSession()) return;
    driveRunning.current = true;
    try {
      await uploadDriveBackup(backupName('auto'), toJson(d), { interactive: false, keepAuto: d.settings.keepBackups });
      commit((x) => ({ ...x, settings: { ...x.settings, lastDriveAutoBackup: today, lastDriveBackupAt: new Date().toISOString() } }));
    } catch (e) {
      console.warn('Drive backup failed', e);
    } finally {
      driveRunning.current = false;
    }
  }, [commit]);

  const runDailyBackups = useCallback(() => {
    void autoBackupIfDue();
    void driveBackupIfDue();
  }, [autoBackupIfDue, driveBackupIfDue]);

  useEffect(() => {
    loadData().then((d) => {
      dataRef.current = d;
      setData(d);
      setReady(true);
      setTimeout(runDailyBackups, 1500);
    });
    const flush = () => {
      window.clearTimeout(saveTimer.current);
      saveData(dataRef.current);
    };
    let remove: (() => void) | undefined;
    if (isNative) {
      CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) runDailyBackups();
        else flush();
      }).then((h) => (remove = () => h.remove()));
    }
    const vis = () => (document.hidden ? flush() : runDailyBackups());
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('beforeunload', flush);
    // App left open past midnight
    const iv = window.setInterval(runDailyBackups, 30 * 60 * 1000);
    return () => {
      remove?.();
      document.removeEventListener('visibilitychange', vis);
      window.removeEventListener('beforeunload', flush);
      window.clearInterval(iv);
    };
  }, [runDailyBackups]);

  const now = () => new Date().toISOString();

  const upsertCustomer: Store['upsertCustomer'] = (c) => {
    const existing = c.id ? dataRef.current.customers.find((x) => x.id === c.id) : undefined;
    const rec: Customer = {
      company: '',
      phone: '',
      email: '',
      gstin: '',
      address: '',
      notes: '',
      ...existing,
      ...c,
      id: existing?.id || uid(),
      createdAt: existing?.createdAt || now(),
      updatedAt: now(),
    };
    commit((d) => ({
      ...d,
      customers: existing ? d.customers.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...d.customers],
    }));
    return rec;
  };

  const deleteCustomer = (id: string) =>
    commit((d) => ({
      ...d,
      customers: d.customers.filter((c) => c.id !== id),
      orders: d.orders.filter((o) => o.customerId !== id),
      boxes: d.boxes.map((b) => (b.customerId === id ? { ...b, customerId: undefined } : b)),
    }));

  const upsertOrder: Store['upsertOrder'] = (o) => {
    const d0 = dataRef.current;
    const existing = o.id ? d0.orders.find((x) => x.id === o.id) : undefined;
    const isNew = !existing;
    const number = existing?.number || `ORD-${String(d0.settings.nextOrderNo).padStart(4, '0')}`;
    const rec: Order = { ...existing, ...o, id: existing?.id || uid(), number, createdAt: existing?.createdAt || now(), updatedAt: now() } as Order;
    commit((d) => ({
      ...d,
      orders: existing ? d.orders.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...d.orders],
      settings: isNew ? { ...d.settings, nextOrderNo: d.settings.nextOrderNo + 1 } : d.settings,
    }));
    return rec;
  };

  const deleteOrder = (id: string) => commit((d) => ({ ...d, orders: d.orders.filter((o) => o.id !== id) }));

  const upsertBox: Store['upsertBox'] = (b) => {
    const existing = b.id ? dataRef.current.boxes.find((x) => x.id === b.id) : undefined;
    const rec: SavedBox = { ...b, id: existing?.id || uid(), createdAt: existing?.createdAt || now(), updatedAt: now() };
    commit((d) => ({ ...d, boxes: existing ? d.boxes.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...d.boxes] }));
    return rec;
  };

  const deleteBox = (id: string) => commit((d) => ({ ...d, boxes: d.boxes.filter((b) => b.id !== id) }));

  const updateSettings = (patch: Partial<Settings>) => commit((d) => ({ ...d, settings: { ...d.settings, ...patch } }));

  const replaceAll = async (incoming: AppData) => {
    // Safety copy of what is on the phone right now, before it is replaced.
    try {
      await saveBackupOnDevice(dataRef.current, 'manual', dataRef.current.settings.keepBackups);
    } catch (e) {
      console.warn('pre-restore backup failed', e);
    }
    const next: AppData = {
      ...incoming,
      settings: { ...incoming.settings, lastAutoBackup: dataRef.current.settings.lastAutoBackup, lastBackupAt: new Date().toISOString() },
    };
    dataRef.current = next;
    setData(next);
    await saveData(next);
  };

  const backupNow = async () => {
    await saveBackupOnDevice(dataRef.current, 'manual', dataRef.current.settings.keepBackups);
    updateSettings({ lastBackupAt: new Date().toISOString() });
  };

  return (
    <Ctx.Provider
      value={{ data, ready, upsertCustomer, deleteCustomer, upsertOrder, deleteOrder, upsertBox, deleteBox, updateSettings, replaceAll, backupNow, toast, toastMsg }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}
