DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['food_waste', 'inventory_consumption']
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

SELECT 'KeepFresh AI waste realtime ready' AS status;
