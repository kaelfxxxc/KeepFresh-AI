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
│   └── seed.sql             # 2) real data: 14 recipes + demo household w/ live-looking inventory
├── functions/
│   ├── _shared/             # cors + admin client used by all functions
│   ├── expiration-notifier/ # daily cron: finds items expiring within each user's window, logs nudge
│   ├── recipe-suggestions/  # real pantry-to-recipe matching (scores coverage, "can cook now?")
│   ├── barcode-lookup/      # scan auto-fill: proxies Barcode Lookup API (key stays server-side)
│   └── weekly-summary/      # 7-day stats: used / wasted / estimated savings / expiring soon
├── schedule.sql             # 3) optional: schedule expiration-notifier daily via pg_cron
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

## Step 3 — Deploy the serverless functions

```bash
npm install -g supabase        # the Supabase CLI
supabase login
supabase link --project-ref <your-project-ref>   # the subdomain of your project
supabase functions deploy expiration-notifier recipe-suggestions weekly-summary barcode-lookup
```

- `recipe-suggestions`, `weekly-summary` and `barcode-lookup` require a signed-in
  user's access token (call them with the user's `Authorization` header).
- `expiration-notifier` needs no JWT so the scheduler can call it.

`barcode-lookup` proxies the Barcode Lookup API (api.barcodelookup.com) that
powers the Scan screen's auto-fill. Its key must be set as a **server-side
secret** — never prefix it with `EXPO_PUBLIC_` in `.env` (that would ship it in
the app bundle). Copy the value already in your `.env`
(`BARCODE_SCANNER_API_KEY`) into Supabase once:

```bash
supabase secrets set BARCODE_SCANNER_API_KEY="<value from .env>"
```

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
