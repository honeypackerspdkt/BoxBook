import { describe, expect, it } from 'vitest';
import { canMoveStatus, perms, tabsFor } from './roles';

describe('roles', () => {
  it('owner and office staff', () => {
    expect(perms('Administrator')).toEqual({ money: true, customers: true, editOrders: true, ownerSettings: true, team: true, inbox: true, stock: true, boxStock: true, boxStockCorrect: true });
    for (const r of ['Sales', 'Accounts']) expect(perms(r)).toEqual({ money: true, customers: true, editOrders: true, ownerSettings: false, team: false, inbox: true, stock: true, boxStock: true, boxStockCorrect: true });
    expect(tabsFor('Sales')).toEqual(['home', 'orders', 'customers', 'calc', 'more']);
  });
  it('production and dispatch see no money and no customers', () => {
    const none = { money: false, customers: false, editOrders: false, ownerSettings: false, team: false, inbox: false, stock: false, boxStock: false, boxStockCorrect: false };
    for (const r of ['Dispatch', 'Unknown']) expect(perms(r)).toEqual(none);
    // Production records boxes made into stock, but cannot correct the count
    expect(perms('Production')).toEqual({ ...none, boxStock: true });
    expect(tabsFor('Production')).toEqual(['orders', 'calc', 'more']);
    expect(tabsFor('Dispatch')).toEqual(['orders', 'more']);
  });
  it('status steps match the database function set_order_status', () => {
    expect(canMoveStatus('Production', 'confirmed', 'production')).toBe(true);
    expect(canMoveStatus('Production', 'production', 'ready')).toBe(true);
    expect(canMoveStatus('Production', 'ready', 'delivered')).toBe(false);
    expect(canMoveStatus('Production', 'quote', 'confirmed')).toBe(false);
    expect(canMoveStatus('Dispatch', 'ready', 'delivered')).toBe(true);
    expect(canMoveStatus('Dispatch', 'production', 'ready')).toBe(false);
    expect(canMoveStatus('Sales', 'delivered', 'quote')).toBe(true);
  });
});
