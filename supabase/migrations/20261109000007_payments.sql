-- Online payment (Razorpay) for website orders and payment links.
-- Only the website's server functions (Netlify, service role) call these; prices are worked out there with box-core.

-- A website order for a signed-in buyer: real order number, lines with box specs, delivery details.
-- p_items: [{ "description", "qty", "rate", "hsn", "unit", "spec" }, …]
create or replace function public.web_create_order(
  p_org uuid, p_user uuid, p_items jsonb, p_delivery jsonb default '{}', p_tax_pct numeric default 5, p_notes text default '')
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

  insert into counters as c (org_id, kind, period, next) values (p_org, 'order', 'all', 2)
  on conflict (org_id, kind, period) do update set next = c.next + 1
  returning c.next - 1 into v_n;
  select s.order_prefix || lpad(v_n::text, 4, '0') into v_no from org_settings s where s.org_id = p_org;

  insert into orders (id, org_id, number, customer_id, date, status, tax_pct, notes, delivery, source)
    values (v_order, p_org, v_no, v_customer, current_date, 'quote', p_tax_pct, coalesce(p_notes, ''), coalesce(p_delivery, '{}'), 'web');
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

-- Record a captured Razorpay payment once (the webhook and the browser's confirmation may both report it).
-- A paid quotation becomes a confirmed order.
create or replace function public.record_razorpay_payment(
  p_org uuid, p_order uuid, p_amount numeric, p_payment_id text, p_rzp_order text default null, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'bad amount'; end if;
  if not exists (select 1 from orders where id = p_order and org_id = p_org and deleted_at is null) then
    raise exception 'order not found';
  end if;
  insert into payments (org_id, order_id, date, amount, mode, note, razorpay_payment_id, razorpay_order_id)
    values (p_org, p_order, current_date, p_amount, 'Razorpay', coalesce(p_note, ''), p_payment_id, p_rzp_order)
    on conflict (razorpay_payment_id) do nothing
    returning id into v_id;
  if v_id is not null then
    update orders set status = 'confirmed' where id = p_order and status = 'quote';
  end if;
  return jsonb_build_object('recorded', v_id is not null, 'payment_id', v_id);
end;
$$;

revoke execute on function public.web_create_order(uuid, uuid, jsonb, jsonb, numeric, text) from public, anon, authenticated;
revoke execute on function public.record_razorpay_payment(uuid, uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.web_create_order(uuid, uuid, jsonb, jsonb, numeric, text) to service_role;
grant execute on function public.record_razorpay_payment(uuid, uuid, numeric, text, text, text) to service_role;
