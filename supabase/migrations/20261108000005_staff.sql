-- Staff invitations without e-mail sending or service-role functions:
-- the owner adds an e-mail + role; that person signs in to the app with the same e-mail (6-digit code)
-- and accept_invitation() makes them a member. The check is done here, so nobody joins uninvited.

create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  email        text not null check (email = lower(trim(email)) and email like '%_@_%'),
  role         text not null check (role in ('Administrator', 'Sales', 'Production', 'Dispatch', 'Accounts')),
  name         text not null default '',
  invited_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  accepted_by  uuid,
  revoked_at   timestamptz
);
-- one open invitation per e-mail and business
create unique index invitations_open_key on public.invitations (org_id, email) where accepted_at is null and revoked_at is null;

alter table public.invitations enable row level security;
create policy "admin reads invitations" on public.invitations
  for select to authenticated using (public.has_role(org_id, array['Administrator']));
create policy "admin invites" on public.invitations
  for insert to authenticated
  with check (public.has_role(org_id, array['Administrator']) and accepted_at is null and revoked_at is null);
create policy "admin revokes" on public.invitations
  for update to authenticated
  using (public.has_role(org_id, array['Administrator']))
  with check (public.has_role(org_id, array['Administrator']));

-- The open invitation for the signed-in person's e-mail, if any (shown before they accept).
create or replace function public.my_invitation()
returns table (id uuid, org_id uuid, org_name text, role text)
language sql stable security definer set search_path = public
as $$
  select i.id, i.org_id, o.name, i.role
  from invitations i
  join organizations o on o.id = i.org_id
  join auth.users u on u.id = auth.uid()
  where i.email = lower(trim(u.email)) and i.accepted_at is null and i.revoked_at is null
  order by i.created_at desc
  limit 1;
$$;

-- Accept it: become a staff member of that business with the invited role.
create or replace function public.accept_invitation(p_display_name text default '')
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv invitations;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if exists (select 1 from user_profiles where id = v_uid) then
    raise exception 'this account already belongs to a business';
  end if;
  select lower(trim(email)) into v_email from auth.users where id = v_uid;
  select * into v_inv from invitations
   where email = v_email and accepted_at is null and revoked_at is null
   order by created_at desc limit 1 for update;
  if not found then raise exception 'no invitation for %', coalesce(v_email, 'this account'); end if;

  insert into user_profiles (id, organization_id, display_name, email, role, phone_verified)
    values (v_uid, v_inv.org_id, coalesce(nullif(trim(p_display_name), ''), nullif(v_inv.name, ''), v_email), v_email, v_inv.role, true);
  update invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return v_inv.org_id;
end;
$$;

-- A business always keeps at least one active Administrator (the owner cannot lock everyone out).
create or replace function public.keep_an_admin()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (old.role = 'Administrator' and old.is_active)
     and not (new.role = 'Administrator' and new.is_active)
     and not exists (select 1 from user_profiles p
                      where p.organization_id = old.organization_id and p.id <> old.id
                        and p.role = 'Administrator' and p.is_active) then
    raise exception 'A business needs at least one active owner (Administrator).';
  end if;
  if new.organization_id is distinct from old.organization_id or new.id is distinct from old.id then
    raise exception 'A staff member cannot be moved to another business.';
  end if;
  return new;
end;
$$;
create trigger user_profiles_keep_admin before update on public.user_profiles
  for each row execute function public.keep_an_admin();

revoke execute on function public.my_invitation() from public, anon;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.my_invitation(), public.accept_invitation(text) to authenticated, service_role;
