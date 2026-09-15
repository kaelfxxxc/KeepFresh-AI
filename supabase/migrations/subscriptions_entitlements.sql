CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. SUBSCRIPTION CATALOGUE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id              TEXT PRIMARY KEY,
  audience        TEXT NOT NULL CHECK (audience IN ('household', 'establishment')),
  tier            TEXT NOT NULL CHECK (tier IN ('free_trial', 'premium', 'pro')),
  billing_period  TEXT NOT NULL CHECK (billing_period IN ('trial', 'monthly', 'yearly')),
  name            TEXT NOT NULL,
  description     TEXT,
  price_php       NUMERIC(10, 2) NOT NULL DEFAULT 0,
  duration_days   INTEGER NOT NULL DEFAULT 30,
  max_products    INTEGER NOT NULL,
  max_ai_scans    INTEGER NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.subscription_plans IS
  'Purchasable plans. Price is informational only — the store is the source of truth.';
COMMENT ON COLUMN public.subscription_plans.max_products IS
  'Capacity of LIVE products (status not consumed/wasted), not a row count.';

-- Prices come from the project spec. The app store / Play Console remains the
-- source of truth for what a user is actually charged; these values drive the
-- in-app price list and the savings comparisons on the subscription screen.
INSERT INTO public.subscription_plans
  (id, audience, tier, billing_period, name, description, price_php, duration_days, max_products, max_ai_scans, sort_order)
VALUES
  ('household_trial',              'household',     'free_trial', 'trial',   'Household Free Trial',      'Try every core feature for 7 days.',            0,     7,   30,  10, 10),
  ('household_premium_monthly',    'household',     'premium',    'monthly', 'Household Premium',         'Billed monthly. Cancel any time.',             99,   30,  100,  50, 20),
  ('household_premium_yearly',     'household',     'premium',    'yearly',  'Household Premium (Yearly)','Two months free versus monthly.',              999,  365, 100,  50, 21),
  ('household_pro_monthly',        'household',     'pro',        'monthly', 'Household Pro',             'Billed monthly. Cancel any time.',             199,  30,  300, 100, 30),
  ('household_pro_yearly',         'household',     'pro',        'yearly',  'Household Pro (Yearly)',    'Two months free versus monthly.',              1999, 365, 300, 100, 31),
  ('establishment_trial',          'establishment', 'free_trial', 'trial',   'Establishment Free Trial',  'Try the inventory basics for 7 days.',         0,     7,   50,  10, 40),
  ('establishment_premium_monthly','establishment', 'premium',    'monthly', 'Establishment Premium',     'Billed monthly. Cancel any time.',             499,  30,  500, 100, 50),
  ('establishment_premium_yearly', 'establishment', 'premium',    'yearly',  'Establishment Premium (Yearly)','Two months free versus monthly.',           4999, 365, 500, 100, 51),
  ('establishment_pro_monthly',    'establishment', 'pro',        'monthly', 'Establishment Pro',         'Billed monthly. Cancel any time.',             999,  30,  1500, 300, 60),
  ('establishment_pro_yearly',     'establishment', 'pro',        'yearly',  'Establishment Pro (Yearly)','Two months free versus monthly.',              9999, 365, 1500, 300, 61)
ON CONFLICT (id) DO UPDATE SET
  audience       = EXCLUDED.audience,
  tier           = EXCLUDED.tier,
  billing_period = EXCLUDED.billing_period,
  name           = EXCLUDED.name,
  description    = EXCLUDED.description,
  price_php      = EXCLUDED.price_php,
  duration_days  = EXCLUDED.duration_days,
  max_products   = EXCLUDED.max_products,
  max_ai_scans   = EXCLUDED.max_ai_scans,
  sort_order     = EXCLUDED.sort_order,
  updated_at     = NOW();

-- ---------------------------------------------------------------------------
-- Feature matrix. Keyed on (audience, tier) so the two free trials can differ.
-- `limit_value` is NULL for "unlimited" and non-NULL for a countable cap
-- (e.g. multiple_storage limit 3 = at most 3 storage areas).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_entitlements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     TEXT NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  limit_value INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, feature_key)
);

WITH feature_matrix (audience, tier, feature_key, enabled, limit_value) AS (
  VALUES
    -- Household — Free Trial: 30 products, 10 scans, manual entry, basic
    -- alerts, basic AI recipes, smart grocery list.
    ('household', 'free_trial', 'manual_entry',          TRUE,  NULL::INTEGER),
    ('household', 'free_trial', 'expiration_alerts',     TRUE,  NULL),
    ('household', 'free_trial', 'ai_recipes',            TRUE,  5),
    ('household', 'free_trial', 'smart_grocery_list',    TRUE,  NULL),
    ('household', 'free_trial', 'waste_report',          FALSE, NULL),
    ('household', 'free_trial', 'advanced_waste_report', FALSE, NULL),
    ('household', 'free_trial', 'price_tracking',        FALSE, NULL),
    ('household', 'free_trial', 'multiple_storage',      TRUE,  1),
    ('household', 'free_trial', 'advanced_inventory',    FALSE, NULL),
    ('household', 'free_trial', 'staff_management',      FALSE, NULL),
    ('household', 'free_trial', 'bulk_inventory',        FALSE, NULL),

    -- Household — Premium: 100 products, 50 scans, waste/savings report,
    -- price tracking.
    ('household', 'premium', 'manual_entry',             TRUE,  NULL),
    ('household', 'premium', 'expiration_alerts',        TRUE,  NULL),
    ('household', 'premium', 'ai_recipes',               TRUE,  NULL),
    ('household', 'premium', 'smart_grocery_list',       TRUE,  NULL),
    ('household', 'premium', 'waste_report',             TRUE,  NULL),
    ('household', 'premium', 'advanced_waste_report',    FALSE, NULL),
    ('household', 'premium', 'price_tracking',           TRUE,  NULL),
    ('household', 'premium', 'multiple_storage',         TRUE,  5),
    ('household', 'premium', 'advanced_inventory',       FALSE, NULL),
    ('household', 'premium', 'staff_management',         FALSE, NULL),
    ('household', 'premium', 'bulk_inventory',           FALSE, NULL),

    -- Household — Pro: 300 products, 100 scans, advanced waste/savings
    -- reports, unlimited storage areas, full household features.
    ('household', 'pro', 'manual_entry',                 TRUE,  NULL),
    ('household', 'pro', 'expiration_alerts',            TRUE,  NULL),
    ('household', 'pro', 'ai_recipes',                   TRUE,  NULL),
    ('household', 'pro', 'smart_grocery_list',           TRUE,  NULL),
    ('household', 'pro', 'waste_report',                 TRUE,  NULL),
    ('household', 'pro', 'advanced_waste_report',        TRUE,  NULL),
    ('household', 'pro', 'price_tracking',               TRUE,  NULL),
    ('household', 'pro', 'multiple_storage',             TRUE,  NULL),
    ('household', 'pro', 'advanced_inventory',           TRUE,  NULL),
    ('household', 'pro', 'staff_management',             FALSE, NULL),
    ('household', 'pro', 'bulk_inventory',               FALSE, NULL),

    -- Establishment — Free Trial: 50 products, 10 scans, manual entry, basic
    -- inventory, basic expiration alerts.
    ('establishment', 'free_trial', 'manual_entry',          TRUE,  NULL),
    ('establishment', 'free_trial', 'expiration_alerts',     TRUE,  NULL),
    ('establishment', 'free_trial', 'ai_recipes',            FALSE, NULL),
    ('establishment', 'free_trial', 'smart_grocery_list',    FALSE, NULL),
    ('establishment', 'free_trial', 'waste_report',          FALSE, NULL),
    ('establishment', 'free_trial', 'advanced_waste_report', FALSE, NULL),
    ('establishment', 'free_trial', 'price_tracking',        FALSE, NULL),
    ('establishment', 'free_trial', 'multiple_storage',      TRUE,  1),
    ('establishment', 'free_trial', 'advanced_inventory',    FALSE, NULL),
    ('establishment', 'free_trial', 'staff_management',      FALSE, NULL),
    ('establishment', 'free_trial', 'bulk_inventory',        FALSE, NULL),

    -- Establishment — Premium: 500 products, 100 scans, price tracking,
    -- waste/savings reports, multiple storage areas, advanced inventory.
    ('establishment', 'premium', 'manual_entry',             TRUE,  NULL),
    ('establishment', 'premium', 'expiration_alerts',        TRUE,  NULL),
    ('establishment', 'premium', 'ai_recipes',               TRUE,  NULL),
    ('establishment', 'premium', 'smart_grocery_list',       TRUE,  NULL),
    ('establishment', 'premium', 'waste_report',             TRUE,  NULL),
    ('establishment', 'premium', 'advanced_waste_report',    FALSE, NULL),
    ('establishment', 'premium', 'price_tracking',           TRUE,  NULL),
    ('establishment', 'premium', 'multiple_storage',         TRUE,  5),
    ('establishment', 'premium', 'advanced_inventory',       TRUE,  NULL),
    ('establishment', 'premium', 'staff_management',         FALSE, NULL),
    ('establishment', 'premium', 'bulk_inventory',           FALSE, NULL),

    -- Establishment — Pro: 1,500 products, 300 scans, staff, bulk inventory,
    -- unlimited storage areas, advanced reports.
    ('establishment', 'pro', 'manual_entry',                 TRUE,  NULL),
    ('establishment', 'pro', 'expiration_alerts',            TRUE,  NULL),
    ('establishment', 'pro', 'ai_recipes',                   TRUE,  NULL),
    ('establishment', 'pro', 'smart_grocery_list',           TRUE,  NULL),
    ('establishment', 'pro', 'waste_report',                 TRUE,  NULL),
    ('establishment', 'pro', 'advanced_waste_report',        TRUE,  NULL),
    ('establishment', 'pro', 'price_tracking',               TRUE,  NULL),
    ('establishment', 'pro', 'multiple_storage',             TRUE,  NULL),
    ('establishment', 'pro', 'advanced_inventory',           TRUE,  NULL),
    ('establishment', 'pro', 'staff_management',             TRUE,  NULL),
    ('establishment', 'pro', 'bulk_inventory',               TRUE,  NULL)
)
INSERT INTO public.feature_entitlements (plan_id, feature_key, enabled, limit_value)
SELECT p.id, m.feature_key, m.enabled, m.limit_value
FROM feature_matrix m
JOIN public.subscription_plans p ON p.audience = m.audience AND p.tier = m.tier
ON CONFLICT (plan_id, feature_key) DO UPDATE SET
  enabled     = EXCLUDED.enabled,
  limit_value = EXCLUDED.limit_value;

-- ============================================================================
-- 2. ORGANISATIONS & STAFF  (Food Establishment Pro)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organizations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  owner_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_type TEXT NOT NULL DEFAULT 'establishment',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'manager', 'staff')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'removed')),
  invited_email   TEXT,
  invited_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON public.organization_members(organization_id);

-- These two run SECURITY DEFINER so the RLS policies that call them do not
-- recurse into organization_members' own policies.
CREATE OR REPLACE FUNCTION public.is_org_member(p_org UUID, p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.organization_id = p_org
      AND m.user_id = p_user
      AND m.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.org_role(p_org UUID, p_user UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.role FROM public.organization_members m
  WHERE m.organization_id = p_org
    AND m.user_id = p_user
    AND m.status = 'active'
  LIMIT 1;
$$;

-- Owner or manager may administer the organisation. Staff may not.
CREATE OR REPLACE FUNCTION public.can_manage_org(p_org UUID, p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.org_role(p_org, p_user) IN ('owner', 'manager'), FALSE);
$$;

-- ============================================================================
-- 3. STORAGE AREAS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.storage_areas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL DEFAULT 'custom'
                    CHECK (kind IN ('refrigerator', 'freezer', 'pantry', 'cabinet', 'custom')),
  icon            TEXT,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_storage_areas_user ON public.storage_areas(user_id);

-- ============================================================================
-- 4. SUBSCRIPTIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id                 TEXT NOT NULL REFERENCES public.subscription_plans(id),
  status                  TEXT NOT NULL DEFAULT 'trialing'
                            CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_period_end      TIMESTAMPTZ NOT NULL,
  cancel_at_period_end    BOOLEAN NOT NULL DEFAULT FALSE,
  auto_renew              BOOLEAN NOT NULL DEFAULT TRUE,
  canceled_at             TIMESTAMPTZ,
  -- Populated ONLY by the server-side payment verifier. A non-'none' provider
  -- with a verified_at timestamp is what makes a paid plan trustworthy.
  provider                TEXT NOT NULL DEFAULT 'none'
                            CHECK (provider IN ('none', 'google_play', 'app_store', 'stripe', 'manual')),
  provider_subscription_id TEXT,
  provider_verified_at    TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON public.user_subscriptions(user_id);

-- At most one non-terminal subscription per user, so entitlement resolution is
-- never ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_live_subscription_per_user
  ON public.user_subscriptions (user_id)
  WHERE status IN ('trialing', 'active', 'past_due');

CREATE TABLE IF NOT EXISTS public.subscription_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.user_subscriptions(id) ON DELETE SET NULL,
  -- Usage resets on the 1st of each calendar month; "per month" in the spec
  -- means the same thing for monthly and yearly plans.
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  ai_scans_used   INTEGER NOT NULL DEFAULT 0 CHECK (ai_scans_used >= 0),
  products_added  INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_subscription_usage_user ON public.subscription_usage(user_id, period_start);

-- Receipts / purchase tokens. RLS on, NO policies: the anon and authenticated
-- roles cannot read this table at all. Service role only.
CREATE TABLE IF NOT EXISTS public.subscription_provider_receipts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id          UUID REFERENCES public.user_subscriptions(id) ON DELETE CASCADE,
  user_id                  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL,
  provider_subscription_id TEXT,
  purchase_token           TEXT,
  receipt                  JSONB,
  verification_status      TEXT NOT NULL DEFAULT 'pending'
                             CHECK (verification_status IN ('pending', 'verified', 'invalid')),
  verified_at              TIMESTAMPTZ,
  raw_response             JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.subscription_provider_receipts ENABLE ROW LEVEL SECURITY;

-- Reject client-side tampering with the terms of a subscription. A signed-in
-- user may only flip cancel_at_period_end / auto_renew; everything that
-- actually grants entitlement requires a server-side (auth.uid() IS NULL) path.
CREATE OR REPLACE FUNCTION public.guard_subscription_update()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id                IS DISTINCT FROM OLD.user_id
     OR NEW.plan_id             IS DISTINCT FROM OLD.plan_id
     OR NEW.status              IS DISTINCT FROM OLD.status
     OR NEW.started_at          IS DISTINCT FROM OLD.started_at
     OR NEW.current_period_start IS DISTINCT FROM OLD.current_period_start
     OR NEW.current_period_end  IS DISTINCT FROM OLD.current_period_end
     OR NEW.provider            IS DISTINCT FROM OLD.provider
     OR NEW.provider_subscription_id IS DISTINCT FROM OLD.provider_subscription_id
     OR NEW.provider_verified_at IS DISTINCT FROM OLD.provider_verified_at THEN
    RAISE EXCEPTION
      'subscription_plan_change_requires_server_verification'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_subscription_update ON public.user_subscriptions;
CREATE TRIGGER trg_guard_subscription_update
  BEFORE UPDATE ON public.user_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.guard_subscription_update();

-- ============================================================================
-- 5. INVENTORY: storage area link, alert timing, audit trail
-- ============================================================================

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS storage_area_id      UUID REFERENCES public.storage_areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS organization_id      UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS added_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expiration_alert_days INTEGER NOT NULL DEFAULT 3;

-- Alert timing is a fixed menu: on the day, or 1/3/5/7 days before.
ALTER TABLE public.inventory_items DROP CONSTRAINT IF EXISTS chk_inventory_alert_days;
ALTER TABLE public.inventory_items
  ADD CONSTRAINT chk_inventory_alert_days
  CHECK (expiration_alert_days IN (0, 1, 3, 5, 7));

-- Quantities may never go negative. Clamp any pre-existing bad rows first so
-- the constraint validates cleanly.
UPDATE public.inventory_items SET quantity = 0 WHERE quantity < 0;
ALTER TABLE public.inventory_items DROP CONSTRAINT IF EXISTS chk_inventory_quantity_nonneg;
ALTER TABLE public.inventory_items
  ADD CONSTRAINT chk_inventory_quantity_nonneg CHECK (quantity >= 0);

CREATE INDEX IF NOT EXISTS idx_inventory_storage_area ON public.inventory_items(storage_area_id);
CREATE INDEX IF NOT EXISTS idx_inventory_organization ON public.inventory_items(organization_id);

-- ---------------------------------------------------------------------------
-- inventory_transactions — append-only history of what happened to an item.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  organization_id   UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  product_name      TEXT,
  action            TEXT NOT NULL CHECK (action IN (
                      'created', 'updated', 'quantity_increase', 'quantity_decrease',
                      'consumed', 'wasted', 'deleted',
                      'bulk_add', 'bulk_update', 'bulk_delete',
                      'storage_moved', 'expiration_changed'
                    )),
  quantity_before   NUMERIC,
  quantity_after    NUMERIC,
  delta             NUMERIC,
  unit              TEXT,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_user    ON public.inventory_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item    ON public.inventory_transactions(inventory_item_id);

-- ---------------------------------------------------------------------------
-- price_history — one row per observed price, written automatically whenever
-- an item's price changes. Read access is gated by the price_tracking feature;
-- the rows themselves are always recorded so nothing is lost on downgrade.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.price_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  organization_id   UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_name      TEXT NOT NULL,
  barcode           TEXT,
  price             NUMERIC NOT NULL,
  previous_price    NUMERIC,
  currency          TEXT NOT NULL DEFAULT 'PHP',
  supplier          TEXT,
  purchase_date     DATE,
  recorded_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_user    ON public.price_history(user_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON public.price_history(user_id, product_name);

-- ============================================================================
-- 6. AUTOMATIC HISTORY TRIGGERS
-- ============================================================================

-- Every quantity change, status flip, expiry edit and delete is recorded.
-- Doing this in a trigger means the history cannot be skipped by a client that
-- forgets to log, and it also captures the existing consume RPC for free.
CREATE OR REPLACE FUNCTION public.log_inventory_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.inventory_transactions
      (user_id, actor_id, organization_id, inventory_item_id, product_name,
       action, quantity_before, quantity_after, delta, unit)
    VALUES
      (NEW.user_id, auth.uid(), NEW.organization_id, NEW.id, NEW.product_name,
       'created', 0, NEW.quantity, NEW.quantity, NEW.unit);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
      INSERT INTO public.inventory_transactions
        (user_id, actor_id, organization_id, inventory_item_id, product_name,
         action, quantity_before, quantity_after, delta, unit)
      VALUES
        (NEW.user_id, auth.uid(), NEW.organization_id, NEW.id, NEW.product_name,
         CASE WHEN NEW.quantity > OLD.quantity THEN 'quantity_increase' ELSE 'quantity_decrease' END,
         OLD.quantity, NEW.quantity, NEW.quantity - OLD.quantity, NEW.unit);
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('consumed', 'wasted') THEN
      INSERT INTO public.inventory_transactions
        (user_id, actor_id, organization_id, inventory_item_id, product_name,
         action, quantity_before, quantity_after, unit, metadata)
      VALUES
        (NEW.user_id, auth.uid(), NEW.organization_id, NEW.id, NEW.product_name,
         NEW.status, OLD.quantity, NEW.quantity, NEW.unit,
         jsonb_build_object('previous_status', OLD.status));
    END IF;

    IF NEW.expiration_date IS DISTINCT FROM OLD.expiration_date THEN
      INSERT INTO public.inventory_transactions
        (user_id, actor_id, organization_id, inventory_item_id, product_name,
         action, unit, metadata)
      VALUES
        (NEW.user_id, auth.uid(), NEW.organization_id, NEW.id, NEW.product_name,
         'expiration_changed', NEW.unit,
         jsonb_build_object('from', OLD.expiration_date, 'to', NEW.expiration_date));
    END IF;

    IF NEW.storage_area_id IS DISTINCT FROM OLD.storage_area_id THEN
      INSERT INTO public.inventory_transactions
        (user_id, actor_id, organization_id, inventory_item_id, product_name,
         action, unit, metadata)
      VALUES
        (NEW.user_id, auth.uid(), NEW.organization_id, NEW.id, NEW.product_name,
         'storage_moved', NEW.unit,
         jsonb_build_object('from', OLD.storage_area_id, 'to', NEW.storage_area_id));
    END IF;

    -- Price tracking history is captured even when the plan does not include
    -- the feature: downgrading must not silently destroy the record.
    IF NEW.price IS DISTINCT FROM OLD.price AND NEW.price IS NOT NULL THEN
      INSERT INTO public.price_history
        (user_id, inventory_item_id, organization_id, product_name, barcode,
         price, previous_price, purchase_date, recorded_by)
      VALUES
        (NEW.user_id, NEW.id, NEW.organization_id, NEW.product_name, NEW.barcode,
         NEW.price, OLD.price, NEW.purchase_date, auth.uid());
    END IF;

    RETURN NEW;
  END IF;

  -- DELETE: keep the row (inventory_item_id becomes NULL via ON DELETE SET NULL)
  -- so the audit trail survives the item it describes.
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.inventory_transactions
      (user_id, actor_id, organization_id, inventory_item_id, product_name,
       action, quantity_before, quantity_after, unit)
    VALUES
      (OLD.user_id, auth.uid(), OLD.organization_id, NULL, OLD.product_name,
       'deleted', OLD.quantity, 0, OLD.unit);
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_inventory_transaction ON public.inventory_items;
CREATE TRIGGER trg_log_inventory_transaction
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.log_inventory_transaction();

-- Capture the very first price when an item is created with one.
CREATE OR REPLACE FUNCTION public.log_initial_price()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.price IS NOT NULL THEN
    INSERT INTO public.price_history
      (user_id, inventory_item_id, organization_id, product_name, barcode,
       price, previous_price, purchase_date, recorded_by)
    VALUES
      (NEW.user_id, NEW.id, NEW.organization_id, NEW.product_name, NEW.barcode,
       NEW.price, NULL, NEW.purchase_date, auth.uid());
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_initial_price ON public.inventory_items;
CREATE TRIGGER trg_log_initial_price
  AFTER INSERT ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.log_initial_price();

-- ============================================================================
-- 7. ENTITLEMENT ENGINE
-- ============================================================================

-- The single source of truth for "what is this user allowed to do".
--
-- Resolution order:
--   1. their newest live subscription (trialing / active / past_due)
--   2. otherwise the free-trial plan for their account_type, reported with
--      status 'expired' or 'none' so the UI can prompt an upgrade — their
--      inventory is never touched.
--
-- `products_used` counts LIVE products (available + expired). Consumed and
-- wasted rows are history, not stock, and must not eat capacity.
CREATE OR REPLACE FUNCTION public.get_user_entitlements(p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID;
  v_account_type TEXT := 'household';
  v_sub          RECORD;
  v_plan         RECORD;
  v_features     JSONB;
  v_products     INTEGER := 0;
  v_scans        INTEGER := 0;
  v_status       TEXT;
  v_is_active    BOOLEAN := FALSE;
BEGIN
  v_uid := COALESCE(p_user_id, auth.uid());

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF auth.uid() IS NOT NULL AND v_uid <> auth.uid() THEN
    RAISE EXCEPTION 'access_denied: user_id does not match the session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(p.account_type, 'household') INTO v_account_type
  FROM public.profiles p WHERE p.id = v_uid;

  SELECT s.* INTO v_sub
  FROM public.user_subscriptions s
  WHERE s.user_id = v_uid
    AND s.status IN ('trialing', 'active', 'past_due')
  ORDER BY s.current_period_end DESC
  LIMIT 1;

  IF v_sub.id IS NULL THEN
    v_status := 'none';
  ELSE
    SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id;
    v_is_active := v_sub.current_period_end > NOW() AND v_sub.status IN ('trialing', 'active');
    IF v_is_active THEN
      v_status := v_sub.status;
    ELSIF v_sub.status = 'canceled' THEN
      v_status := 'canceled';
    ELSE
      v_status := 'expired';
    END IF;
  END IF;

  -- Fall back to the audience's free-trial plan: it defines the floor limits
  -- that still apply after a paid plan lapses.
  IF v_plan.id IS NULL THEN
    SELECT * INTO v_plan FROM public.subscription_plans
    WHERE audience = COALESCE(v_account_type, 'household') AND tier = 'free_trial'
    LIMIT 1;
  END IF;

  SELECT COALESCE(jsonb_object_agg(
           fe.feature_key,
           jsonb_build_object('enabled', fe.enabled, 'limit', fe.limit_value)
         ), '{}'::jsonb)
  INTO v_features
  FROM public.feature_entitlements fe
  WHERE fe.plan_id = v_plan.id;

  SELECT COUNT(*) INTO v_products
  FROM public.inventory_items i
  WHERE i.user_id = v_uid
    AND i.status NOT IN ('consumed', 'wasted');

  SELECT COALESCE(u.ai_scans_used, 0) INTO v_scans
  FROM public.subscription_usage u
  WHERE u.user_id = v_uid
    AND u.period_start = date_trunc('month', CURRENT_DATE)::date;

  v_scans := COALESCE(v_scans, 0);

  RETURN jsonb_build_object(
    'user_id',           v_uid,
    'account_type',      v_account_type,
    'plan_id',           v_plan.id,
    'plan_name',         v_plan.name,
    'audience',          v_plan.audience,
    'tier',              v_plan.tier,
    'billing_period',    v_plan.billing_period,
    'price_php',         v_plan.price_php,
    'status',            v_status,
    'is_active',         v_is_active,
    'started_at',        v_sub.started_at,
    'current_period_end',v_sub.current_period_end,
    'cancel_at_period_end', COALESCE(v_sub.cancel_at_period_end, FALSE),
    'auto_renew',        COALESCE(v_sub.auto_renew, FALSE),
    'provider',          COALESCE(v_sub.provider, 'none'),
    'is_verified_paid',  (v_sub.provider_verified_at IS NOT NULL AND v_sub.provider <> 'none'),
    'max_products',      v_plan.max_products,
    'products_used',     v_products,
    'max_ai_scans',      v_plan.max_ai_scans,
    'ai_scans_used',     v_scans,
    'usage_period_start', date_trunc('month', CURRENT_DATE)::date,
    'features',          v_features
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Feature gates. Every one of these is callable from the client for UI purposes
-- AND from the database for enforcement — same answer either way.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_add_product(p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (public.get_user_entitlements(p_user_id) ->> 'products_used')::INTEGER
       < (public.get_user_entitlements(p_user_id) ->> 'max_products')::INTEGER;
$$;

CREATE OR REPLACE FUNCTION public.can_use_ai_scan(p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (public.get_user_entitlements(p_user_id) ->> 'ai_scans_used')::INTEGER
       < (public.get_user_entitlements(p_user_id) ->> 'max_ai_scans')::INTEGER;
$$;

CREATE OR REPLACE FUNCTION public.can_use_price_tracking(p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (public.get_user_entitlements(p_user_id) -> 'features' -> 'price_tracking' ->> 'enabled')::BOOLEAN,
    FALSE);
$$;

CREATE OR REPLACE FUNCTION public.can_use_waste_report(p_advanced BOOLEAN DEFAULT FALSE, p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (public.get_user_entitlements(p_user_id) -> 'features'
      -> CASE WHEN p_advanced THEN 'advanced_waste_report' ELSE 'waste_report' END ->> 'enabled')::BOOLEAN,
    FALSE);
$$;

CREATE OR REPLACE FUNCTION public.can_use_multiple_storage(p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (public.get_user_entitlements(p_user_id) -> 'features' -> 'multiple_storage' ->> 'enabled')::BOOLEAN,
    FALSE);
$$;

CREATE OR REPLACE FUNCTION public.can_use_staff_management(p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (public.get_user_entitlements(p_user_id) -> 'features' -> 'staff_management' ->> 'enabled')::BOOLEAN,
    FALSE);
$$;

CREATE OR REPLACE FUNCTION public.can_use_bulk_inventory(p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (public.get_user_entitlements(p_user_id) -> 'features' -> 'bulk_inventory' ->> 'enabled')::BOOLEAN,
    FALSE);
$$;

-- How many storage areas the plan allows. NULL = unlimited.
CREATE OR REPLACE FUNCTION public.storage_area_limit(p_user_id UUID DEFAULT NULL)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NULLIF((public.get_user_entitlements(p_user_id) -> 'features' -> 'multiple_storage' ->> 'limit'), '')::INTEGER;
$$;

-- ============================================================================
-- 8. ENFORCEMENT (server side — cannot be bypassed by a modified client)
-- ============================================================================

-- Rejects an insert that would exceed the plan's product capacity.
CREATE OR REPLACE FUNCTION public.enforce_inventory_entitlements()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.uid() IS NULL means a service-role call (migrations, edge functions,
  -- scheduled jobs). Those are trusted and must not be capped.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id <> auth.uid()
     AND NOT (NEW.organization_id IS NOT NULL AND public.is_org_member(NEW.organization_id, auth.uid())) THEN
    RAISE EXCEPTION 'access_denied: not your inventory'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.can_add_product(NEW.user_id) THEN
    RAISE EXCEPTION 'inventory_limit_reached'
      USING ERRCODE = 'check_violation',
            HINT = 'Upgrade the subscription to add more products.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_inventory_entitlements ON public.inventory_items;
CREATE TRIGGER trg_enforce_inventory_entitlements
  BEFORE INSERT ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_inventory_entitlements();

-- Rejects a storage area beyond the plan's allowance.
CREATE OR REPLACE FUNCTION public.enforce_storage_area_limit()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER;
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.can_use_multiple_storage(NEW.user_id) THEN
    RAISE EXCEPTION 'multiple_storage_not_in_plan'
      USING ERRCODE = 'check_violation',
            HINT = 'Multiple storage areas are not included in the current plan.';
  END IF;

  v_limit := public.storage_area_limit(NEW.user_id);
  IF v_limit IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM public.storage_areas WHERE user_id = NEW.user_id;
    IF v_count >= v_limit THEN
      RAISE EXCEPTION 'storage_area_limit_reached'
        USING ERRCODE = 'check_violation',
              HINT = 'The current plan allows at most ' || v_limit || ' storage areas.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_storage_area_limit ON public.storage_areas;
CREATE TRIGGER trg_enforce_storage_area_limit
  BEFORE INSERT ON public.storage_areas
  FOR EACH ROW EXECUTE FUNCTION public.enforce_storage_area_limit();

/* ---------------------------------------------------------------------------
 * consume_ai_scan — atomically burn one AI scan, or refuse.
 *
 * The ON CONFLICT ... DO UPDATE ... WHERE clause is what makes this safe under
 * concurrent requests: the row is locked, the WHERE is evaluated against the
 * freshly locked value, and a request that would exceed the cap leaves
 * `v_new` NULL instead of incrementing.
 * ------------------------------------------------------------------------ */
CREATE OR REPLACE FUNCTION public.consume_ai_scan(p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID;
  v_max     INTEGER;
  v_new     INTEGER;
  v_month   DATE := date_trunc('month', CURRENT_DATE)::date;
BEGIN
  v_uid := COALESCE(p_user_id, auth.uid());

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF auth.uid() IS NOT NULL AND v_uid <> auth.uid() THEN
    RAISE EXCEPTION 'access_denied: user_id does not match the session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_max := (public.get_user_entitlements(v_uid) ->> 'max_ai_scans')::INTEGER;

  INSERT INTO public.subscription_usage (user_id, period_start, period_end, ai_scans_used)
  VALUES (v_uid, v_month, (v_month + INTERVAL '1 month - 1 day')::date, 1)
  ON CONFLICT (user_id, period_start) DO UPDATE
    SET ai_scans_used = public.subscription_usage.ai_scans_used + 1,
        updated_at    = NOW()
    WHERE public.subscription_usage.ai_scans_used < v_max
  RETURNING ai_scans_used INTO v_new;

  IF v_new IS NULL THEN
    RAISE EXCEPTION 'ai_scan_limit_reached'
      USING ERRCODE = 'check_violation',
            HINT = 'Monthly AI scan limit reached. Upgrade for more scans.';
  END IF;

  RETURN jsonb_build_object('ai_scans_used', v_new, 'max_ai_scans', v_max);
END;
$$;

/* ---------------------------------------------------------------------------
 * adjust_inventory_quantity — the ±control's backend.
 *
 * Clamps at zero rather than erroring, so a double-tap on "−" can never push a
 * quantity negative or fail with a constraint violation. The AFTER UPDATE
 * trigger writes the history row.
 * ------------------------------------------------------------------------ */
CREATE OR REPLACE FUNCTION public.adjust_inventory_quantity(
  p_item_id UUID,
  p_delta   NUMERIC
)
RETURNS public.inventory_items
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row    public.inventory_items;
  v_before NUMERIC;
  v_after  NUMERIC;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'invalid_delta: p_delta must be a non-zero number'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_row FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'item_not_found: no inventory item with id %', p_item_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF auth.uid() IS NOT NULL
     AND v_row.user_id <> auth.uid()
     AND NOT (v_row.organization_id IS NOT NULL
              AND public.is_org_member(v_row.organization_id, auth.uid())) THEN
    RAISE EXCEPTION 'access_denied: not your inventory'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_before := COALESCE(v_row.quantity, 0);
  v_after  := GREATEST(v_before + p_delta, 0);

  UPDATE public.inventory_items
     SET quantity   = v_after,
         updated_at = NOW()
   WHERE id = p_item_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- Notification de-duplication.
--
-- Returns TRUE when the caller may send, FALSE when this exact notification was
-- already logged. A unique index on (user_id, dedupe_key) does the work; NULL
-- dedupe_keys stay distinct in Postgres, so un-keyed log rows are unaffected.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_logs
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT,
  ADD COLUMN IF NOT EXISTS title      TEXT,
  ADD COLUMN IF NOT EXISTS body       TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_logs_dedupe
  ON public.notification_logs (user_id, dedupe_key);

CREATE OR REPLACE FUNCTION public.log_notification(
  p_user_id           UUID,
  p_notification_type TEXT,
  p_dedupe_key        TEXT DEFAULT NULL,
  p_inventory_item_id UUID DEFAULT NULL,
  p_title             TEXT DEFAULT NULL,
  p_body              TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'access_denied: user_id does not match the session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.notification_logs
    (user_id, notification_type, dedupe_key, inventory_item_id, title, body, sent_at)
  VALUES
    (p_user_id, p_notification_type, p_dedupe_key, p_inventory_item_id, p_title, p_body, NOW())
  ON CONFLICT (user_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  -- A NULL v_id means the row already existed -> this is a duplicate.
  RETURN v_id IS NOT NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Self-service subscription actions. These run SECURITY DEFINER so the guard
-- trigger's client-side column restriction is respected by design rather than
-- by exception.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_my_subscription(p_at_period_end BOOLEAN DEFAULT TRUE)
RETURNS public.user_subscriptions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row public.user_subscriptions;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.user_subscriptions
     SET cancel_at_period_end = p_at_period_end,
         auto_renew           = NOT p_at_period_end,
         canceled_at          = CASE WHEN p_at_period_end THEN NOW() ELSE NULL END,
         updated_at           = NOW()
   WHERE user_id = v_uid
     AND status IN ('trialing', 'active', 'past_due')
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'no_live_subscription' USING ERRCODE = 'no_data_found';
  END IF;

  RETURN v_row;
END;
$$;

-- Housekeeping for a scheduled job / edge function. Deliberately NOT granted to
-- authenticated: one user must never be able to expire everyone's plan.
CREATE OR REPLACE FUNCTION public.expire_stale_subscriptions()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.user_subscriptions
     SET status     = CASE WHEN cancel_at_period_end THEN 'canceled' ELSE 'expired' END,
         updated_at = NOW()
   WHERE status IN ('trialing', 'active', 'past_due')
     AND current_period_end <= NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============================================================================
-- 9. NEW USER BOOTSTRAP
-- ============================================================================

-- Grants the 7-day free trial, opens the first usage period, creates default
-- storage areas and seeds preference rows — everything a brand-new account
-- needs to be immediately usable.
CREATE OR REPLACE FUNCTION public.grant_default_entitlements()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id  TEXT;
  v_days     INTEGER;
  v_sub_id   UUID;
BEGIN
  v_plan_id := CASE WHEN NEW.account_type = 'establishment'
                    THEN 'establishment_trial'
                    ELSE 'household_trial' END;

  SELECT duration_days INTO v_days
  FROM public.subscription_plans WHERE id = v_plan_id;

  v_days := COALESCE(v_days, 7);

  INSERT INTO public.user_subscriptions
    (user_id, plan_id, status, started_at, current_period_start, current_period_end, provider)
  VALUES
    (NEW.id, v_plan_id, 'trialing', NOW(), NOW(), NOW() + (v_days || ' days')::INTERVAL, 'none')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_sub_id;

  INSERT INTO public.subscription_usage
    (user_id, subscription_id, period_start, period_end, ai_scans_used)
  VALUES
    (NEW.id, v_sub_id,
     date_trunc('month', CURRENT_DATE)::date,
     (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date,
     0)
  ON CONFLICT (user_id, period_start) DO NOTHING;

  INSERT INTO public.storage_areas (user_id, name, kind, is_default)
  VALUES
    (NEW.id, 'Refrigerator', 'refrigerator', TRUE),
    (NEW.id, 'Freezer',      'freezer',      FALSE),
    (NEW.id, 'Pantry',       'pantry',       FALSE)
  ON CONFLICT (user_id, name) DO NOTHING;

  INSERT INTO public.notification_preferences (user_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.user_preferences (user_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created ON public.profiles;
CREATE TRIGGER on_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.grant_default_entitlements();

-- Seed the preference rows that `notificationService.getNotificationPreferences`
-- reads with .single() — without them that call throws for any account created
-- before this migration.
INSERT INTO public.notification_preferences (user_id)
SELECT p.id FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.notification_preferences n WHERE n.user_id = p.id)
ON CONFLICT DO NOTHING;

INSERT INTO public.user_preferences (user_id)
SELECT p.id FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.user_preferences u WHERE u.user_id = p.id)
ON CONFLICT DO NOTHING;

-- Backfill: every pre-existing account gets a trial, a usage period and the
-- default storage areas. Their inventory is untouched — if they are already
-- over the trial capacity they simply cannot add more until they upgrade.
INSERT INTO public.user_subscriptions
  (user_id, plan_id, status, started_at, current_period_start, current_period_end, provider)
SELECT
  p.id,
  CASE WHEN p.account_type = 'establishment' THEN 'establishment_trial' ELSE 'household_trial' END,
  'trialing', NOW(), NOW(), NOW() + INTERVAL '7 days', 'none'
FROM public.profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_subscriptions s
  WHERE s.user_id = p.id AND s.status IN ('trialing', 'active', 'past_due')
);

INSERT INTO public.subscription_usage (user_id, subscription_id, period_start, period_end)
SELECT s.user_id, s.id,
       date_trunc('month', CURRENT_DATE)::date,
       (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date
FROM public.user_subscriptions s
WHERE s.status IN ('trialing', 'active', 'past_due')
ON CONFLICT (user_id, period_start) DO NOTHING;

INSERT INTO public.storage_areas (user_id, name, kind, is_default)
SELECT p.id, a.name, a.kind, a.is_default
FROM public.profiles p
CROSS JOIN (VALUES
  ('Refrigerator', 'refrigerator', TRUE),
  ('Freezer',      'freezer',      FALSE),
  ('Pantry',       'pantry',       FALSE)
) AS a(name, kind, is_default)
ON CONFLICT (user_id, name) DO NOTHING;

-- ============================================================================
-- 10. ROW LEVEL SECURITY
-- ============================================================================

-- --- Plans & feature matrix: readable by any signed-in user (it's a price list)
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view subscription plans" ON public.subscription_plans;
CREATE POLICY "Anyone can view subscription plans" ON public.subscription_plans
  FOR SELECT TO authenticated USING (TRUE);

ALTER TABLE public.feature_entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view feature entitlements" ON public.feature_entitlements;
CREATE POLICY "Anyone can view feature entitlements" ON public.feature_entitlements
  FOR SELECT TO authenticated USING (TRUE);

-- --- Subscriptions: read own; updates restricted to cancellation flags by the
--     guard trigger. There is deliberately no INSERT/DELETE policy.
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own subscription" ON public.user_subscriptions;
CREATE POLICY "Users can view own subscription" ON public.user_subscriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own subscription" ON public.user_subscriptions;
CREATE POLICY "Users can update own subscription" ON public.user_subscriptions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- --- Usage: read own. Written only by consume_ai_scan / the trial grant.
ALTER TABLE public.subscription_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own usage" ON public.subscription_usage;
CREATE POLICY "Users can view own usage" ON public.subscription_usage
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- --- Storage areas
ALTER TABLE public.storage_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own storage areas" ON public.storage_areas;
CREATE POLICY "Users can view own storage areas" ON public.storage_areas
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR (organization_id IS NOT NULL AND public.is_org_member(organization_id, auth.uid()))
  );

DROP POLICY IF EXISTS "Users can insert own storage areas" ON public.storage_areas;
CREATE POLICY "Users can insert own storage areas" ON public.storage_areas
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own storage areas" ON public.storage_areas;
CREATE POLICY "Users can update own storage areas" ON public.storage_areas
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own storage areas" ON public.storage_areas;
CREATE POLICY "Users can delete own storage areas" ON public.storage_areas
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- --- Inventory: extend the original owner-only policies with organisation
--     membership so staff can work the same stock. (replace, not add — two
--     permissive SELECT policies would OR together, which is what we want, but
--     keeping one readable policy per command is easier to audit.)
DROP POLICY IF EXISTS "Users can view own inventory" ON public.inventory_items;
CREATE POLICY "Users can view own inventory" ON public.inventory_items
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR (organization_id IS NOT NULL AND public.is_org_member(organization_id, auth.uid()))
  );

DROP POLICY IF EXISTS "Users can insert own inventory" ON public.inventory_items;
CREATE POLICY "Users can insert own inventory" ON public.inventory_items
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR (organization_id IS NOT NULL AND public.is_org_member(organization_id, auth.uid()))
  );

DROP POLICY IF EXISTS "Users can update own inventory" ON public.inventory_items;
CREATE POLICY "Users can update own inventory" ON public.inventory_items
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR (organization_id IS NOT NULL AND public.is_org_member(organization_id, auth.uid()))
  );

DROP POLICY IF EXISTS "Users can delete own inventory" ON public.inventory_items;
CREATE POLICY "Users can delete own inventory" ON public.inventory_items
  FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.can_manage_org(organization_id, auth.uid())
  );

-- --- Inventory transactions: read-only history.
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own inventory history" ON public.inventory_transactions;
CREATE POLICY "Users can view own inventory history" ON public.inventory_transactions
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR (organization_id IS NOT NULL AND public.is_org_member(organization_id, auth.uid()))
  );

-- --- Price history: readable when the plan includes price tracking.
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own price history" ON public.price_history;
CREATE POLICY "Users can view own price history" ON public.price_history
  FOR SELECT TO authenticated
  USING (
    (auth.uid() = user_id AND public.can_use_price_tracking(auth.uid()))
    OR (organization_id IS NOT NULL AND public.is_org_member(organization_id, auth.uid()))
  );

DROP POLICY IF EXISTS "Users can insert own price history" ON public.price_history;
CREATE POLICY "Users can insert own price history" ON public.price_history
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- --- Organisations
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their organizations" ON public.organizations;
CREATE POLICY "Members can view their organizations" ON public.organizations
  FOR SELECT TO authenticated
  USING (auth.uid() = owner_id OR public.is_org_member(id, auth.uid()));

DROP POLICY IF EXISTS "Owners can create organizations" ON public.organizations;
CREATE POLICY "Owners can create organizations" ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Owners can update their organizations" ON public.organizations;
CREATE POLICY "Owners can update their organizations" ON public.organizations
  FOR UPDATE TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Owners can delete their organizations" ON public.organizations;
CREATE POLICY "Owners can delete their organizations" ON public.organizations
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

-- --- Organisation members / staff
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their team" ON public.organization_members;
CREATE POLICY "Members can view their team" ON public.organization_members
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_org_member(organization_id, auth.uid()));

DROP POLICY IF EXISTS "Admins can add team members" ON public.organization_members;
CREATE POLICY "Admins can add team members" ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_org(organization_id, auth.uid()));

DROP POLICY IF EXISTS "Admins can update team members" ON public.organization_members;
CREATE POLICY "Admins can update team members" ON public.organization_members
  FOR UPDATE TO authenticated
  USING (public.can_manage_org(organization_id, auth.uid()))
  WITH CHECK (public.can_manage_org(organization_id, auth.uid()));

DROP POLICY IF EXISTS "Admins can remove team members" ON public.organization_members;
CREATE POLICY "Admins can remove team members" ON public.organization_members
  FOR DELETE TO authenticated
  USING (
    public.can_manage_org(organization_id, auth.uid())
    AND role <> 'owner'  -- the owner can never be removed from their own org
  );

-- ============================================================================
-- 11. FUNCTION GRANTS
-- ============================================================================

REVOKE ALL ON FUNCTION public.expire_stale_subscriptions() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_user_entitlements(UUID)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_add_product(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_ai_scan(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_price_tracking(UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_waste_report(BOOLEAN, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_multiple_storage(UUID)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_staff_management(UUID)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_use_bulk_inventory(UUID)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.storage_area_limit(UUID)           TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_scan(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_quantity(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_notification(UUID, TEXT, TEXT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_my_subscription(BOOLEAN)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID, UUID)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_role(UUID, UUID)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_org(UUID, UUID)         TO authenticated;

-- ============================================================================
-- 12. REALTIME
-- ============================================================================
-- REPLICA IDENTITY FULL so DELETE events carry the full old row (the client
-- otherwise receives only the primary key and cannot tell what disappeared).
ALTER TABLE public.inventory_items        REPLICA IDENTITY FULL;
ALTER TABLE public.grocery_items          REPLICA IDENTITY FULL;
ALTER TABLE public.user_subscriptions     REPLICA IDENTITY FULL;
ALTER TABLE public.subscription_usage     REPLICA IDENTITY FULL;
ALTER TABLE public.storage_areas          REPLICA IDENTITY FULL;
ALTER TABLE public.inventory_transactions REPLICA IDENTITY FULL;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inventory_items',
    'grocery_items',
    'grocery_lists',
    'user_subscriptions',
    'subscription_usage',
    'storage_areas',
    'inventory_transactions'
  ]
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;  -- already published
      WHEN undefined_object THEN NULL;  -- publication missing (local dev without realtime)
    END;
  END LOOP;
END;
$$;

-- ============================================================================
-- 13. Done
-- ============================================================================
SELECT 'KeepFresh AI subscriptions & entitlements ready' AS status;
