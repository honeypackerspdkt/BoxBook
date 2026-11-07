# Honey Packers online: technical plan

Status: **draft for review** (7 Nov 2026). Done so far: database schema (`supabase/`, `npm run db:test`), shared package `packages/box-core` with web pricing, Web price list screen, cloud sync in the app (`src/lib/cloud`, tested against the real schema), and the website in repo `honeypackers-web`.
It covers the website and online shop at **honeypackers.in**, and cloud sync for the BoxBook app.

## 0. Decisions taken

| Topic | Decision |
|---|---|
| Data | **Full cloud sync.** Supabase is the shared record. The phone keeps a full local copy. |
| Offline | **Offline-first.** The app works with no signal and syncs when the internet is back. Local daily backups and Drive backups stay. |
| Users | **Owner + staff with roles.** |
| What we sell | **Both:** standard boxes in packs (cart) and custom boxes (configurator with live price). |
| Payment | **Razorpay**: checkout, UPI, and payment links for approved quotes. |
| Delivery | **Own vehicle locally**, priced by pincode zone. **Shiprocket courier** elsewhere in India. |
| Domain | **honeypackers.in** |
| Repos | The **website goes in a separate repo** (`honeypackers-web`). The BoxBook app stays in this repo. |
| GST | Default changed to **5%** for HSN 4819. Done in this branch. |
| Supabase | **One project per app** in one shared Supabase organisation (owner creates it). Schema is in `supabase/` in this repo. |
| Prices on site | **Shown to everyone.** |
| Custom orders | **100% payment upfront.** |
| Staff | **Only the owner for now.** Sales, Production, Dispatch and Accounts roles are built in, for later. |
| Business details | Taken from **BoxBook Company profile** (`org_settings`). |

Owner requirement 4 in `CLAUDE.md` ("all data stays on the phone, no server, no login") is **replaced** by the decisions above.
Requirements 5 (file backup and restore) and 6 (daily backup on the phone) **still apply**.

---

## 1. Overview

```
                 ┌───────────────────────── Supabase (Mumbai region) ─────────────────────────┐
                 │ Postgres + RLS   Auth (phone OTP / email)   Storage (logo, product photos)  │
                 │ Realtime (change feed)   daily DB backups (Pro)                            │
                 └──────▲───────────────────────▲─────────────────────────────▲───────────────┘
                        │ sync (push/pull)      │ read catalogue, own orders  │ service role
                        │                       │                             │
   BoxBook app (Android/iOS/web)       honeypackers.in (Astro, Netlify)   Netlify functions
   - local copy of org data            - static pages, SEO, Tamil         - price-quote
   - outbox of unsent changes          - configurator (box-core + 3D)     - create-order / checkout
   - staff login + roles               - cart, buyer account              - razorpay-webhook
   - "Web orders" inbox                                                   - shiprocket rates / AWB
                                                                          - whatsapp notify
```

**Shared code: `@honeypackers/box-core`**
- Contents: `calc.ts`, `box3d.ts`, `gst.ts`, `words.ts`, `invoice.ts`, the types, and a new `pricing.ts` (section 4).
- Location: `packages/box-core` in this repo (**done**, npm workspace). The website repo links it with `file:../BoxBook/packages/box-core`, the same way the rajesh-hub packages are linked; publishing to GitHub Packages can come later if needed.
- Why: the price a buyer sees, the price the server charges and the price staff quote are then always the same.

**Reused from rajesh-hub instead of rebuilt** (CATALOGUE codes):

| Need | Hub item | State |
|---|---|---|
| Supabase client, audit log, feature flags | HUB-AUTH-01, HUB-DATA-09, HUB-PAY-03 (`supabase-kit`) | in hub |
| Phone OTP, staff invites, account deletion | HUB-AUTH-03/07/08 (`supabase-kit/functions`) | in hub |
| Session kept on phones, biometric lock | HUB-AUTH-09, HUB-AUTH-02 (`native`) | in hub |
| Roles and route permissions | HUB-AUTH-04 | **port** from Shop-Manager |
| Organisation tables + RLS | HUB-AUTH-05 | **port** (refactor) |
| Razorpay | HUB-PAY-01 (subscriptions) | **port**, then add one-off Orders API and payment links |
| WhatsApp Cloud API | HUB-MSG-01 | **port** |
| Site template, consent, Pixel + CAPI, WhatsApp button, enquiry form, image CDN, sitemap/feed | `templates/site`, `web-growth` | in hub |
| Website admin / Publish button, catalogue | HUB-WEB-02/03 | **port** (only partly needed, because catalogue editing moves into BoxBook) |
| English + Tamil site | HUB-WEB-08 | **port** |
| Keep free Supabase awake (development only) | HUB-OPS-02 | in hub |

---

## 2. Database (Supabase Postgres)

Common rules for every business table:
- Columns `org_id`, `id uuid` (generated on the device so records can be created offline), `rev int`, `updated_at timestamptz` (set by a trigger, server clock), `updated_by uuid`, `deleted_at timestamptz` (soft delete, so other devices learn about deletions).
- Row-level security (RLS) on every table.

### 2.1 Organisation and people
| Table | Key columns |
|---|---|
| `organizations` | name, slug |
| `user_profiles` | staff only: organization_id, role (`Administrator` `Sales` `Production` `Dispatch` `Accounts`), is_active. Names match the rajesh-hub supabase-kit functions. |
| buyers | no table: `customers.user_id` links a website login to a customer record (`buyer_link()`). |

### 2.2 Core business (mirrors `src/lib/types.ts`)
| Table | From | Notes |
|---|---|---|
| `customers` | `Customer` | + `source` (`app`/`web`), `user_id` when the customer has a web login |
| `boxes` | `SavedBox` | `spec jsonb`, `pricing jsonb` |
| `orders` | `Order` | `number` and `invoice_no` are unique per org. `source`, `status`, `discount`, `tax_pct`, `invoice jsonb`, `delivery jsonb` (address, zone, courier, AWB), `notes` |
| `order_items` | `OrderItem` | **Its own table** (not an array inside the order), so two people editing different lines don't overwrite each other |
| `payments` | `Payment` | **Its own table**, add-only. + `razorpay_payment_id`, `method`. Adds from different devices never clash. |
| `org_settings` | shared part of `Settings` | company profile, bank, invoice prefix, default HSN/unit, pricing defaults. One row per org. |
| `counters` | — | `(org_id, kind, fy) → next`, for order and invoice numbers (section 3.4) |
| `audit_log` | hub | who changed what |

Settings that stay **only on the device**: theme, auto-backup settings, last backup times, Drive settings.

### 2.3 Website and shop
| Table | Key columns |
|---|---|
| `products` | slug, name, description, photos[], `spec jsonb`, ply, pack sizes `[{qty, price}]`, stock qty, active, sort |
| `price_rules` | one row per org (JSON): paper ₹/kg by BF/GSM, conversion ₹/kg by ply, printing (per colour, plate charge), quantity slabs (margin %), minimum order value, minimum quantity, size limits (max deckle, max cut size) |
| `delivery_zones` | pincode ranges or prefixes → mode (`own`/`courier`), ₹ per kg, minimum charge, free above ₹X, days |
| `quotes` | a custom-box request: spec, qty, price shown, status (`new` `priced` `sent` `accepted` `expired`), valid until, payment link |
| `carts` | not stored: the cart lives in the browser until checkout |
| `enquiries` | name, phone, message, page, consent; from the contact form |

### 2.4 RLS summary
- **Staff:** read and write rows where `org_id` is in their memberships. The role limits it further:
  - `production` cannot see prices or payments. It gets a view `orders_production` with no money columns.
  - `dispatch` sees orders that are ready or delivered, plus the delivery fields.
  - `accounts` and `owner` see everything. Only `owner` changes `price_rules`, `org_settings` and members.
- **Buyers:** read their own `customers` row and their own orders, items and payments (by `user_id`). They can **insert** quotes and enquiries. They cannot update prices.
- **Public (no login):** read active `products`, a public view of `price_rules` (rates needed for the live price only) and `delivery_zones`.
- **Netlify functions** use the service key only for checkout, webhooks and notifications.
- RLS is tested with SQL tests (pgTAP or plain `vitest` against a local `supabase start`).

---

## 3. Offline-first sync for BoxBook

The data is small (thousands of rows), so I recommend a **custom sync** instead of a sync framework (PowerSync, RxDB, ElectricSQL). It keeps the current JSON store and backup format, and adds no paid service. If staff numbers or data grow a lot, PowerSync is the upgrade path.

### 3.1 On the device
- `boxbook-data.json` stays the local store. Schema version 2 adds `rev`, `deletedAt` and `syncedAt` to each record.
- New `outbox.json`: a queue of `{table, id, op, baseRev, row}` for changes not yet sent. It is written atomically, the same way as the data file.
- New `sync.json`: `lastPulledAt` (server time), `orgId`, `userId`.
- The `commit()` in `store.tsx` already sees every change. It will also add an outbox entry.

### 3.2 Push (device → cloud)
- When it runs: on launch, on resume, when the network comes back, 2 seconds after any edit, and every 5 minutes while open.
- The batch goes to a Postgres function `sync_push(rows jsonb)`. For each row:
  - if `baseRev = current rev`, apply it and add 1 to `rev`;
  - else return a **conflict** with the server row.
- Conflict rules:
  - `payments` and `order_items` are add-only or edited per line, so conflicts are rare.
  - **Same record edited on two devices:** field-level merge (fields changed on only one side are kept). For a field changed on both sides the newer change wins, and the other value goes into an "Edit conflicts" list the owner can review.
  - **Delete vs edit:** the delete wins, and the record can be restored from the conflict list.

### 3.3 Pull (cloud → device)
- `select … where org_id = ? and updated_at > lastPulledAt` for each table, in pages.
- Rows are merged into local data, skipping rows that are still in the outbox.
- **Supabase Realtime** sends a "something changed" signal while the app is open, so staff see new web orders within seconds.
- With no signal nothing changes: the app works as it does today.

### 3.4 Numbers that must never repeat
- GST invoices need **one unique, sequential number per financial year**, e.g. `HP/26-27/0001`.
  - Invoice numbers are assigned **only online**, by `next_number('invoice', fy)` (one transaction).
  - With no signal, "Make invoice" says "Needs internet to assign an invoice number".
- Order numbers can be made offline as `D-<device>-<n>`. They get a real number (`HP-0123`) on the first sync, and both are shown until then.

### 3.5 First login and moving existing data
1. The owner signs up. This creates the org and the owner membership.
2. "Move my BoxBook data to the cloud":
   - takes a local safety backup;
   - uploads customers, boxes, orders, items and payments, and settings;
   - copies the logo to Storage;
   - keeps the order and invoice counters.
3. Staff are invited by phone number (hub invite function). On their first login they download the org data.
4. Logging out deletes local data (after a warning if the outbox is not empty).

### 3.6 Backups after the move
- **Kept:** local daily backups, Drive backups, and export and restore to a file.
  - A backup is still the full org data as JSON, so `normalize()` still reads it.
  - Restoring a file into a cloud org = **import**. It asks first, then adds or overwrites records through the outbox.
- **Added:** Supabase daily backups (Pro plan), plus a weekly `pg_dump` to Drive or storage by a scheduled function.

---

## 4. Pricing for the website (`box-core/pricing.ts`)

```
calcBox(spec)                 → weight, BS, paperCost (existing)
conversion = weightKg × conversion₹/kg[ply]
printing   = colours × ₹/colour/box + plateCharge / qty
base       = paperCost + conversion + printing
slab       = margin % for the quantity (e.g. 100–499: 30%, 500–1999: 22%, 2000+: 15%)
price/box  = round(base × (1 + slab), 2)  → estimate() adds GST 5%
order      = price/box × qty + delivery + GST on goods (and on delivery, at the supply rate)
```

- Paper ₹/kg is chosen from BF/GSM using `price_rules`. The buyer only picks a grade, such as "3 ply · 120 GSM · 18 BF".
- Sizes outside limits (deckle or cut size too big, quantity below minimum) show "Request a quote" instead of a price.
- The **server recalculates the price** in `create-order` with the same package, and refuses an order whose amount doesn't match.
- The owner edits `price_rules` in a new BoxBook screen, **"Web price list"**, with a preview of 5 sample boxes.

---

## 5. Website: honeypackers.in (repo `honeypackers-web`)

The site starts from `rajesh-hub/templates/site`: Astro on Netlify, hub tokens, web-growth.

### 5.1 Pages
| Page | Content |
|---|---|
| `/` Home | headline, ply range, industries served, why us (in-house BS testing, local delivery), WhatsApp, reviews |
| `/products/` + `/products/<slug>` | standard boxes: photos, size, ply, BS, pack prices, add to cart |
| `/custom-box/` | **configurator**: L×W×H, ply, grade, printing, qty → live 3D box, BS, weight, price slabs → "Pay advance / Order sample / Request quote" |
| `/box-calculator/` | free tool (strength, weight, sheet size) for search traffic. Links to the configurator. |
| `/industries/<x>` | e-commerce, FMCG, pharma, textiles, auto parts, agriculture. Each is a search landing page. |
| `/guides/<x>` | e.g. "3 ply vs 5 ply", "What BS do I need?", "Box price per piece explained" |
| `/cart`, `/checkout`, `/account` | cart, address + GSTIN, Razorpay; buyer account (orders, invoices, re-order, amount due) |
| `/about`, `/contact`, `/quality` | factory, machines, map, Google Business Profile link |
| `/policies/*` | privacy (DPDP), terms, refund and cancellation, shipping, grievance officer |
| `/ta/…` | Tamil version of the main pages (HUB-WEB-08) |
| `/catalog.xml`, `/sitemap.xml` | Google Merchant / Meta feed, sitemap |

### 5.2 Checkout flows
1. **Standard pack:**
   - cart → pincode check (zone or courier, delivery charge, days) → login with phone OTP → address + GSTIN (optional) → Razorpay.
   - Then the webhook marks it paid, the order becomes `confirmed`, and it appears in the BoxBook "Web orders" inbox.
2. **Custom with live price:**
   - Custom orders are paid **100% upfront** at checkout (`price_rules.advance_pct`, default 100).
   - "Order a sample" is a fixed-price sample item.
3. **Request quote:**
   - creates a `quotes` row → staff price it in BoxBook → WhatsApp + e-mail with a Razorpay payment link → when paid it becomes an order.
4. **Business buyers on credit:** when the owner sets a credit limit in BoxBook, checkout offers "Pay later (NEFT, 30 days)".

### 5.3 Netlify functions
| Function | Does |
|---|---|
| `price-quote` | prices a spec on the server (also used by the configurator for slab tables) |
| `create-order` | checks the cart and prices, creates order + items, makes a Razorpay order, returns the checkout options |
| `razorpay-webhook` | checks the signature → inserts the payment → order `confirmed` → WhatsApp/e-mail → notification to the BoxBook app |
| `payment-link` | called from the BoxBook app for quotes and balances |
| `shipping-rates` | own-zone charge, or Shiprocket serviceability/rates for courier pincodes |
| `shiprocket-book` | creates the shipment and AWB from BoxBook "Dispatch" |
| `whatsapp-notify` | utility templates: order confirmed, invoice PDF, dispatched with tracking, payment reminder |
| `invoice-pdf` | builds the invoice with `box-core/invoice.ts` (jsPDF works in Node) for the buyer account |

---

## 6. BoxBook app changes

| Area | Change |
|---|---|
| Login | Mobile number + SMS code through **MSG91** (Supabase Send SMS hook) or e-mail code, org choice, biometric unlock (hub `native`), "Work offline" while signed in |
| Store | outbox + push/pull (section 3), sync status in the header (✓ synced · ⟳ 3 waiting · ⚠ offline), "Edit conflicts" list |
| Roles | screens and money fields hidden by role (production sees sizes, qty and due date only) |
| Web orders | inbox tab/badge: new paid orders, quote requests, enquiries → accept, price, send link, reject |
| Web price list | edit `price_rules` + preview; products (photos to Storage, pack prices, stock, show on site) |
| Dispatch | mark ready → choose own vehicle or courier → Shiprocket AWB → buyer gets a WhatsApp message with tracking |
| Invoices | number assigned online (section 3.4); PDF also uploaded so the buyer can download it from their account |
| Staff | invite, set role, deactivate (owner only) |
| Account | delete account (needed by the app stores, hub HUB-AUTH-07) |

---

## 7. Law, tax and policies
- **GST:**
  - boxes 5% (HSN 4819 10/20) since 22 Sep 2025; get the CA to confirm the rate for printed or laminated boxes;
  - CGST+SGST vs IGST by place of supply (already in `invoice.ts`);
  - delivery charges are taxed with the goods (composite supply).
- **E-invoicing:** only above ₹5 cr turnover. Watch for the threshold being lowered.
- **E-way bill:** consignments above ₹50,000. Add the e-way bill number to the invoice and dispatch screen. Generating it through the API comes later.
- **DPDP Rules 2025** (full compliance by about 13 May 2027):
  - privacy notice at signup and on forms;
  - consent for marketing messages;
  - delete-my-data;
  - grievance contact on the site;
  - reasonable security measures;
  - report a breach within 72 hours.
- **E-commerce rules and Razorpay onboarding:** legal name, address, GSTIN, contact, grievance officer, and refund, shipping and terms pages.

## 8. Costs (approximate)
| Item | Cost |
|---|---|
| Domain honeypackers.in | about ₹800–1,000 a year |
| Netlify | free tier at first |
| Supabase | free while building; **Pro about $25 a month** at launch (no pausing, daily backups) |
| Razorpay | about 2% + GST per online payment; NEFT outside Razorpay is free |
| WhatsApp Cloud API | about ₹0.12–0.15 per utility message; marketing messages cost more |
| Shiprocket | per shipment (rates by weight and zone) |
| Apple developer account | $99 a year (iOS release) |
| Google Play | $25 once |

## 9. Phases

| # | Phase | Main work | Done when |
|---|---|---|---|
| 0 | Groundwork | `packages/box-core` + GitHub Packages; Supabase project (Mumbai); schema + RLS + tests; port HUB-AUTH-04/05 | RLS tests pass; app and site import box-core |
| 1 | Cloud BoxBook | login, roles, outbox/push/pull, number counters, data move, staff invites, conflict list | 2 phones offline → edit → reconnect → same data; invoice numbers never repeat |
| 2 | Showroom site | Astro site, pages 5.1 (no cart), free calculator + 3D, enquiries → app inbox, Tamil, SEO, Google Business Profile | live on honeypackers.in; Lighthouse ≥ 90 on mobile |
| 3 | Configurator + quotes | `pricing.ts`, web price list screen, `/custom-box`, quote requests, payment links | owner prices a quote in the app and the buyer pays by link |
| 4 | Shop + delivery | products, cart, checkout, webhook, zones, Shiprocket, WhatsApp notices, buyer account + invoices | test-mode order paid → appears in app → dispatched with AWB |
| 5 | Growth | IndiaMART/TradeIndia listings, Merchant feed, Pixel/CAPI ads, guides, credit customers, ONDC later | — |

## 10. Still to decide
1. ~~Supabase account~~: owner will create one shared organisation for all apps, one project per app.
2. Business details for the site and Razorpay: legal name, address, GSTIN, grievance officer name.
3. Standard box list: the sizes, plies and pack quantities to sell online first.
4. Delivery zones: pincodes covered by your own vehicle, charge per kg or per trip, free-delivery limit.
5. ~~Advance %~~ (100% upfront). Minimum order value is still open.
6. ~~Staff~~: only the owner for now; all four roles are built in.
7. ~~Prices~~: shown to everyone.
