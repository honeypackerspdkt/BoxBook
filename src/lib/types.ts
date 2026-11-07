import type { WebShop } from '@honeypackers/box-core/pricing';
import type { CompanySettings, Customer, Order, SavedBox } from '@honeypackers/box-core/types';

export type * from '@honeypackers/box-core/types';
export type { WebShop } from '@honeypackers/box-core/pricing';

/** Everything the app stores in its settings: the shared company settings plus this device's preferences. */
export interface Settings extends CompanySettings {
  theme: 'system' | 'light' | 'dark';
  nextOrderNo: number;
  autoBackup: boolean;
  keepBackups: number;
  lastAutoBackup: string; // yyyy-mm-dd
  lastBackupAt: string; // ISO, any backup (manual or auto)
  /** Also upload the daily backup to Google Drive. */
  driveAuto: boolean;
  lastDriveBackupAt: string; // ISO
  lastDriveAutoBackup: string; // yyyy-mm-dd
}

export interface AppData {
  app: 'boxbook';
  schema: 1;
  savedAt: string;
  customers: Customer[];
  orders: Order[];
  boxes: SavedBox[];
  settings: Settings;
  /** Web price list for honeypackers.in (owner sets it; synced to Supabase later). Older files load with the defaults. */
  web: WebShop;
}
