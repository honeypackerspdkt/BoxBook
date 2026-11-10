-- Website buyers can sign in with a WhatsApp code (phone) or an e-mail code (10 Nov 2026).
-- buyer_link now also finds the buyer's customer record by e-mail, keeps the sign-in e-mail on it, and takes a
-- mobile number for delivery from buyers who signed in by e-mail. A phone sign-in still wins for the phone.
drop function if exists public.buyer_link(uuid, text, text, text, text, text, text);

create or replace function public.buyer_link(
  p_org uuid, p_name text default null, p_company text default null, p_email text default null,
  p_gstin text default null, p_address text default null, p_state_code text default null, p_phone text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_phone text;
  v_email text;
  v_given text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from organizations where id = p_org) then raise exception 'unknown organisation'; end if;
  select right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), lower(nullif(trim(coalesce(email, '')), ''))
    into v_phone, v_email from auth.users where id = v_uid;
  if v_given !~ '^[6-9][0-9]{9}$' then v_given := ''; end if;

  select id into v_id from customers where org_id = p_org and user_id = v_uid;
  -- an existing customer (entered in the admin) with the same mobile number …
  if v_id is null and length(v_phone) = 10 then
    select id into v_id from customers
     where org_id = p_org and user_id is null and deleted_at is null
       and right(regexp_replace(phone, '\D', '', 'g'), 10) = v_phone
     order by created_at limit 1;
  end if;
  -- … or, for an e-mail sign-in, the same e-mail address
  if v_id is null and v_email is not null then
    select id into v_id from customers
     where org_id = p_org and user_id is null and deleted_at is null
       and lower(trim(email)) = v_email
     order by created_at limit 1;
  end if;
  if v_id is not null then
    update customers set user_id = v_uid where id = v_id and user_id is null;
  else
    insert into customers (org_id, name, phone, email, source, user_id)
      values (p_org, coalesce(p_name, ''), coalesce(nullif(v_phone, ''), v_given, ''), coalesce(v_email, ''), 'web', v_uid)
      returning id into v_id;
  end if;

  update customers set
    name       = coalesce(nullif(trim(p_name), ''), name),
    company    = coalesce(nullif(trim(p_company), ''), company),
    email      = coalesce(nullif(trim(p_email), ''), nullif(email, ''), v_email, email),
    gstin      = coalesce(nullif(upper(trim(p_gstin)), ''), gstin),
    address    = coalesce(nullif(trim(p_address), ''), address),
    state_code = coalesce(nullif(trim(p_state_code), ''), state_code),
    -- the signed-in phone is the buyer's number; an e-mail buyer gives one for delivery
    phone      = case when length(v_phone) = 10 then phone else coalesce(nullif(v_given, ''), phone) end
  where id = v_id
    and (p_name, p_company, p_email, p_gstin, p_address, p_state_code, p_phone) is distinct from (null, null, null, null, null, null, null);
  return v_id;
end;
$$;

revoke execute on function public.buyer_link(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.buyer_link(uuid, text, text, text, text, text, text, text) to authenticated, service_role;
