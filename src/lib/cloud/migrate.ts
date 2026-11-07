import { isUuid, uid } from '../format';
import type { AppData } from '../types';

/**
 * Before the phone's data moves to the cloud: give every record a UUID (older records have short ids),
 * keeping all links between them (orders → customer, boxes → customer, order lines → saved box).
 */
export function withUuidIds(d: AppData): { data: AppData; changed: number } {
  const map = new Map<string, string>();
  const conv = (id: string | undefined) => {
    if (!id) return id;
    if (isUuid(id)) return id;
    let n = map.get(id);
    if (!n) {
      n = uid();
      map.set(id, n);
    }
    return n;
  };
  const data: AppData = {
    ...d,
    customers: d.customers.map((c) => ({ ...c, id: conv(c.id)! })),
    boxes: d.boxes.map((b) => ({ ...b, id: conv(b.id)!, customerId: conv(b.customerId) })),
    orders: d.orders.map((o) => ({
      ...o,
      id: conv(o.id)!,
      customerId: conv(o.customerId) || '',
      items: o.items.map((i) => ({ ...i, id: conv(i.id)!, boxId: conv(i.boxId) })),
      payments: o.payments.map((p) => ({ ...p, id: conv(p.id)! })),
    })),
    web: { ...d.web, zones: d.web.zones.map((z) => ({ ...z, id: conv(z.id || uid()) })) },
  };
  return { data, changed: map.size };
}
