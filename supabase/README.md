# KeepFresh AI — Supabase setup

Everything you need to get the hosted database and serverless backend running.
The old `keepfreshdb.sql` seeded **nothing** because its recipe rows used UUID
literals like `'1'`…`'20'` and some `instructions` JSON arrays were missing
their opening quote — the whole insert failed silently. It has been rewritten.

## What's in here

```
supabase/
├── migrations/
│   ├── keepfreshdb.sql      # 1) full schema: 12 tables + 5 RPCs + trigger + storage (paste first)
│   ├── seed.sql             # 2) real data: 14 recipes + demo household w/ live-looking inventory
│   ├── subscriptions_entitlements.sql    # 3) plans, feature matrix, entitlements, usage, storage areas, waste & price history
│   ├── staff_and_bulk_inventory.sql      # 4) organizations, roles, bulk_* RPCs
│   ├── org_member_directory.sql          # 5) resolved member profiles for the team list
│   ├── function_privilege_hardening.sql  # 6) revokes default EXECUTE, re-grants per function
│   ├── trial_expiration.sql              # 7) free floor vs free trial, expiry + sync RPCs
│   ├── paymongo_payments.sql             # 8) PayMongo checkout: provider + checkout session ledger
│   └── fix_entitlements_unassigned_plan.sql  # fix: get_user_entitlements() on an account with no live plan
├── functions/
│   ├── _shared/             # cors + admin client + PayMongo helpers used by all functions
│   ├── expiration-notifier/ # daily cron: finds items expiring within each user's window, logs nudge
│   ├── recipe-suggestions/  # real pantry-to-recipe matching (scores coverage, "can cook now?")
│   ├── barcode-lookup/      # scan auto-fill: proxies Open Food Facts (no key), meters one AI scan per answered lookup
│   ├── weekly-summary/      # 7-day stats: used / wasted / estimated savings / expiring soon
│   ├── subscription-verify/ # activates a paid plan from a Play / App Store receipt
│   ├── paymongo-checkout/   # opens a PayMongo hosted checkout page for a plan
│   ├── paymongo-verify/     # "has my checkout been paid?" — asks PayMongo, then activates
│   └── paymongo-webhook/    # PayMongo's payment notification (public; HMAC-verified, no JWT)
├── schedule.sql             # 9) optional: schedule expiration-notifier daily via pg_cron
└── config.toml              # JWT policy: scheduled fn = no JWT, app fns = require user token,
                             #            paymongo-webhook = no JWT (signature-verified instead)
```

## Step 1 — Create the schema (paste, don't create by hand)

1. [Supabase Dashboard](https://supabase.com/dashboard) → create a project.
2. Open **SQL Editor → New query**.
3. Paste the whole of `supabase/migrations/keepfreshdb.sql` → **Run**.
   - Creates all tables, Row Level Security + policies, the `handle_new_user`
     trigger, `get_expiring_items`, `calculate_*`, `get_recipe_matches`, and
     **`consume_inventory_item`** (what the app calls when you mark an item
     consumed — it was missing before).
   - Also creates the three storage buckets, so the old manual "create buckets"
     step is no longer needed.
   - Safe to run again (idempotent).

## Step 2 — Load real seed data

4. Paste the whole of `supabase/migrations/seed.sql` → **Run** (run once).
   - 14 real recipes across **meals / desserts / snacks / beverages** with
     step-by-step instructions and full ingredient lists.
   - A demo household whose inventory is date-relative: a few items expire
     within the next days (Alerts screen), long-life pantry staples, three
     consumed items, two wasted items, one expired loaf — so every screen and
     chart has live data the day you log in.
   - Grocery list, favorites, notification history and preferences are linked.
   - Re-runnable: running it again resets only the demo user + seed recipes.

**Log in with:** `demo@keepfresh.app` / `KeepFresh123!`

> Currency is seeded as **PHP** and the data uses Philippine-market items
> (bangus, kangkong, lakatan…) to match the app's `Asia/Manila` defaults. If
> your market is different, edit `user_preferences.currency` and the seed rows
> to taste — no schema change needed.

## Step 2b — Apply the subscription migrations

The files under `migrations/` add plans, entitlements, usage metering, storage
areas, waste/price history, staff roles, bulk operations and the PayMongo
checkout ledger. Apply them **in order**, either by pasting each into the SQL
Editor or with the CLI:

```bash
supabase db push          # applies migrations/, in order, once each
```

The ones that carry subscription state, in the order they must run:

- `subscriptions_entitlements.sql` — plan catalogue with the exact price list,
  the per-tier feature matrix, `user_subscriptions` + `subscription_usage`,
  storage areas, inventory alert timing and audit history, the `can_*` /
  `get_user_entitlements` / `consume_ai_scan` functions, the triggers that
  enforce every limit server-side, and the realtime publication.
- `staff_and_bulk_inventory.sql` — organisations, `org_members` with
  Owner/Manager/Staff roles and RLS, plus `bulk_add_inventory`,
  `bulk_update_inventory`, `bulk_adjust_quantity`, `bulk_delete_inventory`.
- `org_member_directory.sql` — the resolved member list the team screen reads.
- `function_privilege_hardening.sql` — revokes the default `EXECUTE` grant from
  `PUBLIC`/`anon` and re-grants each function explicitly.
- `trial_expiration.sql` — splits the permanent free floor (`*_free`) from the
  time-limited free trial (`*_trial`), and adds `sync_my_subscription()` and the
  `expire_stale_subscriptions()` cron.
- `paymongo_payments.sql` — adds `'paymongo'` to the `provider` allowlist and
  creates `paymongo_checkout_sessions`, the ledger the GCash / Maya / QR Ph flow
  is keyed on. Pasting it by hand works fine; the file is idempotent, and
  re-pasting it is how the `payment_method_used` constraint gets widened when a
  method is added.
- `fix_entitlements_unassigned_plan.sql` — **paste this if adding an inventory
  item ever fails with `record "v_plan" is not assigned yet`.** It re-defines
  `get_user_entitlements()` (the body from `trial_expiration.sql`, so it must be
  pasted after it), which tested a `RECORD` before assigning it. Reading a field
  of a never-assigned `RECORD` raises rather than returning NULL, so the check
  that guards the free-plan fallback crashed on exactly the accounts the fallback
  exists for — anyone without a running plan. The insert trigger
  `trg_enforce_inventory_entitlements` reaches that function through
  `can_add_product()`, which is why it surfaced as an inventory error. The same
  fix is applied at source in `trial_expiration.sql` and
  `subscriptions_entitlements.sql`, so re-pasting those also resolves it.

Every migration is idempotent and finishes with a status `SELECT`, so a failed
paste is obvious rather than silent.

**Existing accounts are not left behind:** the backfill at the end of the first
migration gives every pre-existing profile a 7-day trial of the plan matching
its `account_type`, a usage period, and the three default storage areas. No
inventory row is deleted or rewritten — an account already over its trial
capacity simply cannot add more until it upgrades.

To try the paid features on the demo user, activate a plan for it directly.
`provider = 'manual'` marks this as an operator override rather than a store
purchase, so it is distinguishable from a verified receipt later:

```sql
UPDATE public.user_subscriptions
   SET plan_id = 'household_pro_monthly', status = 'active', provider = 'manual',
       current_period_start = NOW(), current_period_end = NOW() + INTERVAL '30 days'
 WHERE user_id = (SELECT id FROM public.profiles WHERE email = 'demo@keepfresh.app');
```

Use `establishment_pro_monthly` instead to exercise staff roles and bulk
inventory — those two features exist only on Food Establishment plans.

## Step 3 — Deploy the serverless functions

```bash
npm install -g supabase        # the Supabase CLI
supabase login
supabase link --project-ref <your-project-ref>   # the subdomain of your project
supabase functions deploy expiration-notifier recipe-suggestions weekly-summary barcode-lookup subscription-verify paymongo-checkout paymongo-verify paymongo-webhook
```

- `recipe-suggestions`, `weekly-summary`, `barcode-lookup`, `subscription-verify`,
  `paymongo-checkout` and `paymongo-verify` require a signed-in user's access
  token (call them with the user's `Authorization` header).
- `expiration-notifier` needs no JWT so the scheduler can call it.
- `paymongo-webhook` needs no JWT either, and for a different reason — see below.

`barcode-lookup` proxies Open Food Facts (world.openfoodfacts.org), the open
database behind the Scan screen's auto-fill. It needs **no secret and no key**:
the API answers unauthenticated HTTPS GETs, so there is nothing to set and the
app calls it straight from the device. It stays deployed on two accounts —
builds in the field still call it, and it is the only path that meters.

The function meters **one AI scan** per answered lookup by calling
`consume_ai_scan` with the caller's own token, so the monthly allowance in the
plan (10 / 50 / 100 / 300) is enforced on the server and cannot be bypassed by
a modified client. It answers `429 { error: "ai_scan_limit_reached" }` when the
allowance is spent; the app turns that into the upgrade prompt. Upstream
outages are not charged.

> It previously proxied Barcode Lookup (api.barcodelookup.com), whose key lived
> here as the `BARCODE_SCANNER_API_KEY` secret. That plan has lapsed. If the
> secret is still set in the project, delete it — nothing reads it:
>
> ```bash
> supabase secrets unset BARCODE_SCANNER_API_KEY
> ```

**Metering gap to be aware of.** The app's own barcode lookup (`lookupBarcode`
in `src/services/barcodeService.ts`) fetches Open Food Facts directly, because
there is no longer a key to hide and no reason to add a round trip. That call is
**not** metered: the Scan screen still *gates* on the allowance — a plan with no
scans left cannot open the camera — but a barcode lookup no longer *spends* one.
The two only agree for clients that go through this function. Decide which
behaviour is wanted and make both paths match: either point `lookupBarcode` back
at this function, or drop the gate from the scan screen.

### Payment verification (`subscription-verify`)

This function is the only thing that can mark a subscription paid — the app
never activates a plan by itself. It verifies a store receipt with Google Play
or the App Store and then activates the matching plan, so it needs the store
credentials as secrets. Set only the platform(s) you ship on; the function
reports which ones are configured and refuses the rest rather than failing
open:

```bash
# Google Play (service account with the "View financial data" permission)
supabase secrets set GOOGLE_PLAY_PACKAGE_NAME="com.yourorg.keepfreshai"
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat service-account.json)"

# App Store (In-App Purchase key from App Store Connect → Users and Access → Keys)
supabase secrets set APPLE_BUNDLE_ID="com.yourorg.keepfreshai"
supabase secrets set APPLE_ISSUER_ID="<issuer id>"
supabase secrets set APPLE_KEY_ID="<key id>"
supabase secrets set APPLE_PRIVATE_KEY="$(cat SubscriptionKey_XXXX.p8)"
```

Until a platform's credentials are set, purchases on it come back as
`unavailable` and the app tells the user payments are not open yet — no plan is
activated and no error is faked.

### PayMongo (`paymongo-checkout`, `paymongo-verify`, `paymongo-webhook`)

GCash, Maya and QR Ph, for the Philippine market the price list is built for. App
Store and Play Billing do not cover any of them, and a hosted page needs no native
module — so this works on the current Expo build.

**A method must be activated on the PayMongo account or the page renders nothing.**
This is the one failure that looks like a bug in this code and is not. PayMongo
accepts a `payment_method_types` value it recognises but has not activated, then
renders a checkout page with no way to pay — no error, no session failure, nothing
in the logs. Methods are switched on per account under **Settings → Payment
Methods** in the dashboard, in live mode, and e-wallets go to an onboarding review
that takes days; note also that an Individual account may request Maya but not
GCash. QR Ph is the exception: it is enabled by account activation itself, needs no
request, and is payable by scanning with the GCash or Maya app — which is why it is
in `PAYMONGO_METHODS` beside the two wallets rather than instead of them. See
[docs.paymongo.com/docs/account-settings-account-capabilities](https://docs.paymongo.com/docs/account-settings-account-capabilities).

`payment_method_types` is sent from the `PAYMONGO_METHODS` constant in
`_shared/paymongo.ts`, and `payment_method_used` on the ledger has a matching
`CHECK` — adding a method means changing both, in that order.

**How a purchase flows.** The app asks `paymongo-checkout` for a plan; the server
re-reads the plan and its price from the database (the client never sends a
price), records an attempt in `paymongo_checkout_sessions`, and returns a hosted
page URL. The app opens it in a WebView. PayMongo then tells us the outcome twice
over — once by redirecting the browser, once by calling the webhook — and both
funnel into the same writer, which claims the attempt with a conditional `UPDATE`
so a replayed delivery can never buy two periods.

**Secrets.** Two, and neither may ever be prefixed with `EXPO_PUBLIC_` or placed
in `.env`:

```bash
supabase secrets set PAYMONGO_SECRET_KEY="sk_live_..."        # sk_test_... while testing
supabase secrets set PAYMONGO_WEBHOOK_SECRET="whsk_..."       # shown when you add the endpoint
```

The **public** key is not needed: the checkout page is created server-side, so
nothing on the device talks to PayMongo directly. `PAYMONGO_PUBLIC_KEY` in `.env`
is a reference value only.

**Webhook.** Dashboard → **Developers → Webhooks → Add endpoint**, pointing at

```
https://<ref>.supabase.co/functions/v1/paymongo-webhook
```

and subscribe to `checkout_session.payment.paid`. Copy the endpoint secret it
shows into `PAYMONGO_WEBHOOK_SECRET` — the endpoint is public and the
`Paymongo-Signature` HMAC is the *only* thing that makes a request genuine, so
the function refuses to process anything at all when that secret is unset (503,
so PayMongo retries once you have set it). Verification runs before the body is
parsed: the header is a hex HMAC-SHA256 of the raw bytes, compared in constant
time. To register the endpoint by API instead:

```bash
curl -X POST https://api.paymongo.com/v1/webhooks \
  -u "$PAYMONGO_SECRET_KEY:" \
  -H "Content-Type: application/json" \
  -d '{"data":{"attributes":{"url":"https://<ref>.supabase.co/functions/v1/paymongo-webhook",
        "events":["checkout_session.payment.paid"]}}}'
```

**The client flag.** `EXPO_PUBLIC_PAYMONGO_ENABLED=true` in `.env` switches the
plan buttons on. It is a build flag, not a security control — the server checks
its own secrets before it will create a session and answers
`verification_not_configured` if they are missing, so a build with the flag set
against an unconfigured server shows an honest error rather than failing
silently. Set it to `false` to ship a build with no purchasing at all.

**No auto-renew, by design.** Each payment buys one period. When it ends, the
existing `expire_stale_subscriptions()` cron lapses the account to the free
floor, exactly as it already does for a store subscription that stops renewing.
Renewing is paying again.

**GCash needs the WebView to forward its deep link.** GCash completes the payment
inside its own app, and a WebView does not follow `gcash://` on its own — the
"Open in GCash" button appears and does nothing, and the customer cannot pay.
`app/checkout.tsx` intercepts it and hands it to the OS (`intent://` too, for
Android). Maya redirects through the web and QR Ph is drawn by the page itself as
a code to scan, so neither needs any of this. If GCash ever stops working, check
that interception first.

**Nothing here activates a plan on the client's say-so**, the same rule
`subscription-verify` follows. `paymongo-verify` confirms the session belongs to
the caller before it asks PayMongo anything, and the `guard_subscription_update()`
trigger still rejects any client-side write to a plan.

Test locally first (needs `supabase start` running) or straight against hosted:

```bash
# pantry-aware recipe ranking for the signed-in user
curl -X POST https://<ref>.supabase.co/functions/v1/recipe-suggestions \
  -H "Authorization: Bearer <user-access-token>"

# 7-day analytics summary for the signed-in user
curl -X POST https://<ref>.supabase.co/functions/v1/weekly-summary \
  -H "Authorization: Bearer <user-access-token>"

# barcode product lookup (real UPC — expect ok:true, found:true)
curl -X POST https://<ref>.supabase.co/functions/v1/barcode-lookup \
  -H "Authorization: Bearer <user-access-token>" \
  -H "Content-Type: application/json" \
  -d '{"barcode":"049000042566"}'
```

## Step 4 — Schedule the expiration scan

Paste `schedule.sql` (fill in `<YOUR-PROJECT-REF>` and your **anon** key), or
use **Dashboard → Edge Functions → expiration-notifier → Cron → Daily**.

## Step 5 — Auth

**Authentication → Sign In / Up → Email** is already enabled. The demo user's
password is set directly in the DB (confirmed), so it signs in immediately.
Enable **Google / Facebook** and add the OAuth redirect URLs exactly as the
project README describes if you want social login.

## Security notes

- RLS is on for every user table; policies restrict reads/writes to `auth.uid()`.
- `recipe_ingredients` / `recipes` are world-readable **on purpose** so the
  recipe catalog is public and images can load without auth.
- Edge Functions use the **service role key server-side**; never ship it in the
  app — the app talks to `recipe-suggestions`/`weekly-summary` with the user's
  own access token, and the server resolves the identity from it.
- **Plan limits are enforced in the database, not in the screens.** Product
  caps, AI scans, storage-area counts and the establishment-only features are
  checked by triggers and inside the `bulk_*` / `can_*` functions. The app
  checks first only so the user sees an upgrade card instead of a raw error.
- **A plan is activated by a server function, never by the app.** Two functions
  can do it — `subscription-verify` (store receipts) and the PayMongo flow — and
  `guard_subscription_update()` rejects any client-side change to `plan_id`,
  `status`, `provider` or the period columns regardless of what either says.
- `paymongo-webhook` is the one **public** endpoint. Its only gate is the
  `Paymongo-Signature` HMAC, checked against the raw body before anything is
  parsed, and it refuses to process at all when its secret is unset.
- The service-role key never reaches the Expo bundle; the app holds only the
  anon key plus the signed-in user's token.

## What the app shows

| Screen | Route | Gated by |
| --- | --- | --- |
| Subscription | `/subscription` | — (price list is public) |
| Waste & savings report | `/analytics` | `waste_report`, plus `advanced_waste_report` for the Pro block |
| Price tracking | `/price-tracking` | `price_tracking` |
| Storage areas | `/storage-areas` | `multiple_storage` (+ its `limit_value`) |
| Staff & roles | `/staff` | `staff_management` (Establishment Pro only) |
| Bulk inventory | `/bulk-inventory` | `bulk_inventory` (Establishment Pro only) |
| Grocery list scanner | `/grocery/scan` | one AI scan per answered lookup |

`/subscription` lists the plans for the **signed-in account's own type** — a
household account sees the household price list, a food establishment sees the
establishment one. Entitlements are still read from whatever plan is active, so
an account that already holds a plan of the other type keeps every feature it
paid for even though that plan is no longer offered to it.

**A locked page states the requirement, and never guesses when the plan is
unknown.** Four screens — Reports, Price Tracking, Staff & roles and Bulk
inventory — stand in a `FeatureLock` for a feature the active plan does not
include, and each says plainly that a subscription is required to keep using the
page rather than only describing the feature. Two of them differ on purpose:
Staff & roles and Bulk inventory exist on Food Establishment plans only, so a
household account is told to switch account type instead of being invited to buy
a plan that cannot sell it the page. All four also refuse to render on a plan they
could not read: the gate helpers answer *allowed* for every feature while
`entitlements` is null (a deliberate fail-open for the counting caps, which the
database re-checks on write), so the screens gate on the snapshot existing and
show a "couldn't check your plan" state with a **Try again** while it is loading
or after the read failed. See `FeatureLock` / `PlanCheckLock` in
`src/components/ui.tsx`.
