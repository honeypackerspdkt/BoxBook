// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { defaultSettings, emptyData, normalize } from './storage';

describe('backup keeps company data and logo', () => {
  it('round-trips the company profile, logo, bank, invoice numbers and per-order invoice fields', () => {
    const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const d = emptyData();
    d.settings = {
      ...defaultSettings,
      businessName: 'HONEY PACKERS',
      businessGstin: '33CWVPM8309P1ZJ',
      businessLogo: logo,
      bankName: 'INDIAN OVERSEAS BANK',
      bankIfsc: 'IOBA0000072',
      invoicePrefix: 'HP/',
      nextInvoiceNo: 331,
    };
    d.customers = [{ id: 'c1', name: 'A', company: '', phone: '', email: '', gstin: '', address: '', stateCode: '29', notes: '', createdAt: '', updatedAt: '' }];
    d.orders = [
      {
        id: 'o1', number: 'ORD-0001', customerId: 'c1', date: '2026-10-31', dueDate: '', status: 'confirmed',
        items: [{ id: 'i', description: 'Corner board', qty: 400, rate: 16, hsn: '48084010', unit: 'Nos.' }],
        discount: 0, taxPct: 18, payments: [], notes: '', invoiceNo: 'HP/330', invoice: { dispatchedThrough: 'Car', destination: 'Pudukkottai' },
        createdAt: '', updatedAt: '',
      },
    ];
    const back = normalize(JSON.parse(JSON.stringify(d)));
    expect(back.settings.businessLogo).toBe(logo);
    expect(back.settings).toMatchObject({ businessName: 'HONEY PACKERS', bankName: 'INDIAN OVERSEAS BANK', bankIfsc: 'IOBA0000072', invoicePrefix: 'HP/', nextInvoiceNo: 331 });
    expect(back.customers[0].stateCode).toBe('29');
    expect(back.orders[0]).toMatchObject({ invoiceNo: 'HP/330', invoice: { dispatchedThrough: 'Car', destination: 'Pudukkottai' } });
    expect(back.orders[0].items[0]).toMatchObject({ hsn: '48084010', unit: 'Nos.' });
  });

  it('fills the new company fields when loading a backup made before they existed', () => {
    const old = { app: 'boxbook', schema: 1, savedAt: '', customers: [], orders: [], boxes: [], settings: { businessName: 'Old Co', currency: '₹' } };
    const back = normalize(old);
    expect(back.settings.businessName).toBe('Old Co');
    expect(back.settings.businessLogo).toBe('');
    expect(back.settings.nextInvoiceNo).toBe(1);
    expect(back.settings.businessState).toBe('33');
  });
});
