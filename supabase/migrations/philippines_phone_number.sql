-- Store the PH mobile number collected during household/business signup.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Signup may require email confirmation, so the auth trigger must save phone
-- metadata before the user has a session to write their own profile row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles
    (id, email, full_name, phone_number, account_type, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone_number', ''),
    COALESCE(NEW.raw_user_meta_data->>'account_type', 'household'),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
