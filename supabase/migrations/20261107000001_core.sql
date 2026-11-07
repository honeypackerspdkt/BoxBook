-- BoxBook / Honey Packers: core schema (organisations, staff, business data, sync).
-- Plan: docs/online-business-plan.md. One Supabase project per app.
--
-- Table names organizations / user_profiles / audit_logs match the rajesh-hub
-- supabase-kit edge functions (invite-user, create-user, delete-account, phone OTP),
-- so those can be deployed here unchanged (their VALID_ROLES list needs BoxBook's roles).
--
-- Every synced business table has:
--   id uuid      made on the device, so records can be created offline
--   org_id       owning organisation (RLS key)
--   rev          row version; a client update must send the rev it last saw (see sync_stamp)
--   updated_at   server clock, the pull cursor
--   updated_by   auth.uid() of the last writer
--   deleted_at   soft delete, so other devices learn about deletions

-- ───────────────────────── organisations & staff ─────────────────────────

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Staff only. Website buyers are linked through customers.user_id instead.
create table public.user_profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  display_name     text not null default '',
  email            text,
  phone            text,
  role             text not null check (role in ('Administrator', 'Sales', 'Production', 'Dispatch', 'Accounts')),
  is_active        boolean not null default true,
  phone_verified   boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.user_profiles (organization_id);

-- ───────────────────────── helpers ─────────────────────────

-- True when the caller is an active staff member of `org` with one of `roles`
-- (null roles = any role). SECURITY DEFINER so policies can read user_profiles
-- without recursing into its own RLS.
create or replace function public.has_role(org uuid, roles text[] default null)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_profiles p
    where p.id = auth.uid() and p.is_active and p.organization_id = org
      and (roles is null or p.role = any (roles))
  );
$$;

create or replace function public.my_org()
returns uuid
language sql stable security definer set search_path = public
as $$
  select organization_id from public.user_profiles where id = auth.uid() and is_active;
$$;

create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.user_profiles where id = auth.uid() and is_active;
$$;

-- Indian financial year label for a date, e.g. 2026-11-07 -> '2026-27'.
create or replace function public.fy_label(d date default current_date)
returns text
language sql immutable
as $$
  select case when extract(month from d) >= 4
    then extract(year from d)::int || '-' || lpad(((extract(year from d)::int + 1) % 100)::text, 2, '0')
    else (extract(year from d)::int - 1) || '-' || lpad((extract(year from d)::int % 100)::text, 2, '0')
  end;
$$;

-- Row versioning for synced tables.
-- INSERT: rev = 1. UPDATE: the incoming rev must equal the stored rev (the version the
-- client edited), otherwise SQLSTATE BB409 'sync_conflict'; then rev + 1.
-- Server-side functions that do not touch rev pass the check automatically.
create or replace function public.sync_stamp()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.rev := 1;
    new.created_at := coalesce(new.created_at, now());
  else
    if new.rev is distinct from old.rev then
      raise exception 'sync_conflict' using errcode = 'BB409',
        detail = format('%s %s: client rev %s, server rev %s', tg_table_name, old.id, new.rev, old.rev);
    end if;
    if new.org_id is distinct from old.org_id then
      raise exception 'org_id cannot change';
    end if;
    new.rev := old.rev + 1;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_touch before update on public.organizations
  for each row execute function public.touch_updated_at();
create trigger user_profiles_touch before update on public.user_profiles
  for each row execute function public.touch_updated_at();

-- ───────────────────────── company settings ─────────────────────────
-- Shared part of the app's Settings (company profile, invoice set-up, pricing defaults).
-- Theme and backup preferences stay on each device.

create table public.org_settings (
  org_id                uuid primary key references public.organizations (id) on delete cascade,
  business_name         text not null default '',
  business_tagline      text not null default '',
  business_address      text not null default '',
  business_phone        text not null default '',
  business_email        text not null default '',
  business_gstin        text not null default '',
  business_state        text not null default '33',
  logo_path             text not null default '',          -- storage: public-media/<org>/logo.png
  bank_holder           text not null default '',
  bank_name             text not null default '',
  bank_account          text not null default '',
  bank_branch           text not null default '',
  bank_ifsc             text not null default '',
  invoice_declaration   text not null default 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  invoice_prefix        text not null default '',
  invoice_reset_yearly  boolean not null default false,    -- true: numbering restarts every 1 April
  order_prefix          text not null default 'ORD-',
  default_hsn           text not null default '48191010',
  default_unit          text not null default 'Nos.',
  currency              text not null default '₹',
  pricing_defaults      jsonb not null default '{"overhead": 0, "profitPct": 25, "taxPct": 5}',
  grievance_officer     text not null default '',          -- DPDP / e-commerce rules, shown on the website
  rev                   int not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  updated_by            uuid
);
create trigger org_settings_stamp before insert or update on public.org_settings
  for each row execute function public.sync_stamp();

-- Next-number counters (orders, invoices). Only reachable through next_number().
create table public.counters (
  org_id  uuid not null references public.organizations (id) on delete cascade,
  kind    text not null,           -- 'order' | 'invoice'
  period  text not null,           -- 'all' or a financial year like '2026-27'
  next    bigint not null default 1,
  primary key (org_id, kind, period)
);

-- ───────────────────────── business data (mirrors src/lib/types.ts) ─────────────────────────

create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null default '',
  company     text not null default '',
  phone       text not null default '',
  email       text not null default '',
  gstin       text not null default '',
  address     text not null default '',
  state_code  text not null default '',
  notes       text not null default '',
  source      text not null default 'app' check (source in ('app', 'web')),
  user_id     uuid references auth.users (id) on delete set null,   -- website login of this buyer
  rev         int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  unique (org_id, user_id)
);
create index on public.customers (org_id, updated_at);

create table public.boxes (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  name         text not null default '',
  customer_id  uuid references public.customers (id) on delete set null,
  spec         jsonb not null,        -- BoxSpec
  pricing      jsonb not null,        -- Pricing
  rev          int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz
);
create index on public.boxes (org_id, updated_at);

create table public.orders (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  number       text not null,         -- 'ORD-0012', or a draft 'D-<device>-<n>' made offline until assign_order_no()
  customer_id  uuid references public.customers (id) on delete restrict,
  date         date not null default current_date,
  due_date     date,
  status       text not null default 'quote'
               check (status in ('quote', 'confirmed', 'production', 'ready', 'delivered', 'cancelled')),
  discount     numeric(14, 2) not null default 0,
  tax_pct      numeric(5, 2) not null default 5,
  notes        text not null default '',
  invoice_no   text,                  -- set once by assign_invoice_no(), never reused
  invoice      jsonb not null default '{}',   -- InvoiceMeta (dispatch grid fields)
  delivery     jsonb not null default '{}',   -- address, pincode, zone, mode, courier, awb, charge
  source       text not null default 'app' check (source in ('app', 'web')),
  rev          int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  unique (org_id, number)
);
create unique index orders_invoice_no_key on public.orders (org_id, invoice_no) where invoice_no is not null;
create index on public.orders (org_id, updated_at);
create index on public.orders (customer_id);

-- Own table (not an array in the order) so two people editing different lines don't clash.
create table public.order_items (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  order_id     uuid not null references public.orders (id) on delete cascade,
  position     int not null default 0,
  description  text not null default '',
  qty          numeric(14, 3) not null default 0,
  rate         numeric(14, 4) not null default 0,
  hsn          text,
  unit         text,
  spec         jsonb,                 -- BoxSpec when the line is a box
  box_id       uuid references public.boxes (id) on delete set null,
  product_id   uuid,                  -- website product (FK added in the shop migration)
  rev          int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz
);
create index on public.order_items (org_id, updated_at);
create index on public.order_items (order_id);

-- Add-only in practice: payments from different devices never overwrite each other.
create table public.payments (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations (id) on delete cascade,
  order_id             uuid not null references public.orders (id) on delete cascade,
  date                 date not null default current_date,
  amount               numeric(14, 2) not null,
  mode                 text not null default '',      -- Cash, UPI, NEFT, Razorpay…
  note                 text not null default '',
  razorpay_payment_id  text unique,
  razorpay_order_id    text,
  rev                  int not null default 1,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  deleted_at           timestamptz
);
create index on public.payments (org_id, updated_at);
create index on public.payments (order_id);

create trigger customers_stamp   before insert or update on public.customers   for each row execute function public.sync_stamp();
create trigger boxes_stamp       before insert or update on public.boxes       for each row execute function public.sync_stamp();
create trigger orders_stamp      before insert or update on public.orders      for each row execute function public.sync_stamp();
create trigger order_items_stamp before insert or update on public.order_items for each row execute function public.sync_stamp();
create trigger payments_stamp    before insert or update on public.payments    for each row execute function public.sync_stamp();

-- Shape used by rajesh-hub supabase-kit createAuditLogger().
create table public.audit_logs (
  id               bigint generated always as identity primary key,
  org_id           uuid references public.organizations (id) on delete cascade default public.my_org(),
  user_id          uuid default auth.uid(),
  user_name        text,
  table_name       text not null,
  record_id        text not null,
  action           text not null,
  previous_values  jsonb,
  new_values       jsonb,
  reason           text,
  created_at       timestamptz not null default now()
);
create index on public.audit_logs (org_id, created_at desc);

-- ───────────────────────── row level security ─────────────────────────

alter table public.organizations enable row level security;
alter table public.user_profiles enable row level security;
alter table public.org_settings  enable row level security;
alter table public.counters      enable row level security;
alter table public.customers     enable row level security;
alter table public.boxes         enable row level security;
alter table public.orders        enable row level security;
alter table public.order_items   enable row level security;
alter table public.payments      enable row level security;
alter table public.audit_logs    enable row level security;

-- Role sets used below:
--   office  = Administrator, Sales, Accounts   (full business data)
--   Production sees jobs only through the *_production views (no prices, no customers' money)
--   Dispatch sees orders that are ready / delivered, with delivery details

create policy "members read own org" on public.organizations
  for select to authenticated using (public.has_role(id));
create policy "admin renames org" on public.organizations
  for update to authenticated using (public.has_role(id, array['Administrator']))
  with check (public.has_role(id, array['Administrator']));

create policy "read own profile or admin reads team" on public.user_profiles
  for select to authenticated
  using (id = auth.uid() or public.has_role(organization_id, array['Administrator']));
-- Inserts/role changes go through create_organization() and the hub invite functions (service role).
create policy "admin updates team" on public.user_profiles
  for update to authenticated
  using (public.has_role(organization_id, array['Administrator']))
  with check (public.has_role(organization_id, array['Administrator']));

create policy "members read settings" on public.org_settings
  for select to authenticated using (public.has_role(org_id));
create policy "admin writes settings" on public.org_settings
  for update to authenticated
  using (public.has_role(org_id, array['Administrator']))
  with check (public.has_role(org_id, array['Administrator']));

-- counters: no policies (only next_number(), SECURITY DEFINER, touches it).

-- customers
create policy "office reads customers" on public.customers
  for select to authenticated using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts', 'Dispatch']));
create policy "buyer reads self" on public.customers
  for select to authenticated using (user_id = auth.uid());
create policy "office inserts customers" on public.customers
  for insert to authenticated with check (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "office updates customers" on public.customers
  for update to authenticated
  using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']))
  with check (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));

-- boxes (saved box specs include paper ₹/kg, so not for Production)
create policy "office reads boxes" on public.boxes
  for select to authenticated using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "office inserts boxes" on public.boxes
  for insert to authenticated with check (public.has_role(org_id, array['Administrator', 'Sales']));
create policy "office updates boxes" on public.boxes
  for update to authenticated
  using (public.has_role(org_id, array['Administrator', 'Sales']))
  with check (public.has_role(org_id, array['Administrator', 'Sales']));

-- orders
create policy "office reads orders" on public.orders
  for select to authenticated using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "dispatch reads ready orders" on public.orders
  for select to authenticated
  using (status in ('ready', 'delivered') and public.has_role(org_id, array['Dispatch']));
create policy "buyer reads own orders" on public.orders
  for select to authenticated
  using (customer_id in (select c.id from public.customers c where c.user_id = auth.uid()));
create policy "office inserts orders" on public.orders
  for insert to authenticated with check (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "office updates orders" on public.orders
  for update to authenticated
  using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']))
  with check (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));

-- order items
create policy "office reads items" on public.order_items
  for select to authenticated using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "dispatch reads ready items" on public.order_items
  for select to authenticated
  using (public.has_role(org_id, array['Dispatch'])
         and order_id in (select o.id from public.orders o where o.status in ('ready', 'delivered')));
create policy "buyer reads own items" on public.order_items
  for select to authenticated
  using (order_id in (select o.id from public.orders o
                      join public.customers c on c.id = o.customer_id
                      where c.user_id = auth.uid()));
create policy "office inserts items" on public.order_items
  for insert to authenticated with check (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "office updates items" on public.order_items
  for update to authenticated
  using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']))
  with check (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));

-- payments
create policy "office reads payments" on public.payments
  for select to authenticated using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "buyer reads own payments" on public.payments
  for select to authenticated
  using (order_id in (select o.id from public.orders o
                      join public.customers c on c.id = o.customer_id
                      where c.user_id = auth.uid()));
create policy "office inserts payments" on public.payments
  for insert to authenticated with check (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "accounts updates payments" on public.payments
  for update to authenticated
  using (public.has_role(org_id, array['Administrator', 'Accounts']))
  with check (public.has_role(org_id, array['Administrator', 'Accounts']));

-- audit log
create policy "members write audit" on public.audit_logs
  for insert to authenticated with check (public.has_role(org_id) and user_id = auth.uid());
create policy "admin reads audit" on public.audit_logs
  for select to authenticated using (public.has_role(org_id, array['Administrator']));

-- No DELETE policies anywhere: records are soft-deleted (deleted_at) so the deletion syncs.
