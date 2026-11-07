import { isServerField, same } from './mapping';

export interface MergeResult {
  merged: Record<string, unknown>;
  /** Fields both sides changed to different values. */
  conflicts: { field: string; kept: unknown; lost: unknown }[];
}

/**
 * Three-way merge of one record: `base` is the copy both sides last agreed on.
 * A field changed on one side only takes that side's value; a field changed on both sides takes the
 * newer edit (`localNewer`) and the other value is reported so the owner can review it.
 */
export function merge3(base: Record<string, unknown> | undefined, local: Record<string, unknown>, server: Record<string, unknown>, localNewer: boolean): MergeResult {
  const merged: Record<string, unknown> = { ...server };
  const conflicts: MergeResult['conflicts'] = [];
  for (const f of Object.keys(local)) {
    if (isServerField(f)) continue;
    const l = local[f];
    const s = server[f];
    if (same(l, s)) continue;
    if (base && same(l, base[f])) continue; // only the server changed it
    if (base && same(s, base[f])) {
      merged[f] = l; // only this device changed it
      continue;
    }
    merged[f] = localNewer ? l : s;
    conflicts.push({ field: f, kept: localNewer ? l : s, lost: localNewer ? s : l });
  }
  return { merged, conflicts };
}
