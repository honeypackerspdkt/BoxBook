-- Print artwork for custom boxes ordered on the website (9 Nov 2026).
-- The buyer designs the front face (logo + text, dragged into place) on /custom-box/; the website's server
-- function stores the logo and a preview PNG in the private bucket and the design (box-core OrderArtwork) here.
-- orders.source ('app' = manual order made in BoxBook, 'web' = online order) already tells the two apart.

alter table public.orders add column if not exists artwork jsonb not null default '{}';
comment on column public.orders.artwork is 'Print design from the website (box-core OrderArtwork); files in storage private/<org>/artwork/<id>/';
comment on column public.orders.source is 'app = manual order made in BoxBook, web = online order from the website';

-- Production prints the box, so it sees the design (columns can only be added at the end of a view).
create or replace view public.orders_production as
  select o.id, o.org_id, o.number, o.date, o.due_date, o.status, o.notes,
         c.name as customer_name, c.company as customer_company,
         o.rev, o.updated_at, o.deleted_at, o.artwork
  from public.orders o
  left join public.customers c on c.id = o.customer_id
  where o.status in ('confirmed', 'production', 'ready')
    and public.has_role(o.org_id, array['Administrator', 'Production']);

-- ... and the artwork files (office roles already read the whole private folder).
create policy "production reads artwork" on storage.objects
  for select to authenticated
  using (bucket_id = 'private'
         and (storage.foldername(name))[2] = 'artwork'
         and public.has_role(public.try_uuid((storage.foldername(name))[1]), array['Production']));

-- web_create_order gains the artwork (new last parameter; the old signature is replaced).
drop function if exists public.web_create_order(uuid, uuid, jsonb, jsonb, numeric, text);
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
    insert into order_items (org_id, order_id, position, description, qty, rate, hsn, unit, spec)
      values (p_org, v_order, v_pos, coalesce(v_item ->> 'description', ''), (v_item ->> 'qty')::numeric, (v_item ->> 'rate')::numeric,
              v_item ->> 'hsn', v_item ->> 'unit', v_item -> 'spec');
    v_pos := v_pos + 1;
  end loop;
  return jsonb_build_object('id', v_order, 'number', v_no, 'customer_id', v_customer);
end;
$$;

revoke execute on function public.web_create_order(uuid, uuid, jsonb, jsonb, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.web_create_order(uuid, uuid, jsonb, jsonb, numeric, text, jsonb) to service_role;
