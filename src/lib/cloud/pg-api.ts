// Test-only: the CloudApi talking straight to Postgres (the real schema in supabase/migrations), acting as a
// signed-in user the way Supabase does (role "authenticated" + request.jwt.claim.sub). Used by sync.it.test.ts.
import type pg from 'pg';
import type { CloudApi, PullResult, PushResult, SaveResult } from './engine';

export async function asUser<T>(pool: pg.Pool, userId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

const one = async <T>(c: pg.PoolClient, sql: string, args: unknown[]) => (await c.query(sql, args)).rows[0] as T;

async function saveOrgRow(pool: pg.Pool, userId: string, table: 'org_settings' | 'price_rules', orgId: string, row: Record<string, unknown>, rev: number): Promise<SaveResult> {
  return asUser(pool, userId, async (c) => {
    const cols = Object.keys(row);
    const sets = cols.map((k) => `"${k}" = (jsonb_populate_record(null::public.${table}, $1))."${k}"`).join(', ');
    const upd = await c.query(`update public.${table} as t set ${sets}, rev = $3 where org_id = $2 and rev = $3 returning to_jsonb(t) as r`, [JSON.stringify(row), orgId, rev]);
    if (upd.rows[0]) return { status: 'ok', row: upd.rows[0].r };
    const cur = await one<{ r: Record<string, unknown> }>(c, `select to_jsonb(t) as r from public.${table} t where org_id = $1`, [orgId]);
    if (!cur) throw new Error(`${table}: not allowed`);
    return { status: 'conflict', row: cur.r };
  });
}

export function pgApi(pool: pg.Pool, userId: string, opts: { offline?: () => boolean } = {}): CloudApi {
  const guard = () => {
    if (opts.offline?.()) throw new Error('Failed to fetch');
  };
  return {
    async push(changes) {
      guard();
      return asUser(pool, userId, async (c) => (await one<{ r: PushResult[] }>(c, 'select public.sync_push($1::jsonb) as r', [JSON.stringify(changes)])).r);
    },
    async pull(since) {
      guard();
      return asUser(pool, userId, async (c) => (await one<{ r: PullResult }>(c, 'select public.sync_pull($1) as r', [since])).r);
    },
    saveSettings: (orgId, row, rev) => (guard(), saveOrgRow(pool, userId, 'org_settings', orgId, row, rev)),
    saveWebRules: (orgId, row, rev) => (guard(), saveOrgRow(pool, userId, 'price_rules', orgId, row, rev)),
    async assignOrderNo(id) {
      guard();
      return asUser(pool, userId, async (c) => (await one<{ n: string }>(c, 'select public.assign_order_no($1) as n', [id])).n);
    },
    async assignInvoiceNo(id) {
      guard();
      return asUser(pool, userId, async (c) => (await one<{ n: string }>(c, 'select public.assign_invoice_no($1) as n', [id])).n);
    },
    async setCounter(kind, next) {
      guard();
      await asUser(pool, userId, (c) => c.query('select public.set_counter($1, $2)', [kind, next]));
    },
  };
}
