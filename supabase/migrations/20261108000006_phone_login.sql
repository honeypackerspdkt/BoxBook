-- Mobile-number sign-in (SMS code via MSG91, see supabase/functions/send-sms-msg91):
-- staff can be invited by mobile number as well as by e-mail.

alter table public.invitations alter column email drop not null;
alter table public.invitations drop constraint if exists invitations_email_check;
alter table public.invitations add column phone text check (phone ~ '^[0-9]{10}$');  -- last 10 digits
alter table public.invitations add constraint invitations_email_check check (email is null or (email = lower(trim(email)) and email like '%_@_%'));
alter table public.invitations add constraint invitations_contact_check check (email is not null or phone is not null);
create unique index invitations_open_phone_key on public.invitations (org_id, phone) where phone is not null and accepted_at is null and revoked_at is null;

-- Last 10 digits of a phone number ('+91 98765 43210' → '9876543210'), '' when there are fewer.
create or replace function public.phone10(p text)
returns text
language sql immutable
as $$
  select case when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) >= 10
              then right(regexp_replace(p, '\D', '', 'g'), 10) else '' end;
$$;

-- The open invitation for the signed-in person's e-mail or mobile number.
create or replace function public.my_invitation()
returns table (id uuid, org_id uuid, org_name text, role text)
language sql stable security definer set search_path = public
as $$
  select i.id, i.org_id, o.name, i.role
  from invitations i
  join organizations o on o.id = i.org_id
  join auth.users u on u.id = auth.uid()
  where i.accepted_at is null and i.revoked_at is null
    and ((i.email is not null and i.email = lower(trim(u.email)))
      or (i.phone is not null and i.phone = public.phone10(u.phone)))
  order by i.created_at desc
  limit 1;
$$;

create or replace function public.accept_invitation(p_display_name text default '')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_phone text;
  v_inv invitations;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if exists (select 1 from user_profiles where id = v_uid) then
    raise exception 'this account already belongs to a business';
  end if;
  select lower(trim(email)), public.phone10(phone) into v_email, v_phone from auth.users where id = v_uid;
  select * into v_inv from invitations
   where accepted_at is null and revoked_at is null
     and ((email is not null and email = v_email) or (phone is not null and phone = v_phone))
   order by created_at desc limit 1 for update;
  if not found then raise exception 'no invitation for %', coalesce(nullif(v_email, ''), nullif(v_phone, ''), 'this account'); end if;

  insert into user_profiles (id, organization_id, display_name, email, phone, role, phone_verified)
    values (v_uid, v_inv.org_id,
            coalesce(nullif(trim(p_display_name), ''), nullif(v_inv.name, ''), nullif(v_email, ''), v_phone),
            nullif(v_email, ''), nullif(v_phone, ''), v_inv.role, v_phone <> '');
  update invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return v_inv.org_id;
end;
$$;

revoke execute on function public.my_invitation() from public, anon;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.my_invitation(), public.accept_invitation(text) to authenticated, service_role;
