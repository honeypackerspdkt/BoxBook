# BoxBook / Honey Packers database (Supabase)

Plan: [`docs/online-business-plan.md`](../docs/online-business-plan.md). One Supabase **project per app** inside one shared Supabase organisation.

## Files
| File | What it makes |
|---|---|
| `migrations/…01_core.sql` | `organizations`, `user_profiles` (staff + role), `org_settings` (company profile), `counters`, `customers`, `boxes`, `orders`, `order_items`, `payments`, `audit_logs`, row versioning trigger, RLS |
| `migrations/…02_shop.sql` | `products`, `price_rules` (web price list, 100% advance by default), `delivery_zones`, `quotes`, `enquiries`, views `orders_production`, `order_items_production`, `public_business` |
| `migrations/…03_functions.sql` | `create_organization`, `next_number`, `set_counter`, `assign_order_no`, `assign_invoice_no`, `set_order_status`, `buyer_link`, `sync_push`, `sync_pull` |
| `migrations/…05_staff.sql` | `invitations`, `my_invitation()`, `accept_invitation()`: the owner invites an e-mail + role, that person signs in with the same e-mail and joins; a business always keeps one active owner |
| `migrations/…04_storage.sql` | buckets `public-media` (logo, product photos) and `private` (invoices, artwork) + policies |
| `tests/schema.test.sql` | RLS and sync tests for every role (owner, sales, production, dispatch, other business, buyers, anonymous) |
| `tests/supabase_stub.sql` | stand-in for Supabase's `auth` / `storage` schemas, **tests only** |

## Roles
| Role | Can |
|---|---|
| Administrator (owner) | everything: company settings, web price list, products, delivery zones, staff |
| Sales | customers, saved boxes, orders, items, payments, quotes, enquiries |
| Accounts | customers, orders, items, payments (can also correct payments), invoice numbers |
| Production | job list only (`orders_production` / `order_items_production`): sizes, ply, qty, due date, no prices; moves confirmed → production → ready |
| Dispatch | ready / delivered orders with address; marks delivered and fills delivery details |
| Website buyer | their own customer record, orders, items, payments, quotes (linked by `buyer_link` after phone OTP) |
| Anonymous visitor | active products, price lists, delivery zones, public company details, public media |

Website orders, quotes from visitors who are not signed in, and enquiries are written by the website's
Netlify functions with the service role key, after the price has been checked on the server.

## Test locally
```bash
npm run db:test        # throw-away Postgres 15+; needs initdb/pg_ctl/psql (apt install postgresql)
```

## Put it on Supabase (when the shared account is ready)
1. supabase.com → your organisation → **New project** "boxbook", region **Mumbai (ap-south-1)**, save the DB password.
2. Either
   - **SQL editor:** paste and run the four files in `migrations/` in order (01 → 04), or
   - **CLI:** `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`.
3. Auth → Providers: **Email** on (the app signs in with a 6-digit e-mail code). Auth → Email Templates → "Magic Link":
   put the code in the e-mail, e.g. `Your BoxBook code: {{ .Token }}` (the default template only has a link, which the phone app can't use).
   Phone sign-in for website buyers later needs an SMS provider (e.g. Twilio / MSG91).
4. Project settings → API: copy the URL and anon key into the app's `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), then build.
   The app then shows More → Cloud sync → sign in → "Create and move my data".
   The service role key goes **only** into Netlify environment variables, never into the app.
5. Staff are invited from the app (More → Staff), which needs no edge function. The hub's invite-user / create-user functions are
   optional; if used, set their `VALID_ROLES` to `["Administrator","Sales","Accounts","Production","Dispatch"]`.

## Notes
- `price_rules.rules` is readable by everyone because website prices are public (owner's choice). It contains paper ₹/kg
  and margins. If that should stay private later, set `show_prices = false` and price on the server only.
- `org_settings` and `price_rules` are edited directly (PostgREST update with the current `rev`), not through `sync_push`.
- GST invoice numbers are only handed out online (`assign_invoice_no`), so two phones can never use the same number.
