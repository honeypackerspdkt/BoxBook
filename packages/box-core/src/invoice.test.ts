// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildInvoiceModel, bytesToBase64, createInvoicePdf, formatInvoiceNo, invoiceDate } from './invoice';
import { defaultCompany } from './company';
import type { CompanySettings, Customer, Order } from './types';

const font = (n: string) => bytesToBase64(new Uint8Array(readFileSync(new URL(`../assets/fonts/Roboto-${n}.subset.ttf`, import.meta.url))));
const fonts = { regular: font('Regular'), bold: font('Bold') };
const logo = `data:image/png;base64,${readFileSync(new URL('../test-fixtures/logo.png', import.meta.url)).toString('base64')}`;

// The sample invoice 330 (Honey Packers -> Maruthi Coir Industries)
const settings: CompanySettings = {
  ...defaultCompany,
  businessName: 'HONEY PACKERS',
  businessAddress: '845, Valayampatty,Thirumayam (TK)\nPudukkottai - 622506',
  businessTagline: 'An ISO 9001 : 2015 Certified Company',
  businessPhone: '9626050150',
  businessGstin: '33CWVPM8309P1ZJ',
  businessState: '33',
  businessLogo: logo,
  bankHolder: 'HONEY PACKERS',
  bankName: 'INDIAN OVERSEAS BANK',
  bankAccount: '007202000020990',
  bankBranch: 'PUDUKKOTTAI',
  bankIfsc: 'IOBA0000072',
};
const customer: Customer = {
  id: 'c1', name: 'Maruthi Coir Industries', company: '', phone: '', email: '', gstin: '33ABQFM7004D1ZH',
  address: '43/1B , Ayingudi,\nThiruvengaivasal ,\nPudukkottai', notes: '', createdAt: '', updatedAt: '',
};
const order: Order = {
  id: 'o1', number: 'ORD-0001', customerId: 'c1', date: '2026-10-31', dueDate: '', status: 'confirmed',
  items: [{ id: 'i1', description: 'Maruthi - Corner Board ( 50 * 10 " ) - 5 Ply', qty: 400, rate: 16, hsn: '48084010', unit: 'Nos.' }],
  discount: 0, taxPct: 18, payments: [], notes: '', invoice: { dispatchedThrough: 'Car' }, createdAt: '', updatedAt: '',
};

describe('tax invoice', () => {
  it('reproduces the figures on the sample invoice', () => {
    const m = buildInvoiceModel(order, customer, settings, '330');
    expect(m.inter).toBe(false);
    expect(m).toMatchObject({ taxable: 6400, cgst: 576, sgst: 576, taxTotal: 1152, total: 7552, totalQty: 400, date: '31-Oct-26' });
    expect(m.buyer.stateName).toBe('Tamil Nadu');
  });
  it('uses IGST when the buyer is in another state', () => {
    const m = buildInvoiceModel(order, { ...customer, gstin: '29ABQFM7004D1ZH' }, settings, '331');
    expect(m).toMatchObject({ inter: true, igst: 1152, cgst: 0, sgst: 0, total: 7552 });
  });
  it('spreads a discount before tax', () => {
    const m = buildInvoiceModel({ ...order, discount: 400 }, customer, settings, '332');
    expect(m).toMatchObject({ taxable: 6000, taxTotal: 1080, total: 7080 });
  });
  it('formats numbers and dates', () => {
    expect(formatInvoiceNo({ invoicePrefix: 'HP/', nextInvoiceNo: 7 })).toBe('HP/7');
    expect(invoiceDate('2026-01-05')).toBe('05-Jan-26');
  });
  it('produces a PDF', () => {
    const doc = createInvoicePdf(buildInvoiceModel(order, customer, settings, '330'), fonts);
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    expect(doc.getNumberOfPages()).toBe(1);
    if (process.env.INVOICE_OUT) writeFileSync(process.env.INVOICE_OUT, bytes);
  });
  it('flows many items onto extra pages', () => {
    const many = { ...order, items: Array.from({ length: 40 }, (_, i) => ({ ...order.items[0], id: `i${i}`, description: `Box item number ${i + 1}` })) };
    const doc = createInvoicePdf(buildInvoiceModel(many, customer, settings, '333'), fonts);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    if (process.env.INVOICE_OUT) writeFileSync(process.env.INVOICE_OUT.replace('.pdf', '-multi.pdf'), new Uint8Array(doc.output('arraybuffer')));
  });
});
