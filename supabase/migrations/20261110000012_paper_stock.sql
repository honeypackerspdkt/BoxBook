-- Paper reel stock, synced like orders (10 Nov 2026).
--   reels        one row per paper reel (BF, GSM, width, weight in, rate, supplier)
--   stock_moves  what was issued to an order / returned / wasted / corrected; a reel's balance = weight_in + sum(kg)
-- Plus the paper-stock rules and the payment-method list in org_settings, shared by every device.
-- Office roles only: reel rates are costs, so Production and Dispatch do not see them
-- (the same rule as saved boxes, which hold paper prices).

alter table public.org_settings
  add column stock_waste_pct  numeric not null default 5,       -- extra paper planned per order, percent
  add column auto_issue       boolean not null default true,    -- issue paper when an order is confirmed and stock covers it
  add column stock_min        jsonb   not null default '{}',    -- reorder levels: { "150-18": 200 } kg per GSM-BF
  add column reel_widths      jsonb   not null default '[]',    -- common reel widths in mm
  add column pay_modes        jsonb   not null default '["Cash","UPI","Bank transfer","Cheque","Other"]';

create table public.reels (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  number       text not null default '',
  bf           numeric not null default 0,
  gsm          numeric not null default 0,
  width        numeric not null default 0,     -- mm
  supplier     text not null default '',
  received_at  date not null default current_date,
  weight_in    numeric not null default 0,     -- kg when received
  rate         numeric not null default 0,     -- purchase rate per kg
  note         text not null default '',
  rev          int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz
);
create index on public.reels (org_id, updated_at);

create table public.stock_moves (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  reel_id     uuid not null references public.reels (id) on delete cascade,
  date        timestamptz not null default now(),
  kind        text not null check (kind in ('issue', 'return', 'waste', 'adjust')),
  kg          numeric not null default 0,      -- signed: negative takes paper off the reel
  order_id    uuid references public.orders (id) on delete set null,
  order_no    text not null default '',        -- kept so the ledger still reads right if the order is removed
  note        text not null default '',
  rev         int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz
);
create index on public.stock_moves (org_id, updated_at);
create index on public.stock_moves (reel_id);
create index on public.stock_moves (order_id);

create trigger reels_stamp       before insert or update on public.reels       for each row execute function public.sync_stamp();
create trigger stock_moves_stamp before insert or update on public.stock_moves for each row execute function public.sync_stamp();

alter table public.reels       enable row level security;
alter table public.stock_moves enable row level security;

create policy "office reads reels" on public.reels
  for select to authenticated using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "office inserts reels" on public.reels
  for insert to authenticated with check (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "office updates reels" on public.reels
  for update to authenticated
  using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']))
  with check (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));

create policy "office reads stock moves" on public.stock_moves
  for select to authenticated using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "office inserts stock moves" on public.stock_moves
  for insert to authenticated with check (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "office updates stock moves" on public.stock_moves
  for update to authenticated
  using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']))
  with check (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
-- No DELETE policies: rows are soft-deleted (deleted_at) so the deletion syncs.

-- The sync functions know the two new tables.
create or replace function public.sync_push(changes jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  c jsonb;
  t text;
  r jsonb;
  v_cols text;
  v_set text;
  v_out jsonb;
  v_exists boolean;
  v_results jsonb := '[]';
begin
  if jsonb_typeof(changes) is distinct from 'array' then raise exception 'changes must be an array'; end if;
  for c in select value from jsonb_array_elements(changes) loop
    t := c ->> 'table';
    r := c -> 'row';
    if t is null or t not in ('customers', 'boxes', 'orders', 'order_items', 'payments',
                              'products', 'delivery_zones', 'quotes', 'enquiries', 'reels', 'stock_moves') then
      v_results := v_results || jsonb_build_object('id', r ->> 'id', 'status', 'error', 'message', format('table %s cannot be synced', t));
      continue;
    end if;
    begin
      -- Columns the device sent (server-managed ones are ignored). created_at is kept on insert
      -- (moving existing phone data keeps its dates); sync_stamp keeps the stored one on update.
      select string_agg(quote_ident(col.column_name), ', ' order by col.ordinal_position),
             string_agg(format('%1$I = e.%1$I', col.column_name), ', ' order by col.ordinal_position)
             filter (where col.column_name <> 'id')
        into v_cols, v_set
        from information_schema.columns col
       where col.table_schema = 'public' and col.table_name = t
         and col.column_name in (select jsonb_object_keys(r))
         and col.column_name not in ('updated_at', 'updated_by');
      if v_cols is null or not (r ? 'id') or not (r ? 'org_id') or not (r ? 'rev') then
        raise exception 'row needs id, org_id and rev';
      end if;
      -- Update when the row exists (a partial row is fine), else insert. Not a single
      -- INSERT … ON CONFLICT: that checks NOT NULL columns on the whole proposed row first,
      -- so a soft delete sending only id/org_id/rev/deleted_at would fail.
      v_exists := false;
      execute format('select true from public.%I where id = $1', t) into v_exists using (r ->> 'id')::uuid;
      if coalesce(v_exists, false) then
        v_out := null;
        execute format(
          'update public.%1$I as x set %2$s from jsonb_populate_record(null::public.%1$I, $1) as e '
          'where x.id = e.id returning to_jsonb(x)', t, v_set)
          into v_out using r;
        if v_out is null then raise exception 'not allowed to change this row'; end if;
      else
        execute format(
          'insert into public.%1$I as x (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) '
          'returning to_jsonb(x)', t, v_cols)
          into v_out using r;
      end if;
      v_results := v_results || jsonb_build_object('id', r ->> 'id', 'status', 'ok', 'row', v_out);
    exception
      when sqlstate 'BB409' then
        execute format('select to_jsonb(x) from public.%I x where id = $1', t) into v_out using (r ->> 'id')::uuid;
        v_results := v_results || jsonb_build_object('id', r ->> 'id', 'status', 'conflict', 'row', v_out);
      when others then
        v_results := v_results || jsonb_build_object('id', r ->> 'id', 'status', 'error', 'message', sqlerrm);
    end;
  end loop;
  return v_results;
end;
$$;

create or replace function public.sync_pull(p_since timestamptz default null)
returns jsonb
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_org uuid := my_org();
  v_role text := my_role();
  v_from timestamptz := coalesce(p_since - interval '2 minutes', '-infinity');
  v_out jsonb;
begin
  if v_org is null then raise exception 'not a staff member'; end if;
  v_out := jsonb_build_object(
    'server_time', now(),
    'org_id', v_org,
    'role', v_role,
    'settings', (select to_jsonb(s) from org_settings s where s.org_id = v_org and s.updated_at > v_from),
    'price_rules', (select to_jsonb(p) from price_rules p where p.org_id = v_org and p.updated_at > v_from),
    'customers', coalesce((select jsonb_agg(to_jsonb(x)) from customers x where x.org_id = v_org and x.updated_at > v_from), '[]'),
    'boxes', coalesce((select jsonb_agg(to_jsonb(x)) from boxes x where x.org_id = v_org and x.updated_at > v_from), '[]'),
    'payments', coalesce((select jsonb_agg(to_jsonb(x)) from payments x where x.org_id = v_org and x.updated_at > v_from), '[]'),
    'products', coalesce((select jsonb_agg(to_jsonb(x)) from products x where x.org_id = v_org and x.updated_at > v_from), '[]'),
    'delivery_zones', coalesce((select jsonb_agg(to_jsonb(x)) from delivery_zones x where x.org_id = v_org and x.updated_at > v_from), '[]'),
    'quotes', coalesce((select jsonb_agg(to_jsonb(x)) from quotes x where x.org_id = v_org and x.updated_at > v_from), '[]'),
    'enquiries', coalesce((select jsonb_agg(to_jsonb(x)) from enquiries x where x.org_id = v_org and x.updated_at > v_from), '[]'),
    'reels', coalesce((select jsonb_agg(to_jsonb(x)) from reels x where x.org_id = v_org and x.updated_at > v_from), '[]'),
    'stock_moves', coalesce((select jsonb_agg(to_jsonb(x)) from stock_moves x where x.org_id = v_org and x.updated_at > v_from), '[]')
  );
  if v_role = 'Production' then
    v_out := v_out
      || jsonb_build_object('orders', coalesce((select jsonb_agg(to_jsonb(x)) from orders_production x where x.org_id = v_org and x.updated_at > v_from), '[]'))
      || jsonb_build_object('order_items', coalesce((select jsonb_agg(to_jsonb(x)) from order_items_production x where x.org_id = v_org and x.updated_at > v_from), '[]'));
  else
    v_out := v_out
      || jsonb_build_object('orders', coalesce((select jsonb_agg(to_jsonb(x)) from orders x where x.org_id = v_org and x.updated_at > v_from), '[]'))
      || jsonb_build_object('order_items', coalesce((select jsonb_agg(to_jsonb(x)) from order_items x where x.org_id = v_org and x.updated_at > v_from), '[]'));
  end if;
  return v_out;
end;
$$;
