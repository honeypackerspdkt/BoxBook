-- Schema + RLS tests. Run with: npm run db:test   (scripts/db-test.sh)
-- Each block switches to a user ("as") and asserts what that user can and cannot do.
\set ON_ERROR_STOP 1
\set QUIET 1

-- People
insert into auth.users (id, email, phone) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@honeypackers.in', '+919800000001'),
  ('00000000-0000-0000-0000-0000000000a2', 'sales@honeypackers.in', null),
  ('00000000-0000-0000-0000-0000000000a3', 'prod@honeypackers.in', null),
  ('00000000-0000-0000-0000-0000000000a4', 'dispatch@honeypackers.in', null),
  ('00000000-0000-0000-0000-0000000000b1', 'owner@other.in', null),
  ('00000000-0000-0000-0000-0000000000c1', null, '+91 98765 43210'),   -- buyer, existing customer
  ('00000000-0000-0000-0000-0000000000c2', null, '+919999999999');    -- buyer, new

-- ───── owner signs up ─────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select public.create_organization('Honey Packers', 'Rajesh') as org1 \gset
do $$ begin
  assert public.my_role() = 'Administrator', 'owner is Administrator';
  assert (select count(*) from org_settings) = 1, 'settings row created';
  assert (select (pricing_defaults ->> 'taxPct')::numeric from org_settings) = 5, 'GST default 5%';
end $$;
do $$ begin
  perform public.create_organization('Again');
  raise exception 'second org should fail';
exception when others then
  assert sqlerrm like '%already belongs%', sqlerrm;
end $$;
reset role;

-- staff invited (normally the hub invite-user function, service role)
insert into user_profiles (id, organization_id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a2', :'org1', 'Sales', 'Sales'),
  ('00000000-0000-0000-0000-0000000000a3', :'org1', 'Prod', 'Production'),
  ('00000000-0000-0000-0000-0000000000a4', :'org1', 'Dispatch', 'Dispatch');

-- another business in the same project
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
select public.create_organization('Other Boxes') as org2 \gset
reset role;

-- ───── owner: sync push, revisions, conflicts ─────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select set_config('test.org1', :'org1', false);
do $$
declare
  org uuid := current_setting('test.org1')::uuid;
  res jsonb;
begin
  res := public.sync_push(jsonb_build_array(
    jsonb_build_object('table', 'customers', 'row', jsonb_build_object(
      'id', '10000000-0000-0000-0000-000000000001', 'org_id', org, 'rev', 0,
      'name', 'Kumar Traders', 'phone', '98765 43210', 'gstin', '33ABCDE1234F1Z5')),
    jsonb_build_object('table', 'orders', 'row', jsonb_build_object(
      'id', '20000000-0000-0000-0000-000000000001', 'org_id', org, 'rev', 0,
      'number', 'D-phone1-1', 'customer_id', '10000000-0000-0000-0000-000000000001',
      'status', 'confirmed', 'tax_pct', 5, 'discount', 0)),
    jsonb_build_object('table', 'order_items', 'row', jsonb_build_object(
      'id', '30000000-0000-0000-0000-000000000001', 'org_id', org, 'rev', 0,
      'order_id', '20000000-0000-0000-0000-000000000001', 'description', '3 ply 300×200×150',
      'qty', 500, 'rate', 12.8,
      'spec', '{"length":300,"width":200,"height":150,"ply":3,"perLayer":false,"layers":[{"gsm":120,"bf":18,"price":42}]}'::jsonb)),
    jsonb_build_object('table', 'payments', 'row', jsonb_build_object(
      'id', '40000000-0000-0000-0000-000000000001', 'org_id', org, 'rev', 0,
      'order_id', '20000000-0000-0000-0000-000000000001', 'amount', 3000, 'mode', 'UPI')),
    jsonb_build_object('table', 'counters', 'row', jsonb_build_object('id', 'x'))
  ));
  assert jsonb_array_length(res) = 5, 'one result per change';
  assert (select count(*) from jsonb_array_elements(res) e where e ->> 'status' = 'ok') = 4, res::text;
  assert res -> 4 ->> 'status' = 'error', 'counters is not syncable';
  assert (res -> 0 -> 'row' ->> 'rev')::int = 1, 'new row starts at rev 1';
  assert (res -> 0 -> 'row' ->> 'updated_by')::uuid = auth.uid(), 'updated_by set';
  assert (select created_at from customers where id = '10000000-0000-0000-0000-000000000001') > now() - interval '1 minute', 'created_at defaults to now';
  res := public.sync_push(jsonb_build_array(jsonb_build_object('table', 'boxes', 'row', jsonb_build_object(
    'id', '50000000-0000-0000-0000-000000000001', 'org_id', org, 'rev', 0, 'name', 'Old box', 'spec', '{}'::jsonb, 'pricing', '{}'::jsonb,
    'created_at', '2025-01-02T03:04:05Z'))));
  assert (res -> 0 -> 'row' ->> 'created_at')::timestamptz = '2025-01-02T03:04:05Z', 'created_at kept on insert: ' || res::text;
  res := public.sync_push(jsonb_build_array(jsonb_build_object('table', 'boxes', 'row', jsonb_build_object(
    'id', '50000000-0000-0000-0000-000000000001', 'org_id', org, 'rev', 1, 'name', 'Renamed', 'created_at', '2030-01-01T00:00:00Z'))));
  assert (res -> 0 -> 'row' ->> 'created_at')::timestamptz = '2025-01-02T03:04:05Z', 'created_at cannot change on update';

  -- edit with the rev we have (1) -> ok, rev 2
  res := public.sync_push(jsonb_build_array(jsonb_build_object('table', 'customers', 'row', jsonb_build_object(
    'id', '10000000-0000-0000-0000-000000000001', 'org_id', org, 'rev', 1, 'company', 'Kumar Traders Pvt Ltd'))));
  assert res -> 0 ->> 'status' = 'ok', res::text;
  assert (res -> 0 -> 'row' ->> 'rev')::int = 2, 'rev bumped';
  assert res -> 0 -> 'row' ->> 'name' = 'Kumar Traders', 'fields not sent are kept';

  -- a second device still on rev 1 -> conflict, gets the server copy
  res := public.sync_push(jsonb_build_array(jsonb_build_object('table', 'customers', 'row', jsonb_build_object(
    'id', '10000000-0000-0000-0000-000000000001', 'org_id', org, 'rev', 1, 'name', 'Kumar T'))));
  assert res -> 0 ->> 'status' = 'conflict', res::text;
  assert res -> 0 -> 'row' ->> 'company' = 'Kumar Traders Pvt Ltd', 'server copy returned';
  assert (select name from customers where id = '10000000-0000-0000-0000-000000000001') = 'Kumar Traders', 'conflict not applied';

  -- soft delete syncs as an update
  res := public.sync_push(jsonb_build_array(jsonb_build_object('table', 'payments', 'row', jsonb_build_object(
    'id', '40000000-0000-0000-0000-000000000001', 'org_id', org, 'rev', 1, 'deleted_at', now()))));
  assert res -> 0 ->> 'status' = 'ok', res::text;
  res := public.sync_push(jsonb_build_array(jsonb_build_object('table', 'payments', 'row', jsonb_build_object(
    'id', '40000000-0000-0000-0000-000000000001', 'org_id', org, 'rev', 2, 'deleted_at', null))));
  assert res -> 0 ->> 'status' = 'ok', 'undelete';

  -- cannot move a row to another org
  res := public.sync_push(jsonb_build_array(jsonb_build_object('table', 'customers', 'row', jsonb_build_object(
    'id', '10000000-0000-0000-0000-000000000001', 'org_id', gen_random_uuid(), 'rev', 2, 'name', 'x'))));
  assert res -> 0 ->> 'status' = 'error', 'org change refused: ' || res::text;
end $$;

-- numbers
do $$
declare n1 text; n2 text; i1 text; i2 text;
begin
  perform public.set_counter('invoice', 330);
  i1 := public.assign_invoice_no('20000000-0000-0000-0000-000000000001');
  i2 := public.assign_invoice_no('20000000-0000-0000-0000-000000000001');
  assert i1 = '330' and i2 = '330', format('invoice number once: %s %s', i1, i2);
  assert public.next_number('invoice') = 331, 'counter moved on';
  n1 := public.assign_order_no('20000000-0000-0000-0000-000000000001');
  n2 := public.assign_order_no('20000000-0000-0000-0000-000000000001');
  assert n1 = 'ORD-0001' and n2 = 'ORD-0001', format('order number once: %s %s', n1, n2);
  assert public.fy_label('2026-11-07') = '2026-27' and public.fy_label('2027-03-31') = '2026-27'
     and public.fy_label('2027-04-01') = '2027-28', 'financial year label';
end $$;

-- pull
do $$
declare p jsonb;
begin
  p := public.sync_pull(null);
  assert p ->> 'role' = 'Administrator';
  assert jsonb_array_length(p -> 'customers') = 1 and jsonb_array_length(p -> 'orders') = 1
     and jsonb_array_length(p -> 'order_items') = 1 and jsonb_array_length(p -> 'payments') = 1, p::text;
  assert p -> 'settings' ->> 'business_name' = 'Honey Packers';
  p := public.sync_pull(now() + interval '1 hour');
  assert jsonb_array_length(p -> 'customers') = 0 and p -> 'settings' = 'null'::jsonb, 'nothing new';
end $$;

-- shop set-up by the owner
insert into products (org_id, slug, name, ply, spec, packs)
  values (:'org1', '3ply-300x200x150', '3 ply 300×200×150', 3, '{"length":300,"width":200,"height":150,"ply":3}', '[{"qty":100,"price":1400}]');
insert into products (org_id, slug, name, ply, spec, active)
  values (:'org1', 'hidden', 'Hidden box', 5, '{}', false);
insert into delivery_zones (org_id, name, pincode_from, pincode_to, rate_per_kg, min_charge)
  values (:'org1', 'Pudukkottai', 622001, 622999, 4, 300);
update price_rules set rules = '{"slabs":[{"minQty":100,"marginPct":30}]}', rev = 1 where org_id = :'org1';
insert into storage.objects (bucket_id, name) values ('public-media', :'org1' || '/logo.png');
reset role;

-- ───── sales: office work, but not owner settings ─────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
set role authenticated;
do $$ begin
  assert (select count(*) from orders) = 1 and (select count(*) from payments) = 1, 'sales sees orders and payments';
  update price_rules set rules = '{}', rev = 2;
  assert (select rules from price_rules where org_id = public.my_org()) <> '{}'::jsonb, 'sales cannot change price list';
  update org_settings set invoice_prefix = 'X', rev = 1;
  assert (select invoice_prefix from org_settings) = '', 'sales cannot change company settings';
  begin
    insert into products (org_id, slug, name, ply, spec) values (public.my_org(), 's', 's', 3, '{}');
    raise exception 'sales should not add products';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from user_profiles) = 1, 'sales sees only own profile';
end $$;
reset role;

-- ───── production: jobs without money ─────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
set role authenticated;
do $$
declare p jsonb;
begin
  assert (select count(*) from orders) = 0, 'production cannot read orders table';
  assert (select count(*) from order_items) = 0 and (select count(*) from payments) = 0, 'no items/payments';
  assert (select count(*) from customers) = 0 and (select count(*) from boxes) = 0, 'no customers/boxes';
  assert (select count(*) from orders_production) = 1, 'sees the job';
  assert (select customer_name from orders_production) = 'Kumar Traders';
  assert (select spec -> 'layers' -> 0 from order_items_production) = '{"bf":18,"gsm":120}'::jsonb, 'paper price stripped';
  p := public.sync_pull(null);
  assert p -> 'orders' -> 0 -> 'discount' is null and p -> 'order_items' -> 0 -> 'rate' is null, 'pull has no money: ' || p::text;
  assert jsonb_array_length(p -> 'payments') = 0, 'pull has no payments';

  perform public.set_order_status('20000000-0000-0000-0000-000000000001', 'production');
  perform public.set_order_status('20000000-0000-0000-0000-000000000001', 'ready');
  begin
    perform public.set_order_status('20000000-0000-0000-0000-000000000001', 'delivered');
    raise exception 'production should not deliver';
  exception when others then
    assert sqlerrm like 'not allowed%', sqlerrm;
  end;
  begin
    perform public.next_number('invoice');
    raise exception 'production should not take invoice numbers';
  exception when others then
    assert sqlerrm = 'not allowed', sqlerrm;
  end;
end $$;
reset role;

-- ───── dispatch: ready orders + delivery ─────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a4', false);
set role authenticated;
do $$ begin
  assert (select count(*) from orders) = 1, 'dispatch sees the ready order';
  assert (select count(*) from payments) = 0, 'dispatch sees no payments';
  perform public.set_order_status('20000000-0000-0000-0000-000000000001', 'delivered',
    '{"mode":"own","vehicle":"TN55 AB 1234"}');
  assert (select delivery ->> 'vehicle' from orders) = 'TN55 AB 1234';
  assert (select rev from orders) >= 3, 'status changes bump rev so devices pull them';
end $$;
reset role;

-- ───── another business sees nothing of Honey Packers ─────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
set role authenticated;
select set_config('test.org1', :'org1', false);
do $$
declare res jsonb;
begin
  assert (select count(*) from orders) = 0 and (select count(*) from customers) = 0, 'no cross-org reads';
  assert (select count(*) from org_settings) = 1, 'only own settings';
  assert (select count(*) from orders_production) = 0;
  res := public.sync_push(jsonb_build_array(jsonb_build_object('table', 'customers', 'row', jsonb_build_object(
    'id', gen_random_uuid(), 'org_id', current_setting('test.org1')::uuid, 'rev', 0, 'name', 'spy'))));
  assert res -> 0 ->> 'status' = 'error', 'cannot write into another org';
  begin
    perform public.assign_invoice_no('20000000-0000-0000-0000-000000000001');
    raise exception 'should fail';
  exception when others then assert sqlerrm = 'order not found', sqlerrm; end;
  begin
    insert into storage.objects (bucket_id, name) values ('public-media', current_setting('test.org1') || '/x.png');
    raise exception 'should not upload into another org folder';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ───── website buyer with the same phone as an existing customer ─────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
set role authenticated;
select set_config('test.org1', :'org1', false);
do $$
declare cid uuid;
begin
  assert (select count(*) from customers) = 0, 'not linked yet';
  cid := public.buyer_link(current_setting('test.org1')::uuid, p_address => 'Main Road, Pudukkottai');
  assert cid = '10000000-0000-0000-0000-000000000001', 'linked to existing customer by phone';
  assert (select count(*) from orders) = 1 and (select count(*) from order_items) = 1
     and (select count(*) from payments) = 1, 'buyer sees own order, items, payments';
  assert (select address from customers) = 'Main Road, Pudukkottai', 'details updated';
  assert (select count(*) from org_settings) = 0, 'buyer cannot read company settings';
  insert into quotes (org_id, user_id, spec, qty) values (current_setting('test.org1')::uuid, auth.uid(), '{}', 500);
  begin
    insert into quotes (org_id, user_id, spec, qty, price_final) values (current_setting('test.org1')::uuid, auth.uid(), '{}', 500, 1);
    raise exception 'buyer cannot set the final price';
  exception when insufficient_privilege then null; end;
  begin
    update customers set name = 'hacked';
    assert (select name from customers) = 'Kumar Traders', 'buyer cannot edit customer row directly';
  end;
  begin
    perform public.sync_pull(null);
    raise exception 'buyers have no sync';
  exception when others then assert sqlerrm = 'not a staff member', sqlerrm; end;
end $$;
reset role;

-- a second buyer gets a new web customer and sees nothing else
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
set role authenticated;
select set_config('test.org1', :'org1', false);
do $$
declare cid uuid;
begin
  cid := public.buyer_link(current_setting('test.org1')::uuid, 'Selvi', 'Selvi Foods');
  assert (select source from customers where id = cid) = 'web';
  assert (select phone from customers where id = cid) = '9999999999';
  assert (select count(*) from orders) = 0 and (select count(*) from quotes) = 0, 'sees nothing of others';
end $$;
reset role;

-- ───── anonymous visitor on the website ─────
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$ begin
  assert (select count(*) from products) = 1, 'only active products';
  assert (select count(*) from price_rules) = 2, 'price lists are public';
  assert (select count(*) from delivery_zones) = 1;
  assert (select count(*) from public_business where business_name = 'Honey Packers') = 1;
  assert (select count(*) from customers) = 0 and (select count(*) from orders) = 0
     and (select count(*) from quotes) = 0 and (select count(*) from enquiries) = 0, 'no business data';
  assert (select count(*) from org_settings) = 0, 'no bank details';
  begin
    perform count(*) from orders_production;
    raise exception 'anon should not read the production view';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from storage.objects) = 1, 'public media readable';
  begin
    perform public.sync_pull(null);
    raise exception 'anon cannot sync';
  exception when insufficient_privilege then null; end;
  begin
    insert into enquiries (org_id, name) values (gen_random_uuid(), 'x');
    raise exception 'anon cannot insert enquiries directly';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ───── staff invitations ─────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'New.Packer@Example.in'),
  ('00000000-0000-0000-0000-0000000000d2', 'stranger@example.in');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select set_config('test.org1', :'org1', false);
do $$ begin
  insert into invitations (org_id, email, role, name) values (current_setting('test.org1')::uuid, 'new.packer@example.in', 'Production', 'Muthu');
  begin
    insert into invitations (org_id, email, role) values (current_setting('test.org1')::uuid, 'new.packer@example.in', 'Sales');
    raise exception 'duplicate open invite should fail';
  exception when unique_violation then null; end;
  begin
    insert into invitations (org_id, email, role) values (current_setting('test.org1')::uuid, 'Upper@Case.in', 'Sales');
    raise exception 'e-mail must be stored lower case';
  exception when check_violation then null; end;
  -- the owner cannot demote themselves while they are the only owner
  begin
    update user_profiles set role = 'Sales' where id = auth.uid();
    raise exception 'last admin demoted';
  exception when others then assert sqlerrm like 'A business needs at least one active owner%', sqlerrm; end;
  update user_profiles set role = 'Accounts' where id = '00000000-0000-0000-0000-0000000000a2';
  assert (select role from user_profiles where id = '00000000-0000-0000-0000-0000000000a2') = 'Accounts', 'owner changes a role';
  update user_profiles set role = 'Sales' where id = '00000000-0000-0000-0000-0000000000a2';
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
set role authenticated;
do $$ begin
  assert (select count(*) from invitations) = 0, 'sales cannot see invitations';
  begin
    insert into invitations (org_id, email, role) values (public.my_org(), 'x@y.in', 'Administrator');
    raise exception 'sales cannot invite';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.my_invitation()) = 0, 'stranger has no invitation';
  begin
    perform public.accept_invitation();
    raise exception 'stranger joined';
  exception when others then assert sqlerrm like 'no invitation%', sqlerrm; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select set_config('test.org1', :'org1', false);
do $$ begin
  assert (select org_name || '/' || role from public.my_invitation()) = 'Honey Packers/Production', 'sees own invitation (e-mail case ignored)';
  assert public.accept_invitation() = current_setting('test.org1')::uuid;
  assert public.my_role() = 'Production' and (select display_name from user_profiles where id = auth.uid()) = 'Muthu';
  assert (select count(*) from public.my_invitation()) = 0, 'invitation used up';
  begin
    perform public.accept_invitation();
    raise exception 'accepted twice';
  exception when others then assert sqlerrm like 'this account already%', sqlerrm; end;
end $$;
reset role;

-- ───── invitation by mobile number (SMS sign-in) ─────
insert into auth.users (id, phone) values ('00000000-0000-0000-0000-0000000000e1', '919000012345');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
set role authenticated;
select set_config('test.org1', :'org1', false);
do $$ begin
  insert into invitations (org_id, phone, role, name) values (current_setting('test.org1')::uuid, '9000012345', 'Dispatch', 'Ravi');
  begin
    insert into invitations (org_id, role) values (current_setting('test.org1')::uuid, 'Sales');
    raise exception 'invitation without e-mail or phone';
  exception when check_violation then null; end;
  begin
    insert into invitations (org_id, phone, role) values (current_setting('test.org1')::uuid, '+91 90000', 'Sales');
    raise exception 'bad phone accepted';
  exception when check_violation then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
set role authenticated;
do $$ begin
  assert (select role from public.my_invitation()) = 'Dispatch', 'found by mobile number';
  perform public.accept_invitation();
  assert public.my_role() = 'Dispatch' and (select display_name || '/' || phone from user_profiles where id = auth.uid()) = 'Ravi/9000012345';
end $$;
reset role;

-- ───── website orders + Razorpay payments (service role only) ─────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
set role authenticated;
select set_config('test.org1', :'org1', false);
do $$ begin
  begin
    perform public.web_create_order(current_setting('test.org1')::uuid, auth.uid(), '[{"description":"x","qty":1,"rate":1}]');
    raise exception 'buyer called web_create_order directly';
  exception when insufficient_privilege then null; end;
  begin
    perform public.record_razorpay_payment(current_setting('test.org1')::uuid, gen_random_uuid(), 1, 'pay_fake');
    raise exception 'buyer recorded a payment';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set role service_role;
select set_config('test.org1', :'org1', false);
do $$
declare r jsonb; p1 jsonb; p2 jsonb;
begin
  begin
    perform public.web_create_order(current_setting('test.org1')::uuid, '00000000-0000-0000-0000-0000000000b1', '[{"description":"x","qty":1,"rate":1}]');
    raise exception 'unlinked user got an order';
  exception when others then assert sqlerrm like 'buyer is not linked%', sqlerrm; end;
  -- buyer c2 (Selvi) was linked earlier with buyer_link
  r := public.web_create_order(current_setting('test.org1')::uuid, '00000000-0000-0000-0000-0000000000c2',
         '[{"description":"3 ply 300×200×150","qty":500,"rate":14.84,"hsn":"48191010","unit":"Nos.","spec":{"length":300,"width":200,"height":150,"ply":3}},{"description":"Delivery","qty":1,"rate":300}]',
         '{"pincode":"622001","mode":"own"}', 5, 'Website order');
  assert r ->> 'number' like 'ORD-%', r::text;
  assert (select count(*) from order_items where order_id = (r ->> 'id')::uuid) = 2;
  assert (select source || '/' || status from orders where id = (r ->> 'id')::uuid) = 'web/quote';
  assert (select spec ->> 'length' from order_items where order_id = (r ->> 'id')::uuid and position = 0) = '300';
  begin
    perform public.web_create_order(current_setting('test.org1')::uuid, '00000000-0000-0000-0000-0000000000c2', '[{"description":"free","qty":1,"rate":-5}]');
    raise exception 'negative rate accepted';
  exception when others then assert sqlerrm like 'bad item%', sqlerrm; end;

  p1 := public.record_razorpay_payment(current_setting('test.org1')::uuid, (r ->> 'id')::uuid, 8106, 'pay_ABC', 'order_XYZ', 'Website');
  p2 := public.record_razorpay_payment(current_setting('test.org1')::uuid, (r ->> 'id')::uuid, 8106, 'pay_ABC', 'order_XYZ', 'Website');
  assert (p1 ->> 'recorded')::boolean and not (p2 ->> 'recorded')::boolean, 'recorded once';
  assert (select count(*) from payments where razorpay_payment_id = 'pay_ABC') = 1;
  assert (select status from orders where id = (r ->> 'id')::uuid) = 'confirmed', 'paid quote is confirmed';
  begin
    perform public.record_razorpay_payment(gen_random_uuid(), (r ->> 'id')::uuid, 1, 'pay_other_org');
    raise exception 'payment for the wrong business';
  exception when others then assert sqlerrm = 'order not found', sqlerrm; end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
set role authenticated;
do $$ begin
  assert (select count(*) from orders where source = 'web') = 1, 'buyer sees their website order';
  assert (select count(*) from payments where mode = 'Razorpay') = 1, 'and its payment';
end $$;
reset role;

select 'all schema tests passed' as result;
