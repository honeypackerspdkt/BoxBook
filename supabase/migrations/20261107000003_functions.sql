-- Server functions called by the BoxBook app (supabase.rpc) and the website.

-- ───────────────────────── sign-up ─────────────────────────

-- First login of a new owner: creates the organisation, the Administrator profile,
-- company settings and an empty web price list. Fails if the caller already has a profile.
create or replace function public.create_organization(p_name text, p_display_name text default '')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if exists (select 1 from user_profiles where id = v_uid) then
    raise exception 'this account already belongs to an organisation';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'organisation name is required'; end if;

  insert into organizations (name) values (trim(p_name)) returning id into v_org;
  insert into user_profiles (id, organization_id, display_name, email, phone, role, phone_verified)
    select v_uid, v_org, coalesce(nullif(trim(p_display_name), ''), u.email, u.phone, ''), u.email, u.phone,
           'Administrator', true
    from auth.users u where u.id = v_uid;
  insert into org_settings (org_id, business_name) values (v_org, trim(p_name));
  insert into price_rules (org_id) values (v_org);
  return v_org;
end;
$$;

-- ───────────────────────── numbers ─────────────────────────

-- Atomically returns the next number of a series and moves the counter on.
create or replace function public.next_number(p_kind text, p_period text default 'all')
returns bigint
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := my_org();
  v_n bigint;
begin
  if v_org is null or not has_role(v_org, array['Administrator', 'Sales', 'Accounts']) then
    raise exception 'not allowed';
  end if;
  insert into counters as c (org_id, kind, period, next) values (v_org, p_kind, p_period, 2)
  on conflict (org_id, kind, period) do update set next = c.next + 1
  returning c.next - 1 into v_n;
  return v_n;
end;
$$;

-- Owner sets where a series continues from (used when moving existing phone data to the cloud).
create or replace function public.set_counter(p_kind text, p_next bigint, p_period text default 'all')
returns void
language plpgsql security definer set search_path = public
as $$
declare v_org uuid := my_org();
begin
  if v_org is null or not has_role(v_org, array['Administrator']) then raise exception 'not allowed'; end if;
  if p_next < 1 then raise exception 'next must be at least 1'; end if;
  insert into counters (org_id, kind, period, next) values (v_org, p_kind, p_period, p_next)
  on conflict (org_id, kind, period) do update set next = excluded.next;
end;
$$;

-- Gives an order made offline (draft number) its real number. Idempotent.
create or replace function public.assign_order_no(p_order uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := my_org();
  v_o orders;
  v_no text;
begin
  select * into v_o from orders where id = p_order and org_id = v_org for update;
  if not found or not has_role(v_org, array['Administrator', 'Sales', 'Accounts']) then
    raise exception 'order not found';
  end if;
  if v_o.number not like 'D-%' then return v_o.number; end if;
  select s.order_prefix || lpad(next_number('order')::text, 4, '0') into v_no
    from org_settings s where s.org_id = v_org;
  update orders set number = v_no where id = p_order;
  return v_no;
end;
$$;

-- GST invoice number: assigned once per order, only online, never repeated.
create or replace function public.assign_invoice_no(p_order uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := my_org();
  v_o orders;
  v_s org_settings;
  v_no text;
begin
  select * into v_o from orders where id = p_order and org_id = v_org for update;
  if not found or not has_role(v_org, array['Administrator', 'Sales', 'Accounts']) then
    raise exception 'order not found';
  end if;
  if v_o.invoice_no is not null then return v_o.invoice_no; end if;
  select * into v_s from org_settings where org_id = v_org;
  v_no := v_s.invoice_prefix || next_number('invoice', case when v_s.invoice_reset_yearly then fy_label() else 'all' end);
  update orders set invoice_no = v_no where id = p_order;
  return v_no;
end;
$$;

-- ───────────────────────── production / dispatch actions ─────────────────────────

-- Status changes allowed per role. Office roles can also edit orders directly.
--   Production: confirmed → production → ready
--   Dispatch:   ready → delivered (and may fill delivery details)
create or replace function public.set_order_status(p_order uuid, p_status text, p_delivery jsonb default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := my_org();
  v_role text := my_role();
  v_o orders;
begin
  select * into v_o from orders where id = p_order and org_id = v_org and deleted_at is null for update;
  if not found then raise exception 'order not found'; end if;

  if v_role in ('Administrator', 'Sales', 'Accounts') then
    null;
  elsif v_role = 'Production' and (v_o.status, p_status) in (('confirmed', 'production'), ('production', 'ready')) then
    null;
  elsif v_role = 'Dispatch' and (v_o.status, p_status) in (('ready', 'delivered'), ('ready', 'ready')) then
    null;
  else
    raise exception 'not allowed: % cannot move an order from % to %', v_role, v_o.status, p_status;
  end if;
  if p_delivery is not null and v_role not in ('Administrator', 'Sales', 'Accounts', 'Dispatch') then
    raise exception 'not allowed to change delivery details';
  end if;

  update orders
     set status = p_status,
         delivery = case when p_delivery is null then delivery else delivery || p_delivery end
   where id = p_order;
end;
$$;

-- ───────────────────────── website buyers ─────────────────────────

-- Called after a buyer signs in on the website (phone OTP). Links them to their customer
-- record: the one already linked, else an existing customer with the same verified phone
-- (last 10 digits), else a new web customer. Updates the details they typed.
create or replace function public.buyer_link(
  p_org uuid, p_name text default null, p_company text default null, p_email text default null,
  p_gstin text default null, p_address text default null, p_state_code text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from organizations where id = p_org) then raise exception 'unknown organisation'; end if;
  select right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) into v_phone from auth.users where id = v_uid;

  select id into v_id from customers where org_id = p_org and user_id = v_uid;
  if v_id is null and length(v_phone) = 10 then
    select id into v_id from customers
     where org_id = p_org and user_id is null and deleted_at is null
       and right(regexp_replace(phone, '\D', '', 'g'), 10) = v_phone
     order by created_at limit 1;
    if v_id is not null then
      update customers set user_id = v_uid where id = v_id;
    end if;
  end if;
  if v_id is null then
    insert into customers (org_id, name, phone, source, user_id)
      values (p_org, coalesce(p_name, ''), coalesce(v_phone, ''), 'web', v_uid)
      returning id into v_id;
  end if;

  update customers set
    name       = coalesce(nullif(trim(p_name), ''), name),
    company    = coalesce(nullif(trim(p_company), ''), company),
    email      = coalesce(nullif(trim(p_email), ''), email),
    gstin      = coalesce(nullif(upper(trim(p_gstin)), ''), gstin),
    address    = coalesce(nullif(trim(p_address), ''), address),
    state_code = coalesce(nullif(trim(p_state_code), ''), state_code)
  where id = v_id
    and (p_name, p_company, p_email, p_gstin, p_address, p_state_code) is distinct from (null, null, null, null, null, null);
  return v_id;
end;
$$;

-- ───────────────────────── sync ─────────────────────────

-- Push a batch of changes from a device's outbox.
--   changes: [{ "table": "orders", "row": { …all columns incl. id, org_id, rev = the rev the device edited… } }, …]
-- New rows are inserted (send all required columns); existing ones are updated with just the
-- columns sent, and only if row.rev still matches (see sync_stamp).
-- Soft delete = send deleted_at. Runs as the caller, so RLS decides what may be written.
-- Returns one result per change: { id, status: ok|conflict|error, row (server copy) | message }.
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
                              'products', 'delivery_zones', 'quotes', 'enquiries') then
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

-- Pull everything the caller may see that changed since `p_since` (null = everything).
-- Rows are re-sent for a 2-minute overlap, because a transaction that started earlier can
-- commit after the cursor was taken; the device skips rows whose rev it already has.
-- Production staff get the price-free views instead of orders / items.
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
    'enquiries', coalesce((select jsonb_agg(to_jsonb(x)) from enquiries x where x.org_id = v_org and x.updated_at > v_from), '[]')
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

-- Staff-only functions are not for anonymous visitors.
revoke execute on function public.create_organization(text, text) from public, anon;
revoke execute on function public.next_number(text, text) from public, anon;
revoke execute on function public.set_counter(text, bigint, text) from public, anon;
revoke execute on function public.assign_order_no(uuid) from public, anon;
revoke execute on function public.assign_invoice_no(uuid) from public, anon;
revoke execute on function public.set_order_status(uuid, text, jsonb) from public, anon;
revoke execute on function public.buyer_link(uuid, text, text, text, text, text, text) from public, anon;
revoke execute on function public.sync_push(jsonb) from public, anon;
revoke execute on function public.sync_pull(timestamptz) from public, anon;
grant execute on function public.create_organization(text, text), public.next_number(text, text),
  public.set_counter(text, bigint, text), public.assign_order_no(uuid), public.assign_invoice_no(uuid),
  public.set_order_status(uuid, text, jsonb), public.buyer_link(uuid, text, text, text, text, text, text),
  public.sync_push(jsonb), public.sync_pull(timestamptz)
  to authenticated, service_role;
