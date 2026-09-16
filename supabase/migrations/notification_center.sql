ALTER TABLE public.notification_logs
  ADD COLUMN IF NOT EXISTS read_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deliver_at TIMESTAMPTZ;

UPDATE public.notification_logs
   SET deliver_at = sent_at
 WHERE deliver_at IS NULL;


-- [2] Indexes

-- The list: newest-delivered-first for one user.
CREATE INDEX IF NOT EXISTS idx_notification_logs_center
  ON public.notification_logs (user_id, deliver_at DESC);

-- The badge. Partial, so counting unread never touches a read row.
CREATE INDEX IF NOT EXISTS idx_notification_logs_unread
  ON public.notification_logs (user_id)
  WHERE read_at IS NULL;

-- [3] log_notification - same signature, now stamps deliver_at

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
    (user_id, notification_type, dedupe_key, inventory_item_id,
     title, body, deliver_at, sent_at)
  VALUES
    (p_user_id, p_notification_type, p_dedupe_key, p_inventory_item_id,
     p_title, p_body, NOW(), NOW())
  ON CONFLICT (user_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  -- A NULL v_id means the row already existed -> this is a duplicate.
  RETURN v_id IS NOT NULL;
END;
$$;

-- [4] Marking read

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id  UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.notification_logs
     SET read_at = NOW()
   WHERE id = p_id
     AND user_id = v_uid
     AND read_at IS NULL
  RETURNING id INTO v_id;

  
  RETURN v_id IS NOT NULL;
END;
$$;


CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'access_denied: no authenticated user in session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Only what the popover could actually have shown. A reminder queued for next
  -- week has not been read by anyone, and silently consuming it here would drop
  -- it from the badge before it was ever displayed.
  UPDATE public.notification_logs
     SET read_at = NOW()
   WHERE user_id = v_uid
     AND read_at IS NULL
     AND deliver_at <= NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


-- [5] Privileges
--
-- Same treatment function_privilege_hardening.sql gives every other routine.
-- log_notification is re-stated because it was replaced above.

DO $$
DECLARE
  fn TEXT;
  routines TEXT[] := ARRAY[
    'public.log_notification(uuid, text, text, uuid, text, text)',
    'public.mark_notification_read(uuid)',
    'public.mark_all_notifications_read()'
  ];
BEGIN
  FOREACH fn IN ARRAY routines
  LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
    EXCEPTION
      WHEN undefined_function THEN
        RAISE NOTICE 'skipping % (not present)', fn;
    END;
  END LOOP;
END;
$$;
-- [6] Realtime

ALTER TABLE public.notification_logs REPLICA IDENTITY FULL;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_logs']
  LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;   -- already published
      WHEN undefined_object THEN NULL;   -- publication missing (local dev without realtime)
    END;
  END LOOP;
END;
$$;


-- [7] Verify

DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(c.name, ', ')
    INTO v_missing
  FROM (VALUES ('read_at'), ('deliver_at')) AS c(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'notification_logs'
       AND column_name  = c.name
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'notification_logs is missing: %', v_missing;
  END IF;

  IF has_function_privilege('anon', 'public.mark_notification_read(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mark_all_notifications_read()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can still execute a notification RPC';
  END IF;
END;
$$;

SELECT 'KeepFresh AI notification centre ready' AS status;
