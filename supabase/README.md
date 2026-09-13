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
│   ├── 20260914120000_subscriptions_entitlements.sql   # 3) plans, feature matrix, entitlements, usage, storage areas, waste & price history
│   ├── 20260914130000_staff_and_bulk_inventory.sql     # 4) organizations, roles, bulk_* RPCs
│   ├── 20260914140000_org_member_directory.sql         # 5) resolved member profiles for the team list
│   └── 20260914150000_function_privilege_hardening.sql # 6) revokes default EXECUTE, re-grants per function
├── functions/
│   ├── _shared/             # cors + admin client used by all functions
│   ├── expiration-notifier/ # daily cron: finds items expiring within each user's window, logs nudge
│   ├── recipe-suggestions/  # real pantry-to-recipe matching (scores coverage, "can cook now?")
│   ├── barcode-lookup/      # scan auto-fill: proxies Barcode Lookup API (key stays server-side), meters one AI scan per answered lookup
│   ├── weekly-summary/      # 7-day stats: used / wasted / estimated savings / expiring soon
│   └── subscription-verify/ # the ONLY path that can activate a paid plan (Play / App Store receipts)
├── schedule.sql             # 7) optional: schedule expiration-notifier daily via pg_cron
└── config.toml              # JWT policy: scheduled fn = no JWT, app fns = require user token
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

The four dated files under `migrations/` add plans, entitlements, usage
metering, storage areas, waste/price history, staff roles and bulk operations.
Apply them **in filename order**, either by pasting each into the SQL Editor or
with the CLI:

```bash
supabase db push          # applies migrations/, in order, once each
```

- `20260914120000_subscriptions_entitlements.sql` — plan catalogue with the
  exact price list, the per-tier feature matrix, `user_subscriptions` +
  `subscription_usage`, storage areas, inventory alert timing and audit
  history, the `can_*` / `get_user_entitlements` / `consume_ai_scan` functions,
  the triggers that enforce every limit server-side, and the realtime
  publication.
- `20260914130000_staff_and_bulk_inventory.sql` — organisations, `org_members`
  with Owner/Manager/Staff roles and RLS, plus `bulk_add_inventory`,
  `bulk_update_inventory`, `bulk_adjust_quantity`, `bulk_delete_inventory`.
- `20260914140000_org_member_directory.sql` — the resolved member list the team
  screen reads.
- `20260914150000_function_privilege_hardening.sql` — revokes the default
  `EXECUTE` grant from `PUBLIC`/`anon` and re-grants each function explicitly.

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
supabase functions deploy expiration-notifier recipe-suggestions weekly-summary barcode-lookup subscription-verify
```

- `recipe-suggestions`, `weekly-summary`, `barcode-lookup` and
  `subscription-verify` require a signed-in user's access token (call them with
  the user's `Authorization` header).
- `expiration-notifier` needs no JWT so the scheduler can call it.

`barcode-lookup` proxies the Barcode Lookup API (api.barcodelookup.com) that
powers the Scan screen's auto-fill. Its key must be set as a **server-side
secret** — never prefix it with `EXPO_PUBLIC_` in `.env` (that would ship it in
the app bundle). Copy the value already in your `.env`
(`BARCODE_SCANNER_API_KEY`) into Supabase once:

```bash
supabase secrets set BARCODE_SCANNER_API_KEY="<value from .env>"
```

The same function meters **one AI scan** per answered lookup by calling
`consume_ai_scan` with the caller's own token, so the monthly allowance in the
plan (10 / 50 / 100 / 300) is enforced on the server and cannot be bypassed by
a modified client. It answers `429 { error: "ai_scan_limit_reached" }` when the
allowance is spent; the app turns that into the upgrade prompt. Upstream
outages are not charged.

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
