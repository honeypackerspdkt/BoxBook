-- Ready-made box stock for the website's standard products (10 Nov 2026).
-- products.stock_qty (null = made to order) is the count on hand; every change is a row in box_stock_moves:
--   made        boxes manufactured into stock (+)
--   sold        taken by a website order when it is paid / confirmed (−), never more than is on hand
--   returned    put back when that order is cancelled (+)
--   correction  stock count corrected by staff (±)
-- Owner's choices: stock goes down when a WEBSITE order is paid/confirmed (manual orders do not touch it); when a
-- product runs out the website still takes the order as made to order.

alter table public.products
  add column if not exists stock_min int,                       -- low-stock alert level (boxes); null = no alert
  add column if not exists made_days int not null default 7;    -- days to make it when out of stock

-- web order lines remember the product and the boxes per pack, so a paid order can take its boxes from stock
alter table public.order_items
  add column if not exists pack_qty int;

create table if not exists public.box_stock_moves (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  product_id  uuid not null references public.products (id) on delete cascade,
  kind        text not null check (kind in ('made', 'sold', 'returned', 'correction')),
  qty         int not null check (qty <> 0),
  order_id    uuid references public.orders (id) on delete set null,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists box_stock_moves_product on public.box_stock_moves (product_id, created_at desc);
create index if not exists box_stock_moves_order on public.box_stock_moves (order_id);

alter table public.box_stock_moves enable row level security;
drop policy if exists "staff read box stock" on public.box_stock_moves;
create policy "staff read box stock" on public.box_stock_moves
  for select to authenticated using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts', 'Production']));
-- no insert/update/delete policies: changes go through box_stock_change and the order trigger only

/** Staff record boxes made (Production too) or correct the count (office roles). Returns the new count. */
create or replace function public.box_stock_change(p_product uuid, p_kind text, p_qty int, p_note text default '')
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_org uuid := my_org();
  v_role text := my_role();
  v_p products;
  v_new int;
begin
  if p_kind not in ('made', 'correction') then raise exception 'kind must be made or correction'; end if;
  if v_role is null or v_role not in ('Administrator', 'Sales', 'Accounts', 'Production') then raise exception 'not allowed'; end if;
  if p_kind = 'correction' and v_role = 'Production' then raise exception 'not allowed: Production can only add boxes made'; end if;
  if coalesce(p_qty, 0) = 0 then raise exception 'quantity is needed'; end if;
  if p_kind = 'made' and p_qty < 0 then raise exception 'boxes made must be more than 0'; end if;

  select * into v_p from products where id = p_product and org_id = v_org and deleted_at is null for update;
  if not found then raise exception 'product not found'; end if;
  v_new := coalesce(v_p.stock_qty, 0) + p_qty;
  if v_new < 0 then raise exception 'stock cannot go below 0 (now %)', coalesce(v_p.stock_qty, 0); end if;

  insert into box_stock_moves (org_id, product_id, kind, qty, note) values (v_org, p_product, p_kind, p_qty, left(coalesce(p_note, ''), 200));
  update products set stock_qty = v_new where id = p_product;
  return v_new;
end;
$$;
revoke execute on function public.box_stock_change(uuid, text, int, text) from public, anon;
grant execute on function public.box_stock_change(uuid, text, int, text) to authenticated;

/** A website order leaving 'quote' (paid / confirmed) takes its boxes from stock; cancelling puts them back. */
create or replace function public.box_stock_on_order()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_take int;
begin
  if new.source is distinct from 'web' or new.status is not distinct from old.status then return new; end if;

  if old.status = 'quote' and new.status in ('confirmed', 'production', 'ready', 'delivered')
     and not exists (select 1 from box_stock_moves where order_id = new.id and kind = 'sold') then
    for r in
      select i.product_id, sum(i.qty * i.pack_qty)::int as boxes
        from order_items i
       where i.order_id = new.id and i.deleted_at is null and i.product_id is not null and coalesce(i.pack_qty, 0) > 0
       group by i.product_id
    loop
      select least(coalesce(p.stock_qty, 0), r.boxes) into v_take
        from products p where p.id = r.product_id and p.stock_qty is not null for update;
      if coalesce(v_take, 0) > 0 then
        insert into box_stock_moves (org_id, product_id, kind, qty, order_id, note)
          values (new.org_id, r.product_id, 'sold', -v_take, new.id, 'Order ' || coalesce(new.number, ''));
        update products set stock_qty = stock_qty - v_take where id = r.product_id;
      end if;
    end loop;
  elsif new.status = 'cancelled' then
    for r in
      select m.product_id, -sum(m.qty)::int as boxes
        from box_stock_moves m
       where m.order_id = new.id and m.kind in ('sold', 'returned')
       group by m.product_id
      having -sum(m.qty) > 0
    loop
      insert into box_stock_moves (org_id, product_id, kind, qty, order_id, note)
        values (new.org_id, r.product_id, 'returned', r.boxes, new.id, 'Order ' || coalesce(new.number, '') || ' cancelled');
      update products set stock_qty = coalesce(stock_qty, 0) + r.boxes where id = r.product_id;
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists orders_box_stock on public.orders;
create trigger orders_box_stock after update of status on public.orders
  for each row execute function public.box_stock_on_order();

-- web_create_order: keep product_id and pack_qty on each line (rest unchanged from migration 9)
create or replace function public.web_create_order(
  p_org uuid, p_user uuid, p_items jsonb, p_delivery jsonb default '{}', p_tax_pct numeric default 5, p_notes text default '',
  p_artwork jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_customer uuid;
  v_order uuid := gen_random_uuid();
  v_no text;
  v_n bigint;
  v_item jsonb;
  v_pos int := 0;
  v_product uuid;
begin
  select id into v_customer from customers where org_id = p_org and user_id = p_user and deleted_at is null;
  if v_customer is null then raise exception 'buyer is not linked to this business (call buyer_link first)'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then raise exception 'no items'; end if;
  if jsonb_typeof(coalesce(p_artwork, '{}')) is distinct from 'object' then raise exception 'artwork must be an object'; end if;

  insert into counters as c (org_id, kind, period, next) values (p_org, 'order', 'all', 2)
  on conflict (org_id, kind, period) do update set next = c.next + 1
  returning c.next - 1 into v_n;
  select s.order_prefix || lpad(v_n::text, 4, '0') into v_no from org_settings s where s.org_id = p_org;

  insert into orders (id, org_id, number, customer_id, date, status, tax_pct, notes, delivery, source, artwork)
    values (v_order, p_org, v_no, v_customer, current_date, 'quote', p_tax_pct, coalesce(p_notes, ''), coalesce(p_delivery, '{}'), 'web',
            coalesce(p_artwork, '{}'));
  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce((v_item ->> 'qty')::numeric, 0) <= 0 or coalesce((v_item ->> 'rate')::numeric, -1) < 0 then
      raise exception 'bad item %', v_item;
    end if;
    v_product := null;
    if v_item ? 'product_id' then
      select id into v_product from products where id = (v_item ->> 'product_id')::uuid and org_id = p_org;
    end if;
    insert into order_items (org_id, order_id, position, description, qty, rate, hsn, unit, spec, product_id, pack_qty)
      values (p_org, v_order, v_pos, coalesce(v_item ->> 'description', ''), (v_item ->> 'qty')::numeric, (v_item ->> 'rate')::numeric,
              v_item ->> 'hsn', v_item ->> 'unit', v_item -> 'spec', v_product,
              case when v_product is not null then nullif((v_item ->> 'pack_qty')::int, 0) end);
    v_pos := v_pos + 1;
  end loop;
  return jsonb_build_object('id', v_order, 'number', v_no, 'customer_id', v_customer);
end;
$$;
revoke execute on function public.web_create_order(uuid, uuid, jsonb, jsonb, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.web_create_order(uuid, uuid, jsonb, jsonb, numeric, text, jsonb) to service_role;
