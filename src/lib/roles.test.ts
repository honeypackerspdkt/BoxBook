import { describe, expect, it } from 'vitest';
import { canMoveStatus, perms, tabsFor } from './roles';

describe('roles', () => {
  it('owner and office staff', () => {
    expect(perms('Administrator')).toEqual({ money: true, customers: true, editOrders: true, ownerSettings: true, team: true, inbox: true });
    for (const r of ['Sales', 'Accounts']) expect(perms(r)).toEqual({ money: true, customers: true, editOrders: true, ownerSettings: false, team: false, inbox: true });
    expect(tabsFor('Sales')).toEqual(['home', 'orders', 'customers', 'calc', 'more']);
  });
  it('production and dispatch see no money and no customers', () => {
    for (const r of ['Production', 'Dispatch', 'Unknown']) expect(perms(r)).toEqual({ money: false, customers: false, editOrders: false, ownerSettings: false, team: false, inbox: false });
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
