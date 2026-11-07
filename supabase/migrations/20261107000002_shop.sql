-- Website + shop tables (honeypackers.in). Prices are public (owner's choice).
-- The website reads products / price rules / delivery zones with the anon key.
-- Orders, quotes and enquiries from the website are written by Netlify functions
-- with the service role (price re-checked on the server), never directly by visitors.

-- Standard boxes sold in packs.
create table public.products (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  slug         text not null,
  name         text not null,
  description  text not null default '',
  ply          int not null check (ply in (3, 5, 7, 9)),
  spec         jsonb not null,          -- BoxSpec (inner L × W × H in mm, layers)
  packs        jsonb not null default '[]',   -- [{ "qty": 25, "price": 450 }, …] price per pack, before GST
  hsn          text not null default '48191010',
  tax_pct      numeric(5, 2) not null default 5,
  stock_qty    int,                     -- null = made to order
  photos       text[] not null default '{}',  -- storage paths in public-media
  active       boolean not null default true,
  sort         int not null default 0,
  rev          int not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  unique (org_id, slug)
);
create index on public.products (org_id, updated_at);

alter table public.order_items
  add constraint order_items_product_fk foreign key (product_id) references public.products (id) on delete set null;

-- Web price list for custom boxes (one row per org). Shape of `rules`, read by box-core pricing.ts:
-- {
--   "paper":       [{ "bf": 18, "gsm": 120, "pricePerKg": 42 }, …],
--   "conversionPerKg": { "3": 12, "5": 14, "7": 16, "9": 18 },
--   "printing":    { "perColourPerBox": 0.6, "plateCharge": 1500, "maxColours": 4 },
--   "slabs":       [{ "minQty": 100, "marginPct": 30 }, { "minQty": 500, "marginPct": 22 }, { "minQty": 2000, "marginPct": 15 }],
--   "limits":      { "maxDeckle": 1800, "maxCut": 3200, "minQty": 100 },
--   "grades":      [{ "label": "3 ply · 120 GSM · 18 BF", "ply": 3, "gsm": 120, "bf": 18 }, …]
-- }
create table public.price_rules (
  org_id           uuid primary key references public.organizations (id) on delete cascade,
  rules            jsonb not null default '{}',
  advance_pct      numeric(5, 2) not null default 100 check (advance_pct between 0 and 100),
  min_order_value  numeric(14, 2) not null default 0,
  show_prices      boolean not null default true,
  rev              int not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);

-- Delivery charge by pincode range. mode 'own' = own vehicle, 'courier' = Shiprocket rates, 'pickup' = ex-factory.
create table public.delivery_zones (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  name          text not null,
  pincode_from  int not null check (pincode_from between 100000 and 999999),
  pincode_to    int not null check (pincode_to between 100000 and 999999),
  mode          text not null default 'own' check (mode in ('own', 'courier', 'pickup')),
  rate_per_kg   numeric(10, 2) not null default 0,
  min_charge    numeric(10, 2) not null default 0,
  free_above    numeric(14, 2),         -- order value (before GST) above which delivery is free
  days          int not null default 2,
  active        boolean not null default true,
  sort          int not null default 0,
  rev           int not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  check (pincode_from <= pincode_to)
);
create index on public.delivery_zones (org_id, pincode_from, pincode_to);

-- Custom-box quote requests from the website (or made by staff).
create table public.quotes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id) on delete cascade,
  customer_id   uuid references public.customers (id) on delete set null,
  user_id       uuid references auth.users (id) on delete set null,
  name          text not null default '',
  phone         text not null default '',
  email         text not null default '',
  spec          jsonb not null,           -- BoxSpec
  qty           int not null check (qty > 0),
  printing      jsonb not null default '{}',   -- { "colours": 1, "sides": 1, "artwork": "<storage path>" }
  price_shown   numeric(14, 4),           -- per box, as shown on the website
  price_final   numeric(14, 4),           -- per box, set by staff
  status        text not null default 'new'
                check (status in ('new', 'priced', 'sent', 'accepted', 'paid', 'expired', 'rejected')),
  valid_until   date,
  payment_link  text,
  order_id      uuid references public.orders (id) on delete set null,
  notes         text not null default '',
  rev           int not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz
);
create index on public.quotes (org_id, updated_at);

create table public.enquiries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null default '',
  phone       text not null default '',
  email       text not null default '',
  message     text not null default '',
  page        text not null default '',
  consent     boolean not null default false,   -- agreed to be contacted (DPDP)
  status      text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  rev         int not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz
);
create index on public.enquiries (org_id, updated_at);

create trigger products_stamp       before insert or update on public.products       for each row execute function public.sync_stamp();
create trigger price_rules_stamp    before insert or update on public.price_rules    for each row execute function public.sync_stamp();
create trigger delivery_zones_stamp before insert or update on public.delivery_zones for each row execute function public.sync_stamp();
create trigger quotes_stamp         before insert or update on public.quotes         for each row execute function public.sync_stamp();
create trigger enquiries_stamp      before insert or update on public.enquiries      for each row execute function public.sync_stamp();

alter table public.products       enable row level security;
alter table public.price_rules    enable row level security;
alter table public.delivery_zones enable row level security;
alter table public.quotes         enable row level security;
alter table public.enquiries      enable row level security;

-- products: public catalogue; staff see hidden ones too; only the owner edits.
create policy "public reads active products" on public.products
  for select to anon, authenticated using (active and deleted_at is null);
create policy "staff reads all products" on public.products
  for select to authenticated using (public.has_role(org_id));
create policy "admin inserts products" on public.products
  for insert to authenticated with check (public.has_role(org_id, array['Administrator']));
create policy "admin updates products" on public.products
  for update to authenticated
  using (public.has_role(org_id, array['Administrator']))
  with check (public.has_role(org_id, array['Administrator']));

-- price rules: public (live prices on the site), owner edits.
create policy "public reads price rules" on public.price_rules
  for select to anon, authenticated using (show_prices or public.has_role(org_id));
create policy "admin updates price rules" on public.price_rules
  for update to authenticated
  using (public.has_role(org_id, array['Administrator']))
  with check (public.has_role(org_id, array['Administrator']));

-- delivery zones
create policy "public reads zones" on public.delivery_zones
  for select to anon, authenticated using ((active and deleted_at is null) or public.has_role(org_id));
create policy "admin inserts zones" on public.delivery_zones
  for insert to authenticated with check (public.has_role(org_id, array['Administrator']));
create policy "admin updates zones" on public.delivery_zones
  for update to authenticated
  using (public.has_role(org_id, array['Administrator']))
  with check (public.has_role(org_id, array['Administrator']));

-- quotes: office handles them; a signed-in buyer sees and creates their own.
create policy "office reads quotes" on public.quotes
  for select to authenticated using (public.has_role(org_id, array['Administrator', 'Sales', 'Accounts']));
create policy "buyer reads own quotes" on public.quotes
  for select to authenticated using (user_id = auth.uid());
create policy "office inserts quotes" on public.quotes
  for insert to authenticated with check (public.has_role(org_id, array['Administrator', 'Sales']));
create policy "buyer requests quote" on public.quotes
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'new' and price_final is null and payment_link is null and order_id is null);
create policy "office updates quotes" on public.quotes
  for update to authenticated
  using (public.has_role(org_id, array['Administrator', 'Sales']))
  with check (public.has_role(org_id, array['Administrator', 'Sales']));

-- enquiries: written by the website's Netlify function (service role); office reads/updates.
create policy "office reads enquiries" on public.enquiries
  for select to authenticated using (public.has_role(org_id, array['Administrator', 'Sales']));
create policy "office updates enquiries" on public.enquiries
  for update to authenticated
  using (public.has_role(org_id, array['Administrator', 'Sales']))
  with check (public.has_role(org_id, array['Administrator', 'Sales']));

-- ───────────────────────── views ─────────────────────────

-- Box spec without paper prices (for Production).
create or replace function public.spec_without_prices(spec jsonb)
returns jsonb
language sql immutable
as $$
  select case when spec is null or jsonb_typeof(spec -> 'layers') is distinct from 'array' then spec
    else jsonb_set(spec, '{layers}', coalesce(
      (select jsonb_agg(l.value - 'price' order by l.ordinality)
         from jsonb_array_elements(spec -> 'layers') with ordinality as l(value, ordinality)),
      '[]'::jsonb))
  end;
$$;

-- Production job list: no money, no customer contact details.
-- Plain (definer) views: the WHERE clause does the access check.
create view public.orders_production as
  select o.id, o.org_id, o.number, o.date, o.due_date, o.status, o.notes,
         c.name as customer_name, c.company as customer_company,
         o.rev, o.updated_at, o.deleted_at
  from public.orders o
  left join public.customers c on c.id = o.customer_id
  where o.status in ('confirmed', 'production', 'ready')
    and public.has_role(o.org_id, array['Administrator', 'Production']);

create view public.order_items_production as
  select i.id, i.org_id, i.order_id, i.position, i.description, i.qty, i.unit,
         public.spec_without_prices(i.spec) as spec,
         i.rev, i.updated_at, i.deleted_at
  from public.order_items i
  join public.orders o on o.id = i.order_id
  where o.status in ('confirmed', 'production', 'ready')
    and public.has_role(i.org_id, array['Administrator', 'Production']);

-- Company details the website may show (no bank details, no invoice set-up).
create view public.public_business as
  select org_id, business_name, business_tagline, business_address, business_phone,
         business_email, business_gstin, business_state, logo_path, grievance_officer, currency
  from public.org_settings;

revoke all on public.orders_production, public.order_items_production from anon;
grant select on public.orders_production, public.order_items_production to authenticated;
grant select on public.public_business to anon, authenticated;
