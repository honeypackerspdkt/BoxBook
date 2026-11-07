import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { App as CapApp } from '@capacitor/app';
import { emptyData, isNative, loadData, saveData } from './lib/storage';
import { backupName, saveBackupOnDevice, toJson } from './lib/backup';
import { driveSession, uploadDriveBackup } from './lib/drive';
import { todayISO, uid } from './lib/format';
import type { AppData, Customer, Enquiry, Order, Product, SavedBox, Settings, WebShop } from './lib/types';
import { CloudController, type CloudStatus } from './lib/cloud/controller';
import { withUuidIds } from './lib/cloud/migrate';
import { arrivalText, arrivals, markSeen } from './lib/inbox';
import { perms, type Perms } from './lib/roles';

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
  updateWeb: (web: WebShop) => void;
  /** Inbox: website orders looked at on this phone. */
  markInboxSeen: (orderIds: string[]) => void;
  setEnquiryStatus: (id: string, status: Enquiry['status']) => void;
  upsertProduct: (p: Omit<Product, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => Product;
  deleteProduct: (id: string) => void;
  replaceAll: (d: AppData) => Promise<void>;
  backupNow: () => Promise<void>;
  toast: (msg: string) => void;
  toastMsg: string;
  /** Cloud sync (Supabase). `cloudStatus` re-renders the screens when it changes. */
  cloud: CloudController;
  cloudStatus: CloudStatus;
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

  const toastRef = useRef<(m: string) => void>(() => {});
  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 2600);
  }, []);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveData(dataRef.current), 250);
  }, []);

  /** Replace the data without recording a local change (changes that came from the cloud). */
  const setUntracked = useCallback(
    (next: AppData) => {
      const prev = dataRef.current;
      dataRef.current = next;
      setData(next);
      scheduleSave();
      // Something new from the website came in with a sync.
      const msg = arrivalText(arrivals(prev, next));
      if (msg) toastRef.current(msg);
    },
    [scheduleSave],
  );

  // Computed from dataRef (not inside a setState updater) so each change is recorded for sync exactly once.
  const cloudRef = useRef<CloudController | null>(null);
  const commit = useCallback(
    (fn: (d: AppData) => AppData) => {
      const prev = dataRef.current;
      const next = fn(prev);
      if (next === prev) return;
      dataRef.current = next;
      setData(next);
      scheduleSave();
      cloudRef.current?.track(prev, next);
    },
    [scheduleSave],
  );

  toastRef.current = toast;

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
    cloudRef.current?.schedule(500);
  }, [autoBackupIfDue, driveBackupIfDue]);

  cloudRef.current ??= new CloudController({
    getData: () => dataRef.current,
    setDataUntracked: (next) => setUntracked(next),
    backupNow: async () => {
      await saveBackupOnDevice(dataRef.current, 'manual', dataRef.current.settings.keepBackups);
    },
  });
  const cloud = cloudRef.current;
  const [cloudStatus, setCloudStatus] = useState<CloudStatus>(cloud.status);
  useEffect(() => cloud.subscribe(() => setCloudStatus(cloud.status)), [cloud]);
  useEffect(() => {
    const online = () => cloud.schedule(500);
    window.addEventListener('online', online);
    const iv = window.setInterval(() => cloud.schedule(0), 5 * 60 * 1000);
    return () => {
      window.removeEventListener('online', online);
      window.clearInterval(iv);
    };
  }, [cloud]);

  useEffect(() => {
    loadData().then((d) => {
      dataRef.current = d;
      setData(d);
      setReady(true);
      void cloudRef.current?.init();
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
    // With cloud sync on, a new order gets a draft number; the server gives the real one after upload.
    const number = existing?.number || cloudRef.current?.draftOrderNumber(d0.settings.nextOrderNo) || `ORD-${String(d0.settings.nextOrderNo).padStart(4, '0')}`;
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

  const updateWeb = (web: WebShop) => commit((d) => ({ ...d, web }));

  const markInboxSeen = (ids: string[]) => {
    const d = dataRef.current;
    const next = markSeen(d, ids);
    if (next.length !== (d.settings.inboxSeen || []).length || next.some((x, i) => x !== d.settings.inboxSeen[i])) updateSettings({ inboxSeen: next });
  };

  const upsertProduct: Store['upsertProduct'] = (p) => {
    const existing = p.id ? dataRef.current.products.find((x) => x.id === p.id) : undefined;
    const rec: Product = { ...p, id: existing?.id || uid(), createdAt: existing?.createdAt || now(), updatedAt: now() };
    commit((d) => ({ ...d, products: existing ? d.products.map((x) => (x.id === rec.id ? rec : x)) : [...d.products, rec] }));
    return rec;
  };
  const deleteProduct = (id: string) => commit((d) => ({ ...d, products: d.products.filter((x) => x.id !== id) }));

  const setEnquiryStatus = (id: string, status: Enquiry['status']) =>
    commit((d) => ({ ...d, enquiries: d.enquiries.map((e) => (e.id === id ? { ...e, status, updatedAt: now() } : e)) }));

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
    const prev = dataRef.current;
    // With cloud sync on, a restore is a change like any other: it goes to the cloud (and every phone).
    const synced = cloudRef.current?.active ? withUuidIds(next).data : next;
    dataRef.current = synced;
    setData(synced);
    await saveData(synced);
    cloudRef.current?.track(prev, synced);
  };

  const backupNow = async () => {
    await saveBackupOnDevice(dataRef.current, 'manual', dataRef.current.settings.keepBackups);
    updateSettings({ lastBackupAt: new Date().toISOString() });
  };

  return (
    <Ctx.Provider
      value={{ data, ready, upsertCustomer, deleteCustomer, upsertOrder, deleteOrder, upsertBox, deleteBox, updateSettings, updateWeb, markInboxSeen, setEnquiryStatus, upsertProduct, deleteProduct, replaceAll, backupNow, toast, toastMsg, cloud, cloudStatus }}
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

/** The role of the person using this phone (without cloud sync: the owner) and what it may see and do. */
export function usePerms(): Perms & { role: string } {
  const { cloudStatus } = useStore();
  const role = cloudStatus.phase === 'ready' && cloudStatus.role ? cloudStatus.role : 'Administrator';
  return { role, ...perms(role) };
}
