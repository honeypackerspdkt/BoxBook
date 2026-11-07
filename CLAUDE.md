# BoxBook — handoff for Claude Code

Corrugated box calculator + customer/order manager for a box-making business.
Rebuilt from scratch (own code) using the maths of the old "eBox" Android app as reference.
One codebase → Android + iOS via **Capacitor 7 + React 19 + Vite 7 + TypeScript + Tailwind 4**, styled with the shared **rajesh-hub** packages.

## Owner requirements (from Rajesh)
1. Modern UI (mobile-first, light/dark, bottom tab bar).
2. Box calculator (same results as eBox) + price estimate (overhead, profit %, GST %).
3. **Order management**: customers and orders.
4. **All data stays on the phone** — no server, no login, no cloud.
   **Superseded (7 Nov 2026):** owner chose full cloud sync (Supabase, offline-first, staff roles) plus the website/shop at honeypackers.in. See `docs/online-business-plan.md`.
5. **Backup to file + restore from file**.
6. **Automatic daily backup on the phone**.
7. Build for **Android and iOS**.

## Working with the owner
- Always ask questions as selectable choices (AskUserQuestion), never as open-ended text questions.

## Status

### Shared package `packages/box-core` (`@honeypackers/box-core`, npm workspace)
- `calc`, `box3d`, `gst`, `words`, `invoice` (+ their tests and the Roboto fonts) moved here from `src/lib` / `src/assets` so the app,
  the honeypackers.in website and its server functions use the same code. **Below, `lib/calc.ts`, `lib/box3d.ts`, `lib/gst.ts`,
  `lib/words.ts`, `lib/invoice.ts` mean `packages/box-core/src/…`.** The app imports e.g. `@honeypackers/box-core/calc`.
- `types.ts` there holds the data model + `CompanySettings` (shared company/invoice/pricing fields); the app's `src/lib/types.ts`
  re-exports it and adds device-only `Settings` fields and `AppData`. `company.ts` has `defaultCompany` (GST default 5%).
- `pricing.ts` — web price list (`PriceRules`, stored in Supabase `price_rules.rules`): `priceCustomBox` (paper from `calcBox` +
  conversion ₹/kg by ply + printing + quantity-slab margin, size/qty limits), `slabTable`, `findZone`/`deliveryCharge` (pincode zones),
  `checkoutTotals` (GST on goods + delivery), `advanceAmount`. Tested in `pricing.test.ts` with hand-worked numbers.
- `WebShop` (rules + delivery zones + advance % + minimum order + show prices), `defaultWebShop`, `normalizeWebShop`, `setupProblems`, `gradeLabel`.
- App: `AppData.web` holds the web price list (in backups; older files load with defaults), `store.updateWeb()`.
  Screen `screens/WebPrices.tsx` (route `webPrices`; More → Web price list, desktop sidebar): paper rates, conversion ₹/kg per ply,
  board grades (sheet editor, same or per-layer paper), quantity slabs, printing, order/machine limits (0 = none), delivery zones
  (sheet editor), readiness checklist and a live buyer preview (slab table + cost breakdown). Synced to Supabase `price_rules` /
  `delivery_zones` once cloud sync exists.
- Source is consumed as TypeScript (no build step). Typecheck: `npx tsc -p packages/box-core`. Tests run with the app's `npx vitest run`.


### Done (in `src/`)
- `lib/types.ts` — data model: Customer, Order (items, payments, status, discount, GST), SavedBox, Settings, AppData.
- `lib/calc.ts` — box maths ported from eBox + `estimate()` + `orderTotals()`.
  `lib/calc.test.ts` checks it against a literal port of the original code (33 tests pass: `npx vitest run`).
- `lib/storage.ts` — persistence. Native: JSON file `boxbook-data.json` in `Directory.Data`, written atomically (tmp + rename).
  Web/dev: localStorage. `normalize()` validates/upgrades files.
- `lib/backup.ts` — `saveBackupOnDevice(data, 'auto'|'manual', keep)` (tries `Documents/BoxBook/Backups`, falls back to app storage),
  `listBackups`, `readBackup`, `deleteBackup`, `exportBackup` (writes to cache + native share sheet), `shareBackupEntry`, `parseBackupFile(File)`.
  Auto backups are named `BoxBook-auto-YYYY-MM-DD.json`, pruned to `settings.keepBackups` (default 14).
- `lib/format.ts` — ids, dates, ₹ formatting (en-IN), tel/WhatsApp links.
- `lib/share.ts` — `shareText`, `boxSpecText`, `orderText` (WhatsApp-friendly quotation/order text).
- `store.tsx` — `StoreProvider`/`useStore()`: all CRUD, debounced save, **daily auto-backup** on launch, on app resume
  (`@capacitor/app` appStateChange), on visibilitychange and every 30 min; safety backup before restore (`replaceAll`); `toast()`.
- `nav.tsx` — tiny stack router: tabs `home | orders | customers | calc | more`, pushed routes
  (`order`, `orderEdit{id?,customerId?,prefill?}`, `customer`, `customerEdit`, `box{id?,customerId?}`, `boxes`, `backup`, `business`),
  Android hardware back button handling, `onBack()` interceptors for sheets.
- `ui.tsx` — Header, Page, Section, Field, NumInput, Segmented, Toggle, Row/List, Avatar, Empty, Sheet (bottom sheet), Confirm,
  StatusChip + `STATUS`/`STATUS_FLOW`, Stat, SearchBox, Fab.
- `screens/Calculator.tsx` — calculator tab + saved-box editor (save box, create order from it, share).
- `screens/Customers.tsx` — `CustomersList`, `CustomerDetail` (call/WhatsApp, stats, orders, saved boxes), `CustomerEdit`, `Missing`.
- `index.css` + `tailwind.config.js` — design tokens (kraft-brown accent, light & dark via `.dark` class), component classes
  (`.input .label .card .btn-primary .btn-ghost .btn-danger .chip`), safe-area helpers.
- `public/icon.svg` — app icon.

### Done (second pass)
- `screens/Orders.tsx`, `screens/Home.tsx`, `screens/More.tsx` (More, BoxesList, Business), `screens/Backup.tsx`, `App.tsx` shell.
- `capacitor.config.ts` (appId `in.boxbook.app`), native projects added (`android/`, `ios/`), manifest/Info.plist edits applied,
  icons + splash generated from `assets/` (re-run `npx capacitor-assets generate` after changing them).
- Verified: `npx tsc -b`, `npx vitest run` (33 pass), web build, Android debug APK on an emulator, iOS build on the simulator.

### Tax invoice PDF + company profile
- `screens/Company.tsx` (route `company`; More → Company profile, desktop sidebar entry): logo upload (resized to ≤400px PNG data URL),
  name, tagline, address, mobile, e-mail, GSTIN + state, bank details, invoice prefix / next number, default HSN + unit, declaration.
  All stored in `Settings` (`business*`, `bank*`, `invoice*`, `nextInvoiceNo`, `defaultHsn/Unit`), so every backup/export contains the company data **and logo**.
  The old Business screen is now "Pricing defaults" (currency + default overhead/profit/GST).
- Orders carry optional `invoiceNo`, `invoice` (dispatch grid fields) and per-item `hsn` / `unit`; customers carry optional `stateCode`.
  Edited in OrderEdit ("Tax invoice details", HSN/Unit per item) and CustomerEdit ("State (for GST)").
- `lib/invoice.ts`: `buildInvoiceModel` (pure; CGST+SGST vs IGST decided by buyer state vs company state, discount spread before tax, tax per HSN)
  and `drawInvoice`/`createInvoicePdf` (jsPDF, A4, Tally-style "Tax Invoice" layout, multi-page). Fonts: Roboto subset (Apache-2.0, includes ₹) in `src/assets/fonts`.
  `lib/words.ts` (Indian amount in words), `lib/gst.ts` (state codes, `splitTax`), `lib/sharefile.ts` (native share sheet / Web Share / download).
- OrderDetail → "Make & share invoice (PDF)": assigns the next invoice number once, builds the PDF (jspdf is lazy-loaded), opens the share sheet
  (WhatsApp, e-mail, Drive…). In a desktop browser it downloads the file.
- Tests: `lib/invoice.test.ts` (reproduces sample invoice 330: taxable 6,400 + CGST 576 + SGST 576 = 7,552), `gst.test.ts`, `backup.test.ts`.
  Render a sample: `INVOICE_OUT=/tmp/x.pdf npx vitest run src/lib/invoice.test.ts`, then `sips -s format png x.pdf --out x.png`.
- Not yet checked on a real phone: WhatsApp as the share target (emulator showed the system share sheet with the PDF).

### Shared hub (rajesh-hub)
- UI and theme come from `~/rajesh-hub` (GitHub `yuvarajeshsp-cloud/rajesh-hub`), linked with `file:` deps:
  `@rajesh-hub/ui`, `@rajesh-hub/tokens`, `@rajesh-hub/print`. Clone it next to this folder and run `npm install` in both.
- `src/index.css` imports hub tokens (`app.css`, `mobile.css`); colours are hub names (`bg-background`, `bg-card`, `text-muted-foreground`,
  `bg-primary`…). Only `good`/`warn`/`bad` are local aliases onto hub tokens.
- `src/ui.tsx` keeps BoxBook's API but is built on hub `Sheet`, `AlertDialog`, `Switch`, `Input`; `App.tsx` uses hub `BottomNav`, `Toaster`, `BrandProvider`.
- `BottomNav` was ported into the hub from Embroidery-Shop-Manager (uncommitted in the hub checkout until pushed).
- `vite.config.ts` dedupes react/react-dom/sonner and `tsconfig.app.json` pins React types so the linked hub code shares this app's copy.
- Not used from the hub yet: offline-store, native, thermal printing (BoxBook keeps its own storage/backup).

### Remaining
- Pick the final appId before publishing (changing it later means editing both native projects).
- Release signing: create a keystore for `assembleRelease` (Android); pick a team in Xcode for a real iPhone.
- Not yet tested on a physical phone: share sheet, restore-from-file picker, WhatsApp/tel links.

### Supabase schema (cloud sync + website)
- `supabase/migrations/*.sql` (core, shop, functions, storage) + `supabase/README.md` (roles, how to apply). Not applied to any real project yet:
  the owner is creating one shared Supabase organisation with one project per app.
- Tables use the hub names `organizations`, `user_profiles`, `audit_logs`. Synced tables carry `id, org_id, rev, updated_at, updated_by, deleted_at`;
  trigger `sync_stamp` rejects an update whose `rev` is not the stored one (SQLSTATE `BB409`). `sync_push(changes)` / `sync_pull(since)` are the sync RPCs;
  invoice numbers only via `assign_invoice_no()` (online).
- Test: `npm run db:test` (throw-away local Postgres + `supabase/tests/supabase_stub.sql`, then `supabase/tests/schema.test.sql`).

### Cloud sync in the app (`src/lib/cloud/`, screen `screens/Cloud.tsx`, route `cloud`)
- Off unless `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set; the Supabase client (`supabase-api.ts`) is lazy-loaded only then.
  Sign-in: 6-digit e-mail code. Session kept in `@capacitor/preferences` (same as hub `capacitorSupabaseStorage`; hub `native` needs Capacitor 8).
- `mapping.ts` app records ↔ rows (orders split into `orders` / `order_items` / `payments`; zones; company settings ↔ `org_settings`;
  web price list ↔ `price_rules`). `merge.ts` three-way field merge (newer edit wins on the same field, loser kept in `state.conflicts`).
- `engine.ts` `SyncEngine`: `track(prev, next)` → outbox (diff of rows); `sync()` = push (`sync_push`, rev check) → pull (`sync_pull`) → push;
  conflicts merged with the stored server copy (`state.base`); draft order numbers `D-<device>-<n>` get the real one via `assign_order_no`
  after upload; `assignInvoiceNo()` online only. Production/Dispatch roles only pull; only the Administrator pushes settings/prices.
- `controller.ts` `CloudController` (phases off / signed-out / no-business / join / ready): `createBusiness` (backup → org → UUID ids via
  `migrate.ts` → counters → upload all), `join('replace'|'merge')`, schedule (2 s after a change, launch, resume, online, every 5 min), sign out.
  State in `boxbook-sync.json` (`state-store.ts`), separate from the data file so backups stay plain data.
- `store.tsx`: `commit` computes from `dataRef` and calls `cloud.track`; server changes come in through `setUntracked`. With sync on, a restore
  from backup is tracked (it changes the cloud too; the restore dialog says so). New ids are UUIDs (`format.uid`).
- Tests: `cloud.test.ts` (unit); `sync.it.test.ts` + `pg-api.ts` run two/three phones against the real schema in `npm run db:test`.
- Staff: `supabase/migrations/…05_staff.sql` (invitations; `accept_invitation()` when the invited e-mail signs in; at least one active owner).
  `screens/Team.tsx` (route `team`, More → Staff, owner + cloud on): members (role, switch off), invite e-mail + role, cancel invites.
  Cloud screen shows "You're invited" in phase no-business when `my_invitation()` finds one.
- Roles in the UI: `lib/roles.ts` (`perms`, `tabsFor`, `canMoveStatus` = same rules as SQL `set_order_status`), `usePerms()` in `store.tsx`
  (no cloud = owner). Production/Dispatch: no prices (orders, calculator), no customers tab, only their status step, sent through
  `cloud.setOrderStatus` (server-checked) then pulled. Sales/Accounts: no company settings / web prices / staff.
  A candidate for the hub's HUB-AUTH-04 (roles & route permissions) once the hub can be pushed.
- Sign-in: **mobile number + SMS code via MSG91** (default) or e-mail code. Supabase makes/verifies the code; the Auth "Send SMS" hook
  Edge Function `supabase/functions/send-sms-msg91` (`handler.ts` pure + tested with `standardwebhooks`; `index.ts` Deno entry) sends it
  through the MSG91 flow API (`MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `MSG91_OTP_VAR`, `SEND_SMS_HOOK_SECRET`). Setup: `supabase/README.md`.
  Staff can be invited by mobile number (`…06_phone_login.sql`: `invitations.phone`, last 10 digits, `phone10()`).
- Not done yet: logo upload to storage, Realtime push (polling for now).

### Build commands
- Web + sync: `npm run build && LANG=en_US.UTF-8 npx cap sync`
- Android debug APK: `cd android && ./gradlew assembleDebug` -> `android/app/build/outputs/apk/debug/app-debug.apk` (needs ~3 GB free disk the first time)
- iOS: `npx cap open ios` (CocoaPods; run `pod` with `LANG=en_US.UTF-8`)

## Notes / decisions
- Data volume is small (hundreds–thousands of records) so a single JSON file is used instead of SQLite; keeps backup = exact copy.
- Daily backup runs when the app is opened/resumed (iOS does not allow reliable background jobs); once per calendar day.
- Android backups in public `Documents/BoxBook/Backups` survive uninstall; iOS backups live in the app's Documents (visible in Files).
  Users should still export to Google Drive / WhatsApp now and then — the Backup screen should say so.
- Box maths (see `calc.ts` doc comment): cut size 2L+2W+50 (2 sheets if ≥1600), deckle W+H+20/30/50 by ply, flute take-up 1.4,
  BS = Σ GSM×BF/1000 with flutes ×0.5, paper cost = Σ layer kg × ₹/kg.

## 3D box view
- `lib/box3d.ts` — pure geometry: cuboid vertices (bit0 = length x, bit1 = height y, bit2 = width z), yaw/pitch rotation, mild perspective,
  per-face visibility + shade, 12 edges (hidden ones flagged), and `dimensionLines()` which picks, per axis, the outermost visible
  silhouette edge and offsets a dimension line outside the box so the numbers stay readable from any angle (skipped when an axis points at the viewer).
  Tested in `lib/box3d.test.ts`.
- `Box3D.tsx` — SVG renderer (no 3D library). Drag / arrow keys rotate, play button auto-turns (respects reduced motion), reset button.
  Colours are `color-mix` of the hub `--primary`, so it follows light/dark. Shows "L 300 / H 150 / W 200" labels + a caption with the sizes.
- Used in `screens/Calculator.tsx` under the size inputs, so it appears both while creating a box and in a saved box, and updates as you type.

## Google Drive backup
- `lib/drive.ts` — sign-in + Drive REST. Scope `drive.file email`: the app only sees files it created, in a "BoxBook Backups" folder.
  - Web: Google Identity Services token popup (1-hour token, cannot refresh silently, so the daily upload only runs while signed in).
  - Phone: system browser (`@capacitor/browser`) + OAuth code flow with PKCE and the redirect `com.googleusercontent.apps.<id>:/oauth2redirect`
    (caught via `appUrlOpen`); gives a refresh token so the daily upload works unattended.
  - Tokens live in localStorage key `boxbook-drive-auth` (not in backups). Settings: `driveAuto`, `lastDriveBackupAt`, `lastDriveAutoBackup`.
- `screens/Help.tsx` — Help & FAQ + privacy policy (More → Help & FAQ, desktop sidebar). On the web `…/#help` and `…/#privacy` open it directly
  (use `https://yuvarajeshsp-cloud.github.io/BoxBook/#privacy` as the privacy-policy link on the Google consent screen).
- `screens/DriveBackup.tsx` — card on the Backup screen: connect, upload now, restore from Drive (list → same restore confirm), daily-upload switch, disconnect.
- `store.tsx` — `driveBackupIfDue()` runs next to the local daily backup (launch / resume / 30 min), never opens a sign-in window.
- Daily file is `BoxBook-auto-YYYY-MM-DD.json` (overwritten that day, pruned to `keepBackups`); manual ones are `BoxBook-backup-<stamp>.json`.
- Tested with mocked network in `lib/drive.test.ts` (PKCE vector, token refresh, folder create, upload/overwrite, prune, list, download).
  **Not tested against real Google** (needs the client ids below).

### One-time setup (needs the owner's Google account)
1. console.cloud.google.com → new project "BoxBook" → APIs & Services → enable **Google Drive API**.
2. OAuth consent screen: External, app name BoxBook, add scopes `.../auth/drive.file` and `email` (both non-sensitive, no Google review needed);
   add yourself under Test users (or publish the app to let anyone sign in).
3. Credentials → Create OAuth client ID:
   - **Web application**: authorised JavaScript origins `https://yuvarajeshsp-cloud.github.io` and `http://localhost:5173`.
   - **Android**: package `in.boxbook.app` + SHA-1 of the signing key (`./gradlew signingReport`); open Advanced settings and enable **custom URI scheme**.
   - **iOS**: bundle id `in.boxbook.app`.
4. Put the ids in `.env.local` (copy `.env.example`): `VITE_GOOGLE_WEB_CLIENT_ID`, `VITE_GOOGLE_ANDROID_CLIENT_ID`, `VITE_GOOGLE_IOS_CLIENT_ID`.
   For the website add a repo variable `GOOGLE_WEB_CLIENT_ID` (Settings → Secrets and variables → Actions → Variables).
5. `npm run drive:native` (registers the redirect scheme in `AndroidManifest.xml` / `Info.plist`; idempotent), then `npm run build && npx cap sync`.
- Without ids the Drive card says "Not set up in this build" and nothing else changes.
