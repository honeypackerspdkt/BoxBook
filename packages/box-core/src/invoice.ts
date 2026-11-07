import { jsPDF } from 'jspdf';
import type { CompanySettings, Customer, InvoiceMeta, Order } from './types';
import { splitTax, stateFromGstin, stateName } from './gst';
import { rupeesInWords } from './words';

/* ------------------------------------------------------------------------------------------
 * Tax invoice (GST) as a PDF, laid out like a Tally "Tax Invoice": company + logo, buyer,
 * dispatch grid, item table with CGST/SGST (or IGST) lines, tax summary, amounts in words,
 * bank details, declaration and signature boxes.
 * ------------------------------------------------------------------------------------------ */

export interface InvoiceModel {
  number: string;
  date: string;
  seller: { name: string; lines: string[]; tagline: string; phone: string; email: string; gstin: string; stateCode: string; stateName: string; logo: string };
  buyer: { name: string; lines: string[]; gstin: string; stateCode: string; stateName: string };
  meta: InvoiceMeta;
  inter: boolean;
  items: { sno: number; desc: string; hsn: string; gstRate: number; qty: number; unit: string; price: number; amount: number }[];
  discount: number;
  taxRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxTotal: number;
  taxable: number;
  total: number;
  totalQty: number;
  totalUnit: string;
  groups: { hsn: string; taxable: number; cgst: number; sgst: number; igst: number; tax: number }[];
  bank: { holder: string; bank: string; account: string; branch: string; ifsc: string };
  declaration: string;
  currency: string;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** yyyy-mm-dd -> 31-Oct-26 */
export function invoiceDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}-${MON[+m[2] - 1]}-${m[1].slice(2)}` : '';
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const lines = (s: string) => (s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** Next invoice number as text, e.g. prefix "HP/" + 330 -> "HP/330". */
export const formatInvoiceNo = (s: Pick<CompanySettings, 'invoicePrefix' | 'nextInvoiceNo'>, n = s.nextInvoiceNo) => `${s.invoicePrefix || ''}${n}`;

export function buildInvoiceModel(order: Order, customer: Customer | undefined, s: CompanySettings, invoiceNo: string): InvoiceModel {
  const sellerState = s.businessState || stateFromGstin(s.businessGstin);
  const buyerState = customer?.stateCode || stateFromGstin(customer?.gstin || '') || sellerState;
  const inter = !!sellerState && !!buyerState && sellerState !== buyerState;

  const items = order.items.map((it, i) => ({
    sno: i + 1,
    desc: it.description || 'Item',
    hsn: (it.hsn || s.defaultHsn || '').trim(),
    gstRate: order.taxPct || 0,
    qty: it.qty || 0,
    unit: it.unit || s.defaultUnit || 'Nos.',
    price: it.rate || 0,
    amount: r2((it.qty || 0) * (it.rate || 0)),
  }));
  const subtotal = r2(items.reduce((t, i) => t + i.amount, 0));
  const discount = Math.min(order.discount || 0, subtotal);

  // Tax is worked out per HSN code, with any discount spread in proportion to value.
  const byHsn = new Map<string, number>();
  for (const it of items) byHsn.set(it.hsn, (byHsn.get(it.hsn) || 0) + it.amount);
  const groups = [...byHsn.entries()].map(([hsn, value]) => {
    const taxable = r2(subtotal ? value - (discount * value) / subtotal : value);
    const t = splitTax(taxable, order.taxPct || 0, inter);
    return { hsn, taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, tax: t.total };
  });
  const sum = (k: 'taxable' | 'cgst' | 'sgst' | 'igst' | 'tax') => r2(groups.reduce((t, g) => t + g[k], 0));
  const taxable = sum('taxable');
  const taxTotal = sum('tax');

  return {
    number: invoiceNo,
    date: invoiceDate(order.date),
    seller: {
      name: s.businessName,
      lines: lines(s.businessAddress),
      tagline: s.businessTagline,
      phone: s.businessPhone,
      email: s.businessEmail,
      gstin: s.businessGstin,
      stateCode: sellerState,
      stateName: stateName(sellerState),
      logo: s.businessLogo,
    },
    buyer: {
      name: customer?.company || customer?.name || 'Customer',
      lines: [...(customer?.company && customer.name ? [customer.name] : []), ...lines(customer?.address || '')],
      gstin: customer?.gstin || '',
      stateCode: buyerState,
      stateName: stateName(buyerState),
    },
    meta: order.invoice || {},
    inter,
    items,
    discount,
    taxRate: order.taxPct || 0,
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    taxTotal,
    taxable,
    total: r2(taxable + taxTotal),
    totalQty: items.reduce((t, i) => t + i.qty, 0),
    totalUnit: items[0]?.unit || 'Nos.',
    groups,
    bank: { holder: s.bankHolder || s.businessName, bank: s.bankName, account: s.bankAccount, branch: s.bankBranch, ifsc: s.bankIfsc },
    declaration: s.invoiceDeclaration,
    currency: s.currency || '₹',
  };
}

/* ---------------------------------- drawing --------------------------------------------- */

export interface InvoiceFonts {
  regular: string; // base64 TTF
  bold: string; // base64 TTF
}

const FONT = 'Roboto';
const L = 12; // box left (mm)
const R = 198; // box right
const W = R - L;
const TOP = 14;
const BOTTOM = 284;
// Item-table columns, as fractions of the box width (taken from the Tally layout).
const COLS = [0.028, 0.422, 0.099, 0.066, 0.099, 0.098, 0.044, 0.144];
const colX = (() => {
  const xs = [L];
  for (const f of COLS) xs.push(xs[xs.length - 1] + f * W);
  return xs;
})();

const money = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyText = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(3)));

function imageFormat(dataUrl: string): 'PNG' | 'JPEG' | null {
  const m = /^data:image\/(png|jpe?g);base64,/i.exec(dataUrl);
  if (!m) return null;
  return m[1].toLowerCase() === 'png' ? 'PNG' : 'JPEG';
}

export function drawInvoice(doc: jsPDF, m: InvoiceModel): void {
  const text = (s: string, x: number, y: number, o?: { bold?: boolean; size?: number; align?: 'left' | 'right' | 'center' }) => {
    doc.setFont(FONT, o?.bold ? 'bold' : 'normal');
    doc.setFontSize(o?.size ?? 8.5);
    doc.text(s, x, y, { align: o?.align ?? 'left', baseline: 'alphabetic' });
  };
  const wrap = (s: string, w: number, size: number, bold = false): string[] => {
    doc.setFont(FONT, bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    return doc.splitTextToSize(s, w) as string[];
  };
  const hline = (y: number, x1 = L, x2 = R) => doc.line(x1, y, x2, y);
  const vline = (x: number, y1: number, y2: number) => doc.line(x, y1, x, y2);

  doc.setLineWidth(0.25);
  doc.setDrawColor(60, 60, 60);
  doc.setTextColor(20, 20, 20);

  /* ---- measure the item rows first, so the page count is known ---- */
  const ROW_PAD = 1.6;
  const LINE_H = 3.9;
  type Row = { kind: 'item'; item: InvoiceModel['items'][number]; descLines: string[]; h: number } | { kind: 'tax'; label: string; rate: string; unit: string; amount: string; h: number } | { kind: 'gap'; h: number };
  const rows: Row[] = [];
  for (const it of m.items) {
    const descLines = wrap(it.desc, COLS[1] * W - 3, 9, true);
    rows.push({ kind: 'item', item: it, descLines, h: Math.max(6.2, descLines.length * LINE_H + ROW_PAD * 2) });
  }
  rows.push({ kind: 'gap', h: 4 });
  if (m.discount > 0) rows.push({ kind: 'tax', label: 'Less: Discount', rate: '', unit: '', amount: `-${money(m.discount)}`, h: 5.2 });
  const half = m.taxRate / 2;
  const pct = (n: number) => String(+n.toFixed(2));
  if (m.inter) rows.push({ kind: 'tax', label: `IGST ${pct(m.taxRate)}%`, rate: pct(m.taxRate), unit: '%', amount: money(m.igst), h: 5.2 });
  else {
    rows.push({ kind: 'tax', label: `CGST ${pct(half)}%`, rate: pct(half), unit: '%', amount: money(m.cgst), h: 5.2 });
    rows.push({ kind: 'tax', label: `SGST ${pct(half)}%`, rate: pct(half), unit: '%', amount: money(m.sgst), h: 5.2 });
  }

  // Vertical layout (mm)
  const HEAD_BOTTOM = TOP + 76; // bottom of company/buyer/dispatch block = top of item table
  const TH = 8.5; // table header height
  const BODY_TOP = HEAD_BOTTOM + TH;
  const LOWER_H = 96; // everything from the Total row down to the signature row
  const lastBodyBottom = BOTTOM - LOWER_H;
  const midBodyBottom = BOTTOM - 8;

  // Split rows into pages: only the last page carries the totals block.
  const pages: Row[][] = [[]];
  let used = 0;
  for (const r of rows) {
    const cap = (pages.length === 1 ? 0 : 0) + (lastBodyBottom - BODY_TOP);
    if (used + r.h > cap && pages[pages.length - 1].length) {
      pages.push([]);
      used = 0;
    }
    pages[pages.length - 1].push(r);
    used += r.h;
  }
  // If the last page's rows fit only because the totals block was ignored, they are fine; rows
  // that spilled are already on their own page. Earlier pages use the taller body area.
  const lastIdx = pages.length - 1;

  pages.forEach((pageRows, pi) => {
    if (pi > 0) doc.addPage();
    const isLast = pi === lastIdx;
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, 210, 297, 'F');
    const bodyBottom = isLast ? lastBodyBottom : midBodyBottom;

    text('Tax Invoice', (L + R) / 2, 10, { bold: true, size: 12, align: 'center' });
    if (pages.length > 1) text(`Page ${pi + 1} of ${pages.length}`, R, 10, { size: 8, align: 'right' });

    /* ---- outer box ---- */
    doc.rect(L, TOP, W, (isLast ? BOTTOM : bodyBottom + 6) - TOP);

    /* ---- header block ---- */
    const leftW = 99;
    const metaX = L + leftW;
    const midX = metaX + (R - metaX) / 2;
    const compBottom = TOP + 37;
    vline(metaX, TOP, HEAD_BOTTOM);
    hline(compBottom, L, metaX);
    hline(HEAD_BOTTOM);

    // Company
    let tx = L + 2.5;
    const fmt = imageFormat(m.seller.logo);
    if (fmt) {
      try {
        const p = doc.getImageProperties(m.seller.logo);
        const box = 24;
        const sc = Math.min(box / p.width, box / p.height);
        doc.addImage(m.seller.logo, fmt, L + 2, TOP + 2.5, p.width * sc, p.height * sc);
        tx = L + 29;
      } catch {
        /* a bad logo should never stop an invoice */
      }
    }
    let y = TOP + 6;
    const nameLines = wrap(m.seller.name, metaX - tx - 2, 11, true);
    nameLines.forEach((l) => {
      text(l, tx, y, { bold: true, size: 11 });
      y += 4.6;
    });
    const sellerRows = [
      ...m.seller.lines.flatMap((l) => wrap(l, metaX - tx - 2, 8.5)),
      ...(m.seller.tagline ? [m.seller.tagline] : []),
      ...(m.seller.phone ? [`Mob - ${m.seller.phone}`] : []),
      ...(m.seller.email ? [m.seller.email] : []),
      ...(m.seller.gstin ? [`GSTIN/UIN: ${m.seller.gstin}`] : []),
      ...(m.seller.stateName ? [`State Name :  ${m.seller.stateName}, Code : ${m.seller.stateCode}`] : []),
    ];
    const step = Math.min(3.9, (compBottom - 1.5 - y) / Math.max(1, sellerRows.length));
    sellerRows.forEach((l) => {
      text(l, tx, y, { size: 8.5 });
      y += step;
    });

    // Buyer
    text('Buyer (Bill to)', L + 2, compBottom + 4.2, { size: 8.5 });
    let by = compBottom + 9.2;
    wrap(m.buyer.name, leftW - 5, 10, true).forEach((l) => {
      text(l, L + 2, by, { bold: true, size: 10 });
      by += 4.4;
    });
    m.buyer.lines.flatMap((l) => wrap(l, leftW - 5, 9)).forEach((l) => {
      if (by < HEAD_BOTTOM - 1) text(l, L + 2, by, { size: 9 });
      by += 4.1;
    });
    if (m.buyer.gstin) {
      text('GSTIN/UIN', L + 2, by, { size: 9 });
      text(`:  ${m.buyer.gstin}`, L + 28, by, { size: 9 });
      by += 4.4;
    }
    if (m.buyer.stateName) {
      text('State Name', L + 2, by, { size: 9 });
      text(`:  ${m.buyer.stateName}, Code : ${m.buyer.stateCode}`, L + 28, by, { size: 9 });
    }

    // Invoice / dispatch grid (two columns, rows of equal height)
    const cellH = (compBottom - TOP) / 4;
    const cells: [string, string, boolean][][] = [
      [['Invoice No.', m.number, true], ['Dated', m.date, true]],
      [['Delivery Note', m.meta.deliveryNote || '', false], ['Mode/Terms of Payment', m.meta.termsOfPayment || '', false]],
      [['Dispatch Doc No.', m.meta.dispatchDocNo || '', false], ['Delivery Note Date', invoiceDate(m.meta.deliveryNoteDate || '') || m.meta.deliveryNoteDate || '', false]],
      [['Dispatched through', m.meta.dispatchedThrough || '', false], ['Destination', m.meta.destination || '', false]],
    ];
    cells.forEach((row, ri) => {
      const cy = TOP + ri * cellH;
      if (ri > 0) hline(cy, metaX, R);
      row.forEach(([label, value, big], ci) => {
        const cx = ci === 0 ? metaX : midX;
        text(label, cx + 1.5, cy + 3.8, { size: 8 });
        if (value) text(value, cx + 1.5, cy + 8, { bold: true, size: big ? 9.5 : 9 });
      });
    });
    vline(midX, TOP, compBottom);
    hline(compBottom, metaX, R);
    text('Terms of Delivery', metaX + 1.5, compBottom + 3.8, { size: 8 });
    if (m.meta.termsOfDelivery) {
      wrap(m.meta.termsOfDelivery, R - metaX - 3, 8.5).slice(0, 8).forEach((l, i) => text(l, metaX + 1.5, compBottom + 8 + i * 3.8, { size: 8.5 }));
    }

    /* ---- item table ---- */
    hline(BODY_TOP);
    const heads = ['Sl\nNo.', 'Description of Goods', 'HSN/SAC', 'GST\nRate', 'Quantity', 'Rate', 'per', 'Amount'];
    heads.forEach((h, i) => {
      const cx = (colX[i] + colX[i + 1]) / 2;
      const ls = h.split('\n');
      ls.forEach((l, k) => text(l, cx, HEAD_BOTTOM + 3.8 + k * 3.4, { size: 8, align: 'center' }));
    });
    for (let i = 1; i < colX.length - 1; i++) vline(colX[i], HEAD_BOTTOM, bodyBottom);

    let ry = BODY_TOP;
    for (const r of pageRows) {
      if (r.kind === 'item') {
        const i = r.item;
        const base = ry + ROW_PAD + 3.2;
        text(String(i.sno), colX[0] + COLS[0] * W - 1.5, base, { size: 8.5, align: 'right' });
        r.descLines.forEach((l, k) => text(l, colX[1] + 1.5, base + k * LINE_H, { bold: true, size: 9 }));
        text(i.hsn, colX[2] + 1, base, { size: 8.5 });
        text(`${pct(i.gstRate)} %`, colX[4] - 2, base, { size: 8.5, align: 'right' });
        text(`${qtyText(i.qty)} ${i.unit}`, colX[5] - 1.5, base, { bold: true, size: 9, align: 'right' });
        text(money(i.price), colX[6] - 1.5, base, { size: 8.5, align: 'right' });
        text(i.unit, colX[6] + 1, base, { size: 8.5 });
        text(money(i.amount), colX[8] - 1.5, base, { bold: true, size: 9, align: 'right' });
      } else if (r.kind === 'tax') {
        const base = ry + 3.6;
        text(r.label, colX[2] - 2, base, { bold: true, size: 9, align: 'right' });
        if (r.rate) text(r.rate, colX[6] - 1.5, base, { size: 8.5, align: 'right' });
        if (r.unit) text(r.unit, colX[6] + 1, base, { size: 8.5 });
        text(r.amount, colX[8] - 1.5, base, { bold: true, size: 9, align: 'right' });
      }
      ry += r.h;
    }

    if (!isLast) {
      text('continued…', colX[2] - 2, bodyBottom - 2, { size: 8, align: 'right' });
      hline(bodyBottom);
      return;
    }

    /* ---- totals block (last page) ---- */
    const totY = bodyBottom;
    hline(totY);
    hline(totY + 6.2);
    text('Total', colX[2] - 2, totY + 4.3, { size: 9, align: 'right' });
    text(`${qtyText(m.totalQty)} ${m.totalUnit}`, colX[5] - 1.5, totY + 4.3, { bold: true, size: 9, align: 'right' });
    text(`${m.currency} ${money(m.total)}`, colX[8] - 1.5, totY + 4.6, { bold: true, size: 11, align: 'right' });

    let yy = totY + 6.2 + 3.8;
    text('Amount Chargeable (in words)', L + 2, yy, { size: 8.5 });
    text('E. & O.E', R - 1.5, yy, { size: 8, align: 'right' });
    yy += 4.8;
    text(rupeesInWords(m.total), L + 2, yy, { bold: true, size: 9.5 });
    yy += 3;
    hline(yy);

    // Tax summary (per HSN code): taxable value, CGST + SGST (or IGST), total tax
    const th = 4.6;
    const cf = m.inter ? [0.4, 0.56, 0.68, 0.84, 1] : [0.34, 0.5, 0.58, 0.7, 0.78, 0.9, 1];
    const cx = cf.map((f) => L + W * f);
    const groupsHdr = m.inter ? [{ t: 'Integrated Tax', from: 1, to: 3 }] : [{ t: 'CGST', from: 1, to: 3 }, { t: 'SGST/UTGST', from: 3, to: 5 }];
    const last = cx.length - 2; // index of the "total tax" column
    const mid = (i: number) => (cx[i] + cx[i + 1]) / 2;
    const hdrBottom = yy + th * 2;
    text('Taxable', mid(0), yy + 3.7, { size: 8, align: 'center' });
    text('Value', mid(0), yy + 3.7 + th - 0.2, { size: 8, align: 'center' });
    text('Total', mid(last), yy + 3.7, { size: 8, align: 'center' });
    text('Tax Amount', mid(last), yy + 3.7 + th - 0.2, { size: 8, align: 'center' });
    groupsHdr.forEach((g) => {
      text(g.t, (cx[g.from] + cx[g.to]) / 2, yy + 3.4, { size: 8, align: 'center' });
      doc.setLineWidth(0.15);
      hline(yy + th, cx[g.from], cx[g.to]);
      doc.setLineWidth(0.25);
      text('Rate', mid(g.from), yy + th + 3.4, { size: 8, align: 'center' });
      text('Amount', mid(g.from + 1), yy + th + 3.4, { size: 8, align: 'center' });
    });
    hline(hdrBottom, cx[0], R);
    const rowH = 4.6;
    let gy = hdrBottom;
    const ratePct = m.inter ? m.taxRate : m.taxRate / 2;
    m.groups.slice(0, 3).forEach((g) => {
      const base = gy + 3.4;
      text(money(g.taxable), cx[1] - 1.5, base, { size: 8.5, align: 'right' });
      if (m.inter) {
        text(`${pct(ratePct)}%`, mid(1), base, { size: 8.5, align: 'center' });
        text(money(g.igst), cx[3] - 1.5, base, { size: 8.5, align: 'right' });
      } else {
        text(`${pct(ratePct)}%`, mid(1), base, { size: 8.5, align: 'center' });
        text(money(g.cgst), cx[3] - 1.5, base, { size: 8.5, align: 'right' });
        text(`${pct(ratePct)}%`, mid(3), base, { size: 8.5, align: 'center' });
        text(money(g.sgst), cx[5] - 1.5, base, { size: 8.5, align: 'right' });
      }
      text(money(g.tax), R - 1.5, gy + 3.4, { size: 8.5, align: 'right' });
      gy += rowH;
    });
    hline(gy);
    text('Total:', cx[0] - 2, gy + 3.4, { bold: true, size: 8.5, align: 'right' });
    text(money(m.taxable), cx[1] - 1.5, gy + 3.4, { bold: true, size: 8.5, align: 'right' });
    if (m.inter) {
      text(money(m.igst), cx[3] - 1.5, gy + 3.4, { bold: true, size: 8.5, align: 'right' });
    } else {
      text(money(m.cgst), cx[3] - 1.5, gy + 3.4, { bold: true, size: 8.5, align: 'right' });
      text(money(m.sgst), cx[5] - 1.5, gy + 3.4, { bold: true, size: 8.5, align: 'right' });
    }
    text(money(m.taxTotal), R - 1.5, gy + 3.4, { bold: true, size: 8.5, align: 'right' });
    gy += rowH;
    hline(gy);
    // vertical rules; the rate/amount split inside a tax group starts below the group title
    cx.slice(0, -1).forEach((x, i) => {
      const inGroup = groupsHdr.some((g) => i > g.from && i < g.to);
      vline(x, inGroup ? yy + th : yy, gy);
    });

    // Tax in words
    const twY = gy + 4.6;
    text('Tax Amount (in words) :', L + 2, twY, { size: 8.5 });
    text(rupeesInWords(m.taxTotal), L + 38, twY, { bold: true, size: 9.5 });

    /* ---- declaration + bank ---- */
    const decY = BOTTOM - 36;
    text('Declaration', L + 2, decY + 3, { size: 8.5 });
    doc.setLineWidth(0.15);
    hline(decY + 3.7, L + 2, L + 2 + 15.5);
    doc.setLineWidth(0.25);
    wrap(m.declaration, 78, 8.5).forEach((l, i) => text(l, L + 2, decY + 7.2 + i * 3.7, { size: 8.5 }));
    const b = m.bank;
    if (b.bank || b.account || b.ifsc || b.holder) {
      const bx = L + 94;
      text("Company's Bank Details", bx, decY + 3, { size: 8.5 });
      const brows: [string, string][] = [
        ["A/c Holder's Name", b.holder],
        ['Bank Name', b.bank],
        ['A/c No.', b.account],
        ['Branch & IFS Code', [b.branch, b.ifsc].filter(Boolean).join(' & ')],
      ];
      brows.forEach(([k, v], i) => {
        text(k, bx, decY + 7.4 + i * 4.1, { size: 8.5 });
        text(':', bx + 31, decY + 7.4 + i * 4.1, { size: 8.5 });
        text(v, bx + 34, decY + 7.4 + i * 4.1, { bold: true, size: 9 });
      });
    }

    /* ---- signature row ---- */
    const sigTop = BOTTOM - 14;
    hline(sigTop);
    vline(L + 94 - 2, sigTop, BOTTOM);
    text("Customer's Seal and Signature", L + 2, sigTop + 4, { size: 8.5 });
    text(`for ${m.seller.name}`, R - 1.5, sigTop + 4, { bold: true, size: 9, align: 'right' });
    text('Authorised Signatory', R - 1.5, BOTTOM - 2, { size: 8.5, align: 'right' });
    text('This is a Computer Generated Invoice', (L + R) / 2, BOTTOM + 5, { size: 8.5, align: 'center' });
  });
}

/* ---------------------------------- public API ------------------------------------------ */

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

export function createInvoicePdf(model: InvoiceModel, fonts: InvoiceFonts): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('Roboto-Regular.ttf', fonts.regular);
  doc.addFont('Roboto-Regular.ttf', FONT, 'normal');
  doc.addFileToVFS('Roboto-Bold.ttf', fonts.bold);
  doc.addFont('Roboto-Bold.ttf', FONT, 'bold');
  doc.setProperties({ title: `Tax Invoice ${model.number}`, author: model.seller.name, subject: `Invoice for ${model.buyer.name}` });
  drawInvoice(doc, model);
  return doc;
}

let fontCache: Promise<InvoiceFonts> | null = null;
/** Loads the bundled Roboto subset (₹ included) once, on first use. */
export function loadInvoiceFonts(): Promise<InvoiceFonts> {
  fontCache ??= (async () => {
    const [reg, bold] = await Promise.all([import('../assets/fonts/Roboto-Regular.subset.ttf?url'), import('../assets/fonts/Roboto-Bold.subset.ttf?url')]);
    const get = async (u: string) => bytesToBase64(new Uint8Array(await (await fetch(u)).arrayBuffer()));
    return { regular: await get(reg.default), bold: await get(bold.default) };
  })().catch((e) => {
    fontCache = null;
    throw e;
  });
  return fontCache;
}

export const invoiceFileName = (m: InvoiceModel) => `Invoice-${m.number.replace(/[^\w.-]+/g, '_')}-${m.buyer.name.replace(/[^\w]+/g, '_').slice(0, 24)}.pdf`;

/** Builds the PDF for an order and returns its bytes and file name. */
export async function renderInvoicePdf(model: InvoiceModel): Promise<{ bytes: Uint8Array; fileName: string }> {
  const doc = createInvoicePdf(model, await loadInvoiceFonts());
  return { bytes: new Uint8Array(doc.output('arraybuffer')), fileName: invoiceFileName(model) };
}
