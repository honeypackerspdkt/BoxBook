import { Share } from '@capacitor/share';
import { isNative } from './storage';
import { calcBox, effectiveLayers, layerName, orderTotals, specLabel } from '@honeypackers/box-core/calc';
import { fmtDate, money, num } from './format';
import type { BoxSpec, Customer, Order, Settings } from './types';

/** Returns a message to toast when the text was copied instead of shared. */
export async function shareText(title: string, text: string): Promise<string | void> {
  if (isNative) {
    await Share.share({ title, text, dialogTitle: title });
    return;
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch {
      /* cancelled */
      return;
    }
  }
  await navigator.clipboard?.writeText(text);
  return 'Copied to clipboard';
}

export function boxSpecText(spec: BoxSpec) {
  const r = calcBox(spec);
  const layers = effectiveLayers(spec)
    .map((l, i) => `  ${layerName(i, spec.ply)}: ${l.gsm} GSM / ${l.bf} BF`)
    .join('\n');
  return [
    `Box: ${specLabel(spec)}`,
    `Cut size: ${r.cutSize} mm · Deckle: ${r.deckleSize} mm · ${r.sheets} sheet${r.sheets > 1 ? 's' : ''}`,
    `Weight: ${num(r.weight)} g · BS: ${num(r.bs)}`,
    'Paper:',
    layers,
  ].join('\n');
}

export function orderText(o: Order, c: Customer | undefined, s: Settings) {
  const t = orderTotals(o);
  const cur = s.currency;
  const lines = o.items.map((it, i) => `${i + 1}. ${it.description}\n   ${num(it.qty, 0)} × ${money(it.rate, cur)} = ${money(it.qty * it.rate, cur)}`);
  const head = s.businessName ? `*${s.businessName}*\n` : '';
  const kind = o.status === 'quote' ? 'Quotation' : 'Order';
  return [
    `${head}${kind} ${o.number} · ${fmtDate(o.date)}`,
    c ? `To: ${c.name}${c.company ? ` (${c.company})` : ''}` : '',
    '',
    ...lines,
    '',
    `Subtotal: ${money(t.subtotal, cur)}`,
    o.discount ? `Discount: −${money(o.discount, cur)}` : '',
    o.taxPct ? `GST ${o.taxPct}%: ${money(t.tax, cur)}` : '',
    `*Total: ${money(t.total, cur)}*`,
    t.paid ? `Paid: ${money(t.paid, cur)}\nBalance: ${money(t.balance, cur)}` : '',
    o.dueDate ? `Delivery by: ${fmtDate(o.dueDate)}` : '',
    o.notes ? `\n${o.notes}` : '',
    s.businessPhone ? `\n${s.businessPhone}` : '',
  ]
    .filter((x, i, a) => x !== '' || (a[i - 1] !== '' && i > 0))
    .join('\n')
    .trim();
}
