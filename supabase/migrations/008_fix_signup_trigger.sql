-- Migration 008: Fix "Database error saving new user"
--
-- Root cause: Migration 002 attempted a direct INSERT INTO auth.users which
-- fails on recent Supabase versions, causing the whole migration to roll back.
-- As a result the handle_new_user trigger fix and the profiles INSERT policy
-- from migration 002 were never applied.
--
-- This migration re-applies those fixes unconditionally and also stores the
-- birth_date passed from the sign-up form into the new profiles.birth_date column.

-- 1. Recreate the trigger function with the correct search_path and birth_date support.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, birth_date)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url',
    NULLIF(NEW.raw_user_meta_data->>'birth_date', '')::DATE
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 2. Drop and recreate the trigger so it points at the updated function.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Ensure the INSERT policy on profiles exists (idempotent).
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;
CREATE POLICY "Service role can insert profiles" ON public.profiles
  FOR INSERT WITH CHECK (true);
