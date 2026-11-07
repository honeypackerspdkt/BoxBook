# Honey Packers: launch checklist

Everything is built and tested on test data. This list switches it on, one service at a time.
Each stage works on its own, so you can stop after any stage.

| Stage | What goes live | Accounts needed | Time |
|---|---|---|---|
| 1 | Website: price calculator, strength calculator, enquiries, WhatsApp | Domain, Netlify | 1 evening |
| 2 | Cloud sync in the app, live prices on the website, SMS login, Inbox, My orders | Supabase, MSG91 | 2–5 days (MSG91 DLT approval) |
| 3 | Online payment on the website, payment links from the app | Razorpay | 3–7 days (Razorpay KYC) |
| 4 | App in the Play Store / App Store | Google Play, Apple | 1–2 weeks (store review) |

---

## Stage 0: before anything

- [ ] **Merge the app branch.** The website's build copies the shared box maths from the BoxBook repo's main branch.
  Merge `claude/loving-allen-f3sugi` into `main` on GitHub (Claude can open the pull request).
  Not merged yet? In Netlify set `BOXBOOK_REF = claude/loving-allen-f3sugi` instead.
- [ ] **Ask your CA** to confirm GST for your boxes: 5% for HSN 4819 since 22 Sep 2025, including printed boxes.
- [ ] Have ready: business name, phone, WhatsApp number, e-mail, address, GSTIN, and who handles customer complaints (grievance officer).

## Stage 1: website online (no database, no payments)

The price page shows "sample prices" in this stage and sends buyers to WhatsApp or the enquiry form.

1. [ ] **Domain.** Buy `honeypackers.in`, or confirm you own it (GoDaddy, Hostinger, BigRock, etc.).
2. [ ] **Netlify account.** netlify.com, sign up with GitHub.
3. [ ] **Import the site.** Add new site → Import from GitHub → `honeypackers-web`. The build settings come from the repo; don't change them.
4. [ ] **Environment variables** (Site configuration → Environment variables):
   - `PUBLIC_BUSINESS_NAME` = Honey Packers
   - `PUBLIC_BUSINESS_PHONE`, `PUBLIC_WHATSAPP_NUMBER` (e.g. `919876543210`, no + or spaces), `PUBLIC_BUSINESS_EMAIL`
   - `PUBLIC_BUSINESS_ADDRESS`, `PUBLIC_BUSINESS_CITY`, `PUBLIC_BUSINESS_GSTIN`, `PUBLIC_GRIEVANCE_OFFICER`
   - `PUBLIC_BRAND_COLOR` (optional): shop colour, a preset (`kraft`, `forest`, `ocean`, `charcoal`, `maroon`, `teal`) or a hex like `#2f6b45`. Empty = kraft brown.
   - `BOXBOOK_REF` only if Stage 0's merge is not done
   - `GITHUB_TOKEN` only if the BoxBook or rajesh-hub repo is private (a read-only fine-grained token)
5. [ ] **Deploy**, then open the `…netlify.app` address Netlify gives you.
6. [ ] **Enquiry e-mails.** Forms → enable form detection → Notifications → e-mail for form `enquiry` → your e-mail.
7. [ ] **Connect the domain.** Domain management → add `honeypackers.in` and `www.honeypackers.in`.
   Follow Netlify's DNS steps at your domain company. HTTPS switches on by itself (it can take up to a day).
8. [ ] **Read the privacy policy** at `/privacy/` and remove the "Draft" line once you're happy with it.
9. [ ] **Test on your phone:**
   - [ ] Home page shows your phone, WhatsApp and address
   - [ ] Shop: filter, search, open a product, Add to cart (the mini cart opens), Checkout offers "Send order on WhatsApp"
   - [ ] Price your box: change size and quantity, the 3D box turns, "Order on WhatsApp" opens WhatsApp with the details
   - [ ] Send an enquiry from Contact, and the e-mail arrives
   - [ ] Strength calculator works
10. [ ] **Be found:**
    - Google Search Console: add `honeypackers.in` and submit `https://honeypackers.in/sitemap-index.xml`.
    - Google Business Profile: add the website link.

## Stage 2: cloud database + SMS login

### 2a. Supabase (the online database)
1. [ ] supabase.com: create an **organisation** (one for all your apps), then a **new project** "boxbook", region **Mumbai**.
   Save the database password somewhere safe.
2. [ ] **SQL editor:** run the files in `BoxBook/supabase/migrations/` **in order** (01 → 07). Paste each one and press Run.
3. [ ] **Plan:** upgrade to **Pro** (about $25/month) before real customers use it. Free projects pause after a week without use.
4. [ ] Project settings → API: note the **Project URL**, the **anon key** (public) and the **service_role key** (secret, never put it in the app).

### 2b. MSG91 (SMS login codes)
1. [ ] msg91.com: create an account and complete **DLT registration**, which Indian law requires for business SMS:
   - your business (principal entity)
   - a sender ID (header), e.g. `HONEYP`
   - an SMS template, e.g. `##otp## is your Honey Packers login code. Do not share it.`

   MSG91 guides you through this; approval takes a few days.
2. [ ] In MSG91, note the **Auth key** and the approved **template ID**.
3. [ ] Supabase → Authentication → Sign In / Providers → **Phone**: turn it on.
4. [ ] Deploy the SMS function. Claude can run these, or you can (steps in `supabase/README.md`):
   ```
   npx supabase login
   npx supabase link --project-ref <your project ref>
   npx supabase functions deploy send-sms-msg91 --no-verify-jwt
   npx supabase secrets set MSG91_AUTH_KEY=… MSG91_TEMPLATE_ID=… MSG91_OTP_VAR=otp
   ```
5. [ ] Supabase → Authentication → **Hooks → Send SMS hook**:
   - type HTTPS
   - URL `https://<project-ref>.supabase.co/functions/v1/send-sms-msg91`
   - press "Generate secret", then run `npx supabase secrets set SEND_SMS_HOOK_SECRET='v1,whsec_…'`
6. [ ] E-mail fallback (optional): Authentication → Email Templates → Magic Link, and add `Your code: {{ .Token }}`.

### 2c. The app joins the cloud
1. [ ] In BoxBook, create `.env.local` with:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_SHOP_URL=https://honeypackers.in` (used in Stage 3)
2. [ ] Build the app again and install it on your phone.
3. [ ] **Take a backup first** (More → Backup → Back up now, and share it to Google Drive or WhatsApp).
4. [ ] More → Cloud sync:
   1. Mobile number → enter the SMS code.
   2. Tap **Create and move my data**.
   3. Check you see "Everything is synced".
5. [ ] Fill in for real:
   - **Company profile** (with your logo)
   - **Web price list**: paper rates, conversion cost, grades, margins, delivery zones, until the checklist at the top says "Ready"
   - **Products**: your standard sizes and pack prices
6. [ ] Find your **business ID**: Supabase → Table editor → `organizations` → copy the `id`.

### 2d. The website uses live data
1. [ ] In Netlify, add these environment variables:
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`
   - `PUBLIC_SHOP_ORG_ID` (the business ID)
   - `SUPABASE_SERVICE_ROLE_KEY` (secret)
2. [ ] Netlify → Deploys → **Trigger deploy**. Do this again whenever you add products, so search engines see them.
3. [ ] **Test:**
   - [ ] Price page: the "sample prices" note is gone and prices match the app's Web price list preview
   - [ ] Boxes in packs shows your products
   - [ ] Send an enquiry from Contact, and it appears in the app's **Inbox** within a few minutes
   - [ ] My orders: sign in with your own mobile number. The SMS arrives and you see your details.
4. [ ] **Staff:** More → Staff → invite each person by mobile number with their role. They install the app, sign in with that number and tap Join.

## Stage 3: online payment

1. [ ] razorpay.com: create an account and complete **KYC** (PAN, GSTIN, bank account, business address). Website activation also needs:
   - [ ] **Terms**, **Refund & cancellation**, **Shipping & delivery** and **Contact** pages on the website.
     **Not written yet:** ask Claude to draft them, then have them checked.
2. [ ] **Test mode first:**
   1. Razorpay → Settings → API keys → generate **test** keys.
   2. Netlify variables: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
   3. Razorpay → Webhooks → add `https://honeypackers.in/.netlify/functions/razorpay-webhook` with events **order.paid** and **payment_link.paid**, and a secret.
   4. Put that secret in Netlify as `RAZORPAY_WEBHOOK_SECRET`.
   5. Redeploy.
3. [ ] **Test with Razorpay's test cards / test UPI:**
   - [ ] Price your box → "Order & pay online" (use a pincode in your own delivery zone), pay, and you land in My orders
   - [ ] The order and payment appear in the app (Inbox → website orders), and the order shows "Confirmed"
   - [ ] Boxes in packs → cart → pay
   - [ ] In the app: an order with money due → **Send payment link**, then pay it from the link
   - [ ] Razorpay dashboard → Webhooks shows the deliveries as successful
4. [ ] Switch to **live** keys and a live webhook (same steps, live mode), then redeploy.
5. [ ] Make one small real payment yourself and refund it from Razorpay.

## Stage 4: app in the stores

1. [ ] Decide the final app ID (now `in.boxbook.app`). It can't change after publishing.
2. [ ] **Account deletion.** Google Play and Apple require it in apps with logins. **Not built yet:** ask Claude to add it.
3. [ ] **Android:**
   - Create a release keystore and **keep it safe forever** (losing it means you can't update the app).
   - Google Play Console ($25 once): app listing, privacy policy link (`https://honeypackers.in/privacy/`), the data safety form (it collects phone numbers and business data), then internal testing → production.
4. [ ] **iPhone** (optional): Apple Developer account ($99/year), then build and upload from Xcode on a Mac.
5. [ ] **Google Drive backup** (optional): follow "Google Drive backup → One-time setup" in `CLAUDE.md`.

## Still to build before or soon after launch
- Terms, refund, shipping pages (needed for Razorpay)
- Delete-account option in the app (needed for the stores)
- Stock going down automatically when packs are sold (you update stock in the app for now)
- Courier rates for pincodes outside your own delivery area (they send an enquiry for now)
- Product photos and the company logo on the website (the 3D box is shown for now)

## Monthly running costs (approximate)
| Item | Cost |
|---|---|
| Domain | about ₹800–1,000 a year |
| Netlify | free to start |
| Supabase Pro | about $25 a month |
| MSG91 SMS | a few paise per login code (check MSG91's current rate) |
| Razorpay | about 2% + GST per online payment |
| Google Play | $25 once |
| Apple | $99 a year (only if you publish on iPhone) |
