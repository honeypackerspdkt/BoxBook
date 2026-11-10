import type { OrderStatus } from './types';

/** Staff roles (Supabase user_profiles.role). Without cloud sync the phone's user is the owner. */
export type Role = 'Administrator' | 'Sales' | 'Accounts' | 'Production' | 'Dispatch';
export const ROLES: Role[] = ['Administrator', 'Sales', 'Accounts', 'Production', 'Dispatch'];

export const ROLE_INFO: Record<Role, { label: string; text: string }> = {
  Administrator: { label: 'Owner', text: 'Everything, including company settings, web prices and staff' },
  Sales: { label: 'Sales', text: 'Customers, quotes, orders and payments' },
  Accounts: { label: 'Accounts', text: 'Customers, orders, invoices and payments' },
  Production: { label: 'Production', text: 'Job list: sizes, quantities and due dates, no prices' },
  Dispatch: { label: 'Dispatch', text: 'Ready orders with delivery address; marks them delivered' },
};

export interface Perms {
  /** Prices, totals, payments, invoices. */
  money: boolean;
  /** Customers tab and customer details. */
  customers: boolean;
  /** Create and edit orders, boxes, payments directly. */
  editOrders: boolean;
  /** Company profile, pricing defaults, web price list. */
  ownerSettings: boolean;
  /** Invite and manage staff. */
  team: boolean;
  /** Website orders and enquiries inbox. */
  inbox: boolean;
  /** Paper reels: stock, issuing paper to orders (reel rates are costs, so not for Production / Dispatch). */
  stock: boolean;
  /** Ready-made box stock: see it and add boxes made (Production too). */
  boxStock: boolean;
  /** Correct the box count (office roles; database function box_stock_change). */
  boxStockCorrect: boolean;
}

const ALL: Perms = { money: true, customers: true, editOrders: true, ownerSettings: true, team: true, inbox: true, stock: true, boxStock: true, boxStockCorrect: true };

const NONE: Perms = { money: false, customers: false, editOrders: false, ownerSettings: false, team: false, inbox: false, stock: false, boxStock: false, boxStockCorrect: false };

export function perms(role: string): Perms {
  switch (role as Role) {
    case 'Administrator':
      return ALL;
    case 'Sales':
    case 'Accounts':
      return { ...ALL, ownerSettings: false, team: false };
    case 'Production':
      return { ...NONE, boxStock: true };
    case 'Dispatch':
    default:
      return NONE;
  }
}

/** Status changes a role may make (the same rules as the database function set_order_status). */
export function canMoveStatus(role: string, from: OrderStatus, to: OrderStatus): boolean {
  if (perms(role).editOrders) return true;
  if (role === 'Production') return (from === 'confirmed' && to === 'production') || (from === 'production' && to === 'ready');
  if (role === 'Dispatch') return from === 'ready' && to === 'delivered';
  return false;
}

export type TabKey = 'home' | 'orders' | 'customers' | 'calc' | 'more';
export function tabsFor(role: string): TabKey[] {
  const p = perms(role);
  if (p.money) return p.customers ? ['home', 'orders', 'customers', 'calc', 'more'] : ['home', 'orders', 'calc', 'more'];
  return role === 'Production' ? ['orders', 'calc', 'more'] : ['orders', 'more'];
}
