-- Generated from supabase/migrations on 2026-06-22 08:28:29

-- BEGIN 001_initial_schema.sql

-- Zen Dojo Initial Schema

-- Belt level enum
CREATE TYPE belt_level AS ENUM ('white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black');

-- Membership status enum
CREATE TYPE membership_status AS ENUM ('active', 'expired', 'suspended', 'pending');

-- Profiles table (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  belt_level belt_level DEFAULT 'white',
  qr_code_id UUID DEFAULT gen_random_uuid() UNIQUE,
  is_admin BOOLEAN DEFAULT FALSE,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Memberships table
CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('monthly', 'session_pass', 'annual')),
  total_sessions INTEGER,
  remaining_sessions INTEGER,
  valid_until TIMESTAMPTZ NOT NULL,
  status membership_status DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Training sessions table
CREATE TABLE training_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  instructor_name TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'all',
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 20,
  current_bookings INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Bookings table (member <-> training session)
CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  checked_in BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, session_id, booking_date)
);

-- Attendance log (check-ins)
CREATE TABLE attendance_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id UUID REFERENCES training_sessions(id) ON DELETE SET NULL,
  checked_in_at TIMESTAMPTZ DEFAULT now()
);

-- Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_log ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all profiles, update own
CREATE POLICY "Profiles are viewable by authenticated users" ON profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Memberships: users see own, admins see all
CREATE POLICY "Users can view own memberships" ON memberships
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
CREATE POLICY "Admins can manage memberships" ON memberships
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Training sessions: visible to all authenticated
CREATE POLICY "Training sessions are viewable" ON training_sessions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage training sessions" ON training_sessions
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Bookings: users see own, admins see all
CREATE POLICY "Users can view own bookings" ON bookings
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
CREATE POLICY "Users can create own bookings" ON bookings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own bookings" ON bookings
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Attendance: admins manage, users view own
CREATE POLICY "Users can view own attendance" ON attendance_log
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );
CREATE POLICY "Admins can create attendance records" ON attendance_log
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER memberships_updated_at
  BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- END 001_initial_schema.sql


-- BEGIN 002_fix_trigger_and_admin.sql

-- Fix handle_new_user trigger: add SET search_path = public to prevent
-- "Database error saving new user" when called from auth schema context
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Fix update_updated_at with proper search_path
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add INSERT policy for profiles (needed by trigger and service role)
DROP POLICY IF EXISTS "Admins can manage profiles" ON public.profiles;

CREATE POLICY "Service role can insert profiles" ON public.profiles
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Admins can manage profiles" ON public.profiles
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Create default admin user
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  is_super_admin, confirmation_token, recovery_token,
  email_change_token_new, email_change
)
SELECT
  '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
  'authenticated', 'authenticated', 'admin@dhkse.hu',
  crypt('Dhkse2026!', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"full_name":"Metzger Antal"}',
  false, '', '', '', ''
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@dhkse.hu');

-- Set admin flag on the auto-created profile
UPDATE public.profiles
SET is_admin = true, full_name = 'Metzger Antal'
WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@dhkse.hu');

-- END 002_fix_trigger_and_admin.sql


-- BEGIN 003_fix_rls_infinite_recursion.sql

-- Fix infinite recursion in profiles RLS policy
-- The "Admins can manage profiles" policy in 002 queried profiles from within
-- a profiles policy, causing "infinite recursion detected in policy for relation profiles".
--
-- Solution: use a SECURITY DEFINER function to check admin status.
-- SECURITY DEFINER bypasses RLS when the function reads profiles,
-- breaking the recursion cycle.

CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Drop the recursive policy on profiles
DROP POLICY IF EXISTS "Admins can manage profiles" ON public.profiles;

-- Recreate it using the function (no recursion)
CREATE POLICY "Admins can manage profiles" ON public.profiles
  FOR ALL TO authenticated USING (public.is_current_user_admin());

-- Fix other tables that also used the recursive subquery pattern
DROP POLICY IF EXISTS "Users can view own memberships" ON public.memberships;
DROP POLICY IF EXISTS "Admins can manage memberships" ON public.memberships;
DROP POLICY IF EXISTS "Admins can manage training sessions" ON public.training_sessions;
DROP POLICY IF EXISTS "Users can view own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can view own attendance" ON public.attendance_log;
DROP POLICY IF EXISTS "Admins can create attendance records" ON public.attendance_log;

CREATE POLICY "Users can view own memberships" ON public.memberships
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_current_user_admin()
  );
CREATE POLICY "Admins can manage memberships" ON public.memberships
  FOR ALL TO authenticated USING (public.is_current_user_admin());

CREATE POLICY "Admins can manage training sessions" ON public.training_sessions
  FOR ALL TO authenticated USING (public.is_current_user_admin());

CREATE POLICY "Users can view own bookings" ON public.bookings
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_current_user_admin()
  );

CREATE POLICY "Users can view own attendance" ON public.attendance_log
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_current_user_admin()
  );
CREATE POLICY "Admins can create attendance records" ON public.attendance_log
  FOR INSERT TO authenticated WITH CHECK (public.is_current_user_admin());

-- END 003_fix_rls_infinite_recursion.sql


-- BEGIN 004_seed_training_sessions.sql

-- Seed training sessions with real DHKSE schedule
-- day_of_week: 1=Monday, 2=Tuesday, 4=Thursday, 5=Friday
INSERT INTO training_sessions (title, instructor_name, level, day_of_week, start_time, end_time, capacity, current_bookings)
VALUES
  ('Kempo', 'Shihan Metzger Antal', 'Gyerek és felnőtt', 1, '18:00', '19:30', 25, 0),
  ('Cross Fitness', 'Shihan Metzger Antal', 'Összes szint', 2, '18:00', '19:00', 20, 0),
  ('Kempo Versenyző', 'Sensei Farkas Zoltán', 'Versenyző', 2, '19:00', '20:00', 15, 0),
  ('Kempo', 'Sensei Rácz Richárd', 'Gyerek és felnőtt', 2, '18:15', '19:30', 20, 0),
  ('Kempo Kezdő', 'Shihan Metzger Antal', 'Gyerek és kezdő felnőtt', 4, '18:00', '19:30', 25, 0),
  ('Kempo', 'Sensei Rácz Richárd', 'Gyerek és felnőtt', 5, '17:30', '19:00', 20, 0)
ON CONFLICT DO NOTHING;

-- END 004_seed_training_sessions.sql


-- BEGIN 005_fix_booking_and_attendance.sql

-- Fix: Allow regular users to book training sessions via a SECURITY DEFINER function.
-- This avoids giving non-admin users direct UPDATE access to training_sessions.

-- RPC function: book a training session (atomic)
CREATE OR REPLACE FUNCTION public.book_training_session(
  p_session_id UUID,
  p_user_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_session RECORD;
  v_existing RECORD;
BEGIN
  -- Check if already booked today
  SELECT id INTO v_existing
    FROM public.bookings
    WHERE user_id = p_user_id
      AND session_id = p_session_id
      AND booking_date = v_today;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'Már foglaltál erre az edzésre.');
  END IF;

  -- Get session and check capacity
  SELECT id, capacity, current_bookings INTO v_session
    FROM public.training_sessions
    WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Az edzés nem található.');
  END IF;

  IF v_session.current_bookings >= v_session.capacity THEN
    RETURN jsonb_build_object('error', 'Az edzés betelt.');
  END IF;

  -- Create booking
  INSERT INTO public.bookings (user_id, session_id, booking_date)
    VALUES (p_user_id, p_session_id, v_today);

  -- Increment current_bookings
  UPDATE public.training_sessions
    SET current_bookings = current_bookings + 1
    WHERE id = p_session_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Also allow regular users to log their own attendance (for QR scan by admin or self-checkin)
-- The current policy only allows admin INSERT. Let's keep admin-only for attendance creation
-- since admins scan QR codes to log attendance.

-- Make sure training_sessions SELECT policy exists (from migration 001, not dropped in 003)
-- No action needed.

-- END 005_fix_booking_and_attendance.sql


-- BEGIN 006_subscriptions_and_qr_management.sql

-- Migration 006: Subscriptions list, cancel booking, QR-based membership management

-- 1. Update book_training_session to accept an explicit booking date
CREATE OR REPLACE FUNCTION public.book_training_session(
  p_session_id UUID,
  p_user_id UUID,
  p_booking_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB AS $$
DECLARE
  v_session RECORD;
  v_existing RECORD;
BEGIN
  -- Check if already booked on that date
  SELECT id INTO v_existing
    FROM public.bookings
    WHERE user_id = p_user_id
      AND session_id = p_session_id
      AND booking_date = p_booking_date;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'Már foglaltál erre az edzésre.');
  END IF;

  -- Get session and check capacity
  SELECT id, capacity, current_bookings INTO v_session
    FROM public.training_sessions
    WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Az edzés nem található.');
  END IF;

  IF v_session.current_bookings >= v_session.capacity THEN
    RETURN jsonb_build_object('error', 'Az edzés betelt.');
  END IF;

  -- Create booking
  INSERT INTO public.bookings (user_id, session_id, booking_date)
    VALUES (p_user_id, p_session_id, p_booking_date);

  -- Increment current_bookings
  UPDATE public.training_sessions
    SET current_bookings = current_bookings + 1
    WHERE id = p_session_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 2. Cancel booking function (decrements current_bookings atomically)
CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_session_id UUID,
  p_user_id UUID,
  p_booking_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB AS $$
DECLARE
  v_existing_id UUID;
BEGIN
  SELECT id INTO v_existing_id
    FROM public.bookings
    WHERE user_id = p_user_id
      AND session_id = p_session_id
      AND booking_date = p_booking_date;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Nincs ilyen foglalás.');
  END IF;

  DELETE FROM public.bookings WHERE id = v_existing_id;

  UPDATE public.training_sessions
    SET current_bookings = GREATEST(0, current_bookings - 1)
    WHERE id = p_session_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 3. Get all upcoming bookings for a user (with session details)
CREATE OR REPLACE FUNCTION public.get_user_bookings(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'booking_id',    b.id,
      'session_id',    b.session_id,
      'booking_date',  b.booking_date,
      'checked_in',    b.checked_in,
      'session_title', ts.title,
      'instructor',    ts.instructor_name,
      'start_time',    ts.start_time,
      'end_time',      ts.end_time,
      'day_of_week',   ts.day_of_week,
      'level',         ts.level
    )
    ORDER BY b.booking_date ASC
  )
  INTO v_result
  FROM public.bookings b
  JOIN public.training_sessions ts ON ts.id = b.session_id
  WHERE b.user_id = p_user_id
    AND b.booking_date >= CURRENT_DATE;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 4. Get subscribers for a session on a given date (admin use)
CREATE OR REPLACE FUNCTION public.get_session_subscribers(
  p_session_id UUID,
  p_booking_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id',    p.id,
      'full_name',  p.full_name,
      'belt_level', p.belt_level,
      'avatar_url', p.avatar_url,
      'appeared',   EXISTS (
        SELECT 1 FROM public.attendance_log al
        WHERE al.user_id = p.id
          AND al.session_id = p_session_id
          AND al.checked_in_at::date = p_booking_date
      )
    )
    ORDER BY p.full_name ASC
  )
  INTO v_result
  FROM public.bookings b
  JOIN public.profiles p ON p.id = b.user_id
  WHERE b.session_id = p_session_id
    AND b.booking_date = p_booking_date;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 5. Log attendance for a session (admin marks a member as appeared)
CREATE OR REPLACE FUNCTION public.log_event_attendance(
  p_admin_id UUID,
  p_user_id UUID,
  p_session_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_existing UUID;
BEGIN
  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = p_admin_id;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Csak admin végezheti ezt a műveletet.');
  END IF;

  -- Prevent duplicate attendance for same session+day
  SELECT id INTO v_existing
    FROM public.attendance_log
    WHERE user_id = p_user_id
      AND session_id = p_session_id
      AND checked_in_at::date = CURRENT_DATE;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'A tag már megjelölt erre az edzésre.');
  END IF;

  INSERT INTO public.attendance_log (user_id, session_id)
    VALUES (p_user_id, p_session_id);

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 6. Allow admins to delete memberships via direct DELETE (add missing policy)
DROP POLICY IF EXISTS "Admins can delete memberships" ON public.memberships;
CREATE POLICY "Admins can delete memberships" ON public.memberships
  FOR DELETE TO authenticated USING (public.is_current_user_admin());

-- 7. Allow self-service booking cancellation via RPC (already handled by SECURITY DEFINER)
-- Ensure users can still view their bookings
DROP POLICY IF EXISTS "Users can view own bookings" ON public.bookings;
CREATE POLICY "Users can view own bookings" ON public.bookings
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_current_user_admin()
  );

-- END 006_subscriptions_and_qr_management.sql


-- BEGIN 007_member_details.sql

-- Migration 007: Birth date, belt rank (kyu/dan), belt exams, training camps,
--                membership fee paid, medical validity

-- 1. Add new columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS belt_rank TEXT,            -- e.g. '9.kyu', '1.dan'
  ADD COLUMN IF NOT EXISTS medical_validity DATE,     -- Sportorvosi érvényesség
  ADD COLUMN IF NOT EXISTS membership_fee_paid BOOLEAN NOT NULL DEFAULT FALSE; -- Éves tagsági díj

-- 2. Belt exams table (Öv vizsga dátumok)
CREATE TABLE IF NOT EXISTS public.belt_exams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exam_date     DATE NOT NULL,
  belt_rank     TEXT NOT NULL,  -- e.g. '9.kyu', '1.dan'
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 3. Training camps table (Edzőtábor dátumok)
CREATE TABLE IF NOT EXISTS public.training_camps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  camp_date     DATE NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 4. Enable RLS
ALTER TABLE public.belt_exams    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_camps ENABLE ROW LEVEL SECURITY;

-- 5. Belt exams policies – admins manage, users view own
CREATE POLICY "Users can view own belt exams" ON public.belt_exams
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_current_user_admin()
  );
CREATE POLICY "Admins can manage belt exams" ON public.belt_exams
  FOR ALL TO authenticated USING (public.is_current_user_admin());

-- 6. Training camps policies
CREATE POLICY "Users can view own training camps" ON public.training_camps
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_current_user_admin()
  );
CREATE POLICY "Admins can manage training camps" ON public.training_camps
  FOR ALL TO authenticated USING (public.is_current_user_admin());

-- 7. Allow users to update their own birth_date (public, not admin-only)
--    Admin-only fields (belt_rank, medical_validity, membership_fee_paid) are
--    protected by the existing "Admins can manage profiles" policy.
--    Users can already update their own profile via "Users can update own profile".

-- END 007_member_details.sql


-- BEGIN 008_fix_signup_trigger.sql

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

-- END 008_fix_signup_trigger.sql


-- BEGIN 009_admin_roles_audit_and_membership_rules.sql

-- Migration 009: Admin role split, audit logging, and membership lifecycle hardening

-- 1) Add admin role type and make valid_until optional for memberships.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_role') THEN
    CREATE TYPE public.admin_role AS ENUM ('full_admin', 'membership_admin');
  END IF;
END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_role public.admin_role;

ALTER TABLE public.memberships
  ALTER COLUMN valid_until DROP NOT NULL;

-- Backfill: existing admins become full admins.
UPDATE public.profiles
SET admin_role = 'full_admin'
WHERE is_admin = true AND admin_role IS NULL;

-- 2) Role helper functions.
CREATE OR REPLACE FUNCTION public.is_full_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        CASE
          WHEN p.admin_role = 'full_admin' THEN true
          WHEN p.admin_role IS NULL AND p.is_admin = true THEN true
          ELSE false
        END
      FROM public.profiles p
      WHERE p.id = auth.uid()
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_membership_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        CASE
          WHEN p.admin_role IN ('full_admin', 'membership_admin') THEN true
          WHEN p.admin_role IS NULL AND p.is_admin = true THEN true
          ELSE false
        END
      FROM public.profiles p
      WHERE p.id = auth.uid()
    ),
    false
  );
$$;

-- Keep legacy helper for backward compatibility.
CREATE OR REPLACE FUNCTION public.is_current_user_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.is_membership_admin();
$$;

-- 3) Audit table for admin actions.
CREATE TABLE IF NOT EXISTS public.admin_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  action_type TEXT NOT NULL,
  target_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_membership_id UUID REFERENCES public.memberships(id) ON DELETE SET NULL,
  target_attendance_id UUID REFERENCES public.attendance_log(id) ON DELETE SET NULL,
  membership_type TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_action_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view admin logs" ON public.admin_action_logs;
CREATE POLICY "Admins can view admin logs" ON public.admin_action_logs
  FOR SELECT TO authenticated USING (public.is_membership_admin());

DROP POLICY IF EXISTS "System can write admin logs" ON public.admin_action_logs;
CREATE POLICY "System can write admin logs" ON public.admin_action_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_membership_admin());

CREATE INDEX IF NOT EXISTS idx_admin_action_logs_created_at
  ON public.admin_action_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_action_logs_admin_created_at
  ON public.admin_action_logs (admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_action_logs_membership_type_created_at
  ON public.admin_action_logs (membership_type, created_at DESC);

CREATE OR REPLACE VIEW public.admin_action_monthly_summary AS
SELECT
  date_trunc('month', l.created_at)::date AS month_start,
  l.admin_id,
  p.full_name AS admin_name,
  l.action_type,
  COALESCE(l.membership_type, '-') AS membership_type,
  COUNT(*) AS action_count
FROM public.admin_action_logs l
JOIN public.profiles p ON p.id = l.admin_id
WHERE l.created_at >= date_trunc('month', now()) - INTERVAL '12 months'
GROUP BY 1, 2, 3, 4, 5
ORDER BY month_start DESC, admin_name, action_type;

-- 4) Generic audit helper.
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action_type TEXT,
  p_target_user_id UUID DEFAULT NULL,
  p_target_membership_id UUID DEFAULT NULL,
  p_target_attendance_id UUID DEFAULT NULL,
  p_membership_type TEXT DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_membership_admin() THEN
    RETURN;
  END IF;

  INSERT INTO public.admin_action_logs (
    admin_id,
    action_type,
    target_user_id,
    target_membership_id,
    target_attendance_id,
    membership_type,
    details
  )
  VALUES (
    v_actor,
    p_action_type,
    p_target_user_id,
    p_target_membership_id,
    p_target_attendance_id,
    p_membership_type,
    COALESCE(p_details, '{}'::jsonb)
  );
END;
$$;

-- 5) Membership lifecycle protection and audit via trigger.
CREATE OR REPLACE FUNCTION public.membership_lifecycle_guard_and_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions <= 0 THEN
      NEW.remaining_sessions := 0;
      NEW.status := 'expired';
    END IF;

    IF OLD.status = 'expired' AND NEW.status = 'active' AND NOT public.is_full_admin() THEN
      RAISE EXCEPTION 'Csak teljes admin aktiválhatja újra a lejárt bérletet.';
    END IF;

    IF NEW.total_sessions IS NOT NULL AND NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions > NEW.total_sessions THEN
      NEW.total_sessions := NEW.remaining_sessions;
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status OR OLD.remaining_sessions IS DISTINCT FROM NEW.remaining_sessions OR OLD.total_sessions IS DISTINCT FROM NEW.total_sessions THEN
      PERFORM public.log_admin_action(
        'membership_updated',
        NEW.user_id,
        NEW.id,
        NULL,
        NEW.type,
        jsonb_build_object(
          'old_status', OLD.status,
          'new_status', NEW.status,
          'old_remaining', OLD.remaining_sessions,
          'new_remaining', NEW.remaining_sessions,
          'old_total', OLD.total_sessions,
          'new_total', NEW.total_sessions,
          'actor_id', v_actor
        )
      );
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions <= 0 THEN
      NEW.remaining_sessions := 0;
      NEW.status := 'expired';
    END IF;

    PERFORM public.log_admin_action(
      'membership_created',
      NEW.user_id,
      NEW.id,
      NULL,
      NEW.type,
      jsonb_build_object(
        'total_sessions', NEW.total_sessions,
        'remaining_sessions', NEW.remaining_sessions,
        'status', NEW.status,
        'valid_until', NEW.valid_until
      )
    );

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.log_admin_action(
      'membership_deleted',
      OLD.user_id,
      OLD.id,
      NULL,
      OLD.type,
      jsonb_build_object(
        'status', OLD.status,
        'remaining_sessions', OLD.remaining_sessions,
        'total_sessions', OLD.total_sessions
      )
    );

    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS memberships_lifecycle_guard_and_audit_before ON public.memberships;
CREATE TRIGGER memberships_lifecycle_guard_and_audit_before
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.membership_lifecycle_guard_and_audit();

DROP TRIGGER IF EXISTS memberships_lifecycle_audit_after_insert ON public.memberships;
CREATE TRIGGER memberships_lifecycle_audit_after_insert
  AFTER INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.membership_lifecycle_guard_and_audit();

DROP TRIGGER IF EXISTS memberships_lifecycle_audit_after_delete ON public.memberships;
CREATE TRIGGER memberships_lifecycle_audit_after_delete
  AFTER DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.membership_lifecycle_guard_and_audit();

-- 6) Attendance function now enforces session selection and decrements membership atomically.
CREATE OR REPLACE FUNCTION public.log_event_attendance(
  p_admin_id UUID,
  p_user_id UUID,
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
  v_membership public.memberships%ROWTYPE;
  v_attendance_id UUID;
BEGIN
  IF NOT public.is_membership_admin() THEN
    RETURN jsonb_build_object('error', 'Csak admin végezheti ezt a műveletet.');
  END IF;

  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('error', 'A becsekkoláshoz kötelező edzést választani.');
  END IF;

  -- Prevent duplicate attendance for same session+day
  SELECT id INTO v_existing
  FROM public.attendance_log
  WHERE user_id = p_user_id
    AND session_id = p_session_id
    AND checked_in_at::date = CURRENT_DATE;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'A tag már megjelölt erre az edzésre.');
  END IF;

  SELECT * INTO v_membership
  FROM public.memberships m
  WHERE m.user_id = p_user_id
    AND m.status = 'active'
    AND COALESCE(m.remaining_sessions, 0) > 0
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Nincs aktív bérlet vagy elfogytak az alkalmak.');
  END IF;

  INSERT INTO public.attendance_log (user_id, session_id)
  VALUES (p_user_id, p_session_id)
  RETURNING id INTO v_attendance_id;

  UPDATE public.memberships
  SET remaining_sessions = GREATEST(0, remaining_sessions - 1),
      status = CASE WHEN GREATEST(0, remaining_sessions - 1) = 0 THEN 'expired'::membership_status ELSE status END,
      updated_at = now()
  WHERE id = v_membership.id;

  PERFORM public.log_admin_action(
    'attendance_logged',
    p_user_id,
    v_membership.id,
    v_attendance_id,
    v_membership.type,
    jsonb_build_object(
      'session_id', p_session_id,
      'remaining_before', v_membership.remaining_sessions,
      'remaining_after', GREATEST(0, v_membership.remaining_sessions - 1)
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'membership_id', v_membership.id,
    'remaining_sessions', GREATEST(0, v_membership.remaining_sessions - 1)
  );
END;
$$;

-- 7) Update RLS policies for role split.
DROP POLICY IF EXISTS "Admins can manage profiles" ON public.profiles;
CREATE POLICY "Full admins can manage profiles" ON public.profiles
  FOR ALL TO authenticated USING (public.is_full_admin());

DROP POLICY IF EXISTS "Users can view own memberships" ON public.memberships;
CREATE POLICY "Users can view own memberships" ON public.memberships
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_membership_admin()
  );

DROP POLICY IF EXISTS "Admins can manage memberships" ON public.memberships;
CREATE POLICY "Membership admins can manage memberships" ON public.memberships
  FOR ALL TO authenticated USING (public.is_membership_admin());

DROP POLICY IF EXISTS "Admins can manage training sessions" ON public.training_sessions;
CREATE POLICY "Full admins can manage training sessions" ON public.training_sessions
  FOR ALL TO authenticated USING (public.is_full_admin());

DROP POLICY IF EXISTS "Users can view own bookings" ON public.bookings;
CREATE POLICY "Users can view own bookings" ON public.bookings
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_membership_admin()
  );

DROP POLICY IF EXISTS "Users can view own attendance" ON public.attendance_log;
CREATE POLICY "Users can view own attendance" ON public.attendance_log
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_membership_admin()
  );

DROP POLICY IF EXISTS "Admins can create attendance records" ON public.attendance_log;
CREATE POLICY "Membership admins can create attendance records" ON public.attendance_log
  FOR INSERT TO authenticated WITH CHECK (public.is_membership_admin());

DROP POLICY IF EXISTS "Admins can delete memberships" ON public.memberships;
CREATE POLICY "Membership admins can delete memberships" ON public.memberships
  FOR DELETE TO authenticated USING (public.is_membership_admin());

-- 8) Member deletion audit and full-admin restriction.
CREATE OR REPLACE FUNCTION public.audit_profile_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_full_admin() THEN
    RAISE EXCEPTION 'Csak teljes admin törölhet tagot.';
  END IF;

  PERFORM public.log_admin_action(
    'member_deleted',
    OLD.id,
    NULL,
    NULL,
    NULL,
    jsonb_build_object('full_name', OLD.full_name)
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS profiles_audit_delete_before ON public.profiles;
CREATE TRIGGER profiles_audit_delete_before
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_profile_delete();

-- END 009_admin_roles_audit_and_membership_rules.sql


-- BEGIN 010_admin_role_management.sql

-- Migration 010: Full-admin managed admin roles and anti-escalation guard

-- Prevent regular users from granting themselves admin privileges via profile updates.
CREATE OR REPLACE FUNCTION public.guard_profile_admin_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_admin IS DISTINCT FROM OLD.is_admin
     OR NEW.admin_role IS DISTINCT FROM OLD.admin_role THEN
    IF NOT public.is_full_admin() THEN
      RAISE EXCEPTION 'Csak teljes admin módosíthat admin jogosultságot.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_admin_fields_before_update ON public.profiles;
CREATE TRIGGER profiles_guard_admin_fields_before_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_admin_fields();

-- Full-admin RPC to add/delete/modify admin role safely.
CREATE OR REPLACE FUNCTION public.set_profile_admin_role(
  p_target_user_id UUID,
  p_admin_role public.admin_role DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_role public.admin_role;
  v_old_is_admin BOOLEAN;
BEGIN
  IF NOT public.is_full_admin() THEN
    RETURN jsonb_build_object('error', 'Csak teljes admin módosíthat admin jogosultságot.');
  END IF;

  SELECT admin_role, is_admin
    INTO v_old_role, v_old_is_admin
  FROM public.profiles
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'A kiválasztott tag nem található.');
  END IF;

  UPDATE public.profiles
  SET admin_role = p_admin_role,
      is_admin = (p_admin_role IS NOT NULL),
      updated_at = now()
  WHERE id = p_target_user_id;

  PERFORM public.log_admin_action(
    'admin_role_changed',
    p_target_user_id,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'old_admin_role', v_old_role,
      'new_admin_role', p_admin_role,
      'old_is_admin', v_old_is_admin,
      'new_is_admin', (p_admin_role IS NOT NULL)
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_profile_admin_role(UUID, public.admin_role) TO authenticated;

-- END 010_admin_role_management.sql


-- BEGIN 011_training_session_locations.sql

-- Migration 011: Explicit training session locations for clearer weekly calendar display

ALTER TABLE public.training_sessions
  ADD COLUMN IF NOT EXISTS location TEXT;

UPDATE public.training_sessions
SET location = CASE
  WHEN instructor_name ILIKE '%Rácz%' THEN 'Senshi Usagi, Tabajd'
  WHEN instructor_name ILIKE '%Metzger%' THEN 'Dojo Metzger, Bicske'
  ELSE COALESCE(location, 'DHKSE Dojo')
END
WHERE location IS NULL OR btrim(location) = '';

-- END 011_training_session_locations.sql


-- BEGIN 012_no_membership_reactivation.sql

-- Migration 012: expired memberships stay historical and cannot be reactivated

CREATE OR REPLACE FUNCTION public.membership_lifecycle_guard_and_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions <= 0 THEN
      NEW.remaining_sessions := 0;
      NEW.status := 'expired';
    END IF;

    IF OLD.status = 'expired' AND NEW.status = 'active' THEN
      RAISE EXCEPTION 'Lejárt tagság nem aktiválható újra. Helyette új tagságot kell létrehozni.';
    END IF;

    IF OLD.status = 'expired' AND NEW.remaining_sessions > OLD.remaining_sessions THEN
      RAISE EXCEPTION 'Lejárt tagság alkalmai nem növelhetők. Helyette új tagságot kell létrehozni.';
    END IF;

    IF NEW.total_sessions IS NOT NULL AND NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions > NEW.total_sessions THEN
      NEW.total_sessions := NEW.remaining_sessions;
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status OR OLD.remaining_sessions IS DISTINCT FROM NEW.remaining_sessions OR OLD.total_sessions IS DISTINCT FROM NEW.total_sessions THEN
      PERFORM public.log_admin_action(
        'membership_updated',
        NEW.user_id,
        NEW.id,
        NULL,
        NEW.type,
        jsonb_build_object(
          'old_status', OLD.status,
          'new_status', NEW.status,
          'old_remaining', OLD.remaining_sessions,
          'new_remaining', NEW.remaining_sessions,
          'old_total', OLD.total_sessions,
          'new_total', NEW.total_sessions,
          'actor_id', v_actor
        )
      );
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions <= 0 THEN
      NEW.remaining_sessions := 0;
      NEW.status := 'expired';
    END IF;

    PERFORM public.log_admin_action(
      'membership_created',
      NEW.user_id,
      NEW.id,
      NULL,
      NEW.type,
      jsonb_build_object(
        'total_sessions', NEW.total_sessions,
        'remaining_sessions', NEW.remaining_sessions,
        'status', NEW.status,
        'valid_until', NEW.valid_until
      )
    );

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.log_admin_action(
      'membership_deleted',
      OLD.user_id,
      OLD.id,
      NULL,
      OLD.type,
      jsonb_build_object(
        'status', OLD.status,
        'remaining_sessions', OLD.remaining_sessions,
        'total_sessions', OLD.total_sessions
      )
    );

    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- END 012_no_membership_reactivation.sql


-- BEGIN 013_one_active_membership_per_user.sql

-- Migration 013: one active membership per member at a time

UPDATE public.memberships
SET status = 'expired',
    remaining_sessions = 0
WHERE status = 'active'
  AND COALESCE(remaining_sessions, 0) <= 0;

CREATE OR REPLACE FUNCTION public.membership_lifecycle_guard_and_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions <= 0 THEN
      NEW.remaining_sessions := 0;
      NEW.status := 'expired';
    END IF;

    IF OLD.status = 'expired' AND NEW.status = 'active' THEN
      RAISE EXCEPTION 'Lejárt tagság nem aktiválható újra. Helyette új tagságot kell létrehozni.';
    END IF;

    IF OLD.status = 'expired' AND NEW.remaining_sessions > OLD.remaining_sessions THEN
      RAISE EXCEPTION 'Lejárt tagság alkalmai nem növelhetők. Helyette új tagságot kell létrehozni.';
    END IF;

    IF NEW.status = 'active' AND EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.user_id = NEW.user_id
        AND m.status = 'active'
        AND m.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'Egy tagnak egyszerre csak egy aktív tagsága lehet.';
    END IF;

    IF NEW.total_sessions IS NOT NULL AND NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions > NEW.total_sessions THEN
      NEW.total_sessions := NEW.remaining_sessions;
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status OR OLD.remaining_sessions IS DISTINCT FROM NEW.remaining_sessions OR OLD.total_sessions IS DISTINCT FROM NEW.total_sessions THEN
      PERFORM public.log_admin_action(
        'membership_updated',
        NEW.user_id,
        NEW.id,
        NULL,
        NEW.type,
        jsonb_build_object(
          'old_status', OLD.status,
          'new_status', NEW.status,
          'old_remaining', OLD.remaining_sessions,
          'new_remaining', NEW.remaining_sessions,
          'old_total', OLD.total_sessions,
          'new_total', NEW.total_sessions,
          'actor_id', v_actor
        )
      );
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions <= 0 THEN
      NEW.remaining_sessions := 0;
      NEW.status := 'expired';
    END IF;

    IF NEW.status = 'active' AND EXISTS (
      SELECT 1
      FROM public.memberships m
      WHERE m.user_id = NEW.user_id
        AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Egy tagnak egyszerre csak egy aktív tagsága lehet.';
    END IF;

    PERFORM public.log_admin_action(
      'membership_created',
      NEW.user_id,
      NEW.id,
      NULL,
      NEW.type,
      jsonb_build_object(
        'total_sessions', NEW.total_sessions,
        'remaining_sessions', NEW.remaining_sessions,
        'status', NEW.status,
        'valid_until', NEW.valid_until
      )
    );

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.log_admin_action(
      'membership_deleted',
      OLD.user_id,
      OLD.id,
      NULL,
      OLD.type,
      jsonb_build_object(
        'status', OLD.status,
        'remaining_sessions', OLD.remaining_sessions,
        'total_sessions', OLD.total_sessions
      )
    );

    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_one_active_per_user
  ON public.memberships (user_id)
  WHERE status = 'active';

-- END 013_one_active_membership_per_user.sql


-- BEGIN 014_fix_membership_insert_trigger.sql

-- Migration 014: Fix membership INSERT trigger timing
--
-- Bug: migration 013 added a guard check (EXISTS for active memberships) to
-- the INSERT path of membership_lifecycle_guard_and_audit(), but the INSERT
-- trigger from migration 009 fires AFTER INSERT. At that point the new row
-- is already visible in the table, so the EXISTS check always finds it and
-- raises an exception — making it impossible to create any active membership.
--
-- Fix: replace the AFTER INSERT trigger with a BEFORE INSERT trigger so the
-- guard check runs before the row is committed, and the audit log call still
-- works because log_admin_action() is a separate function.

-- Drop the broken AFTER INSERT trigger
DROP TRIGGER IF EXISTS memberships_lifecycle_audit_after_insert ON public.memberships;

-- Create a BEFORE INSERT trigger instead
CREATE TRIGGER memberships_lifecycle_guard_before_insert
  BEFORE INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.membership_lifecycle_guard_and_audit();

-- END 014_fix_membership_insert_trigger.sql


-- BEGIN 015_fix_audit_log_fk_deferrable.sql

-- Migration 015: Make admin_action_logs FK deferrable
--
-- The BEFORE INSERT trigger on memberships calls log_admin_action() which
-- inserts into admin_action_logs with target_membership_id referencing the
-- not-yet-committed membership row. Making the FK deferrable (checked at
-- transaction commit instead of statement time) fixes this.

ALTER TABLE public.admin_action_logs
  DROP CONSTRAINT admin_action_logs_target_membership_id_fkey;

ALTER TABLE public.admin_action_logs
  ADD CONSTRAINT admin_action_logs_target_membership_id_fkey
  FOREIGN KEY (target_membership_id)
  REFERENCES public.memberships(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- END 015_fix_audit_log_fk_deferrable.sql


-- BEGIN 016_full_admin_delete_and_sales_view.sql

-- Migration 016: Only full admins can delete memberships.
-- The admin_action_monthly_summary view already includes all action types;
-- the frontend correctly filters to 'membership_created' for sales stats.
-- Deletion events remain in admin_action_logs for accountability.

-- 1) Restrict membership deletion to full admins only (was: any membership_admin).
DROP POLICY IF EXISTS "Membership admins can delete memberships" ON public.memberships;
DROP POLICY IF EXISTS "Admins can delete memberships" ON public.memberships;

CREATE POLICY "Full admins can delete memberships" ON public.memberships
  FOR DELETE TO authenticated USING (public.is_full_admin());

-- END 016_full_admin_delete_and_sales_view.sql


-- BEGIN 017_fix_membership_delete_audit_trigger.sql

-- Migration 017: Fix membership delete FK violation in audit log
--
-- Problem: Three duplicate triggers all fire on DELETE and call
-- log_admin_action(..., OLD.id, ...) — inserting a new admin_action_logs row
-- with target_membership_id = OLD.id in the same transaction as the DELETE.
-- The deferred FK check at transaction end fails because the membership is gone.
--
-- Fix: Drop all duplicate triggers, replace with a single clean one that passes
-- NULL for target_membership_id on DELETE (the ID is preserved in JSON details).

-- 1) Drop all three broken/duplicate triggers
DROP TRIGGER IF EXISTS memberships_lifecycle_audit_after_delete ON public.memberships;
DROP TRIGGER IF EXISTS memberships_lifecycle_guard_and_audit_before ON public.memberships;
DROP TRIGGER IF EXISTS memberships_lifecycle_guard_before_insert ON public.memberships;

-- 2) Create a single consolidated trigger function
CREATE OR REPLACE FUNCTION public.memberships_lifecycle_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  -- ── INSERT ───────────────────────────────────────────────────────────────
  IF TG_OP = 'INSERT' THEN
    -- Clamp remaining_sessions to 0 and mark expired if empty
    IF NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions <= 0 THEN
      NEW.remaining_sessions := 0;
      NEW.status := 'expired';
    END IF;

    -- Enforce one active membership per user
    IF NEW.status = 'active' AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = NEW.user_id AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Egy tagnak egyszerre csak egy aktív tagsága lehet.';
    END IF;

    PERFORM public.log_admin_action(
      'membership_created',
      NEW.user_id,
      NEW.id,   -- FK is safe here: row is being inserted, not deleted
      NULL,
      NEW.type,
      jsonb_build_object(
        'total_sessions', NEW.total_sessions,
        'remaining_sessions', NEW.remaining_sessions,
        'status', NEW.status,
        'valid_until', NEW.valid_until
      )
    );

    RETURN NEW;
  END IF;

  -- ── UPDATE ───────────────────────────────────────────────────────────────
  IF TG_OP = 'UPDATE' THEN
    IF NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions <= 0 THEN
      NEW.remaining_sessions := 0;
      NEW.status := 'expired';
    END IF;

    IF OLD.status = 'expired' AND NEW.status = 'active' THEN
      RAISE EXCEPTION 'Lejárt tagság nem aktiválható újra. Helyette új tagságot kell létrehozni.';
    END IF;

    IF OLD.status = 'expired' AND NEW.remaining_sessions > OLD.remaining_sessions THEN
      RAISE EXCEPTION 'Lejárt tagság alkalmai nem növelhetők. Helyette új tagságot kell létrehozni.';
    END IF;

    IF NEW.status = 'active' AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = NEW.user_id AND m.status = 'active' AND m.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'Egy tagnak egyszerre csak egy aktív tagsága lehet.';
    END IF;

    IF NEW.total_sessions IS NOT NULL AND NEW.remaining_sessions IS NOT NULL
       AND NEW.remaining_sessions > NEW.total_sessions THEN
      NEW.total_sessions := NEW.remaining_sessions;
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status
       OR OLD.remaining_sessions IS DISTINCT FROM NEW.remaining_sessions
       OR OLD.total_sessions IS DISTINCT FROM NEW.total_sessions THEN
      PERFORM public.log_admin_action(
        'membership_updated',
        NEW.user_id,
        NEW.id,
        NULL,
        NEW.type,
        jsonb_build_object(
          'old_status', OLD.status,
          'new_status', NEW.status,
          'old_remaining', OLD.remaining_sessions,
          'new_remaining', NEW.remaining_sessions,
          'old_total', OLD.total_sessions,
          'new_total', NEW.total_sessions,
          'actor_id', v_actor
        )
      );
    END IF;

    RETURN NEW;
  END IF;

  -- ── DELETE ───────────────────────────────────────────────────────────────
  IF TG_OP = 'DELETE' THEN
    -- IMPORTANT: pass NULL for target_user_id and target_membership_id on DELETE.
    -- During cascaded profile deletion, OLD.user_id may no longer be a valid
    -- profiles FK by commit time. Keep IDs in details JSON instead.
    PERFORM public.log_admin_action(
      'membership_deleted',
      NULL,
      NULL,   -- <-- NULL instead of OLD.id to avoid FK violation on commit
      NULL,
      OLD.type,
      jsonb_build_object(
        'deleted_user_id', OLD.user_id::text,
        'deleted_membership_id', OLD.id,
        'status', OLD.status,
        'remaining_sessions', OLD.remaining_sessions,
        'total_sessions', OLD.total_sessions,
        'actor_id', v_actor
      )
    );

    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 3) Register a single BEFORE trigger for INSERT/UPDATE (needs to return modified NEW)
CREATE TRIGGER memberships_lifecycle
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.memberships_lifecycle_fn();

-- END 017_fix_membership_delete_audit_trigger.sql


-- BEGIN 018_allow_force_attendance.sql

-- Allow force/duplicate attendance logging for the same member+session+day.
-- Adds an optional p_force parameter (default FALSE).
-- When p_force = TRUE, the duplicate-check is skipped so admins can
-- intentionally record a second appearance for the same session on the same day.

-- Drop old 3-param overload so PostgREST can resolve the function unambiguously
DROP FUNCTION IF EXISTS public.log_event_attendance(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.log_event_attendance(
  p_admin_id   UUID,
  p_user_id    UUID,
  p_session_id UUID,
  p_force      BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing    UUID;
  v_membership  public.memberships%ROWTYPE;
  v_attendance_id UUID;
BEGIN
  IF NOT public.is_membership_admin() THEN
    RETURN jsonb_build_object('error', 'Csak admin végezheti ezt a műveletet.');
  END IF;

  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('error', 'A becsekkoláshoz kötelező edzést választani.');
  END IF;

  -- Prevent duplicate attendance for same session+day (unless p_force = TRUE)
  IF NOT p_force THEN
    SELECT id INTO v_existing
    FROM public.attendance_log
    WHERE user_id    = p_user_id
      AND session_id = p_session_id
      AND checked_in_at::date = CURRENT_DATE;

    IF FOUND THEN
      RETURN jsonb_build_object('error', 'A tag már megjelölt erre az edzésre.');
    END IF;
  END IF;

  SELECT * INTO v_membership
  FROM public.memberships m
  WHERE m.user_id = p_user_id
    AND m.status  = 'active'
    AND COALESCE(m.remaining_sessions, 0) > 0
  ORDER BY m.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Nincs aktív bérlet vagy elfogytak az alkalmak.');
  END IF;

  INSERT INTO public.attendance_log (user_id, session_id)
  VALUES (p_user_id, p_session_id)
  RETURNING id INTO v_attendance_id;

  UPDATE public.memberships
  SET remaining_sessions = GREATEST(0, remaining_sessions - 1),
      status = CASE
        WHEN GREATEST(0, remaining_sessions - 1) = 0 THEN 'expired'::membership_status
        ELSE status
      END,
      updated_at = now()
  WHERE id = v_membership.id;

  PERFORM public.log_admin_action(
    'attendance_logged',
    p_user_id,
    v_membership.id,
    v_attendance_id,
    v_membership.type,
    jsonb_build_object(
      'session_id',       p_session_id,
      'forced',           p_force,
      'remaining_before', v_membership.remaining_sessions,
      'remaining_after',  GREATEST(0, v_membership.remaining_sessions - 1)
    )
  );

  RETURN jsonb_build_object(
    'success',            true,
    'membership_id',      v_membership.id,
    'remaining_sessions', GREATEST(0, v_membership.remaining_sessions - 1)
  );
END;
$$;

-- END 018_allow_force_attendance.sql


-- BEGIN 019_tag_admin_role.sql

-- Migration 019: Add tag_admin role for member detail management
--
-- tag_admin ("Tagkezelő") can:
--   • View the member list (all profiles)
--   • Edit member detail fields: belt_rank, medical_validity, membership_fee_paid, birth_date
--   • Manage belt exam records and training camp records
--
-- tag_admin CANNOT:
--   • QR check-in / attendance
--   • Create or manage memberships (bérlet)
--   • Access admin dashboard, audit logs, or session management
--   • Delete members or change admin roles

-- 1) Add the new enum value.
-- NOTE: This must be run in a separate transaction before the rest of the migration.
-- When applying via Supabase MCP, this was split into two migrations:
--   019a: tag_admin_enum_value
--   019b: tag_admin_functions_and_policies_v2
ALTER TYPE public.admin_role ADD VALUE IF NOT EXISTS 'tag_admin';

-- 2) Helper: is_tag_admin() — true for tag_admin or full_admin (can edit member details).
CREATE OR REPLACE FUNCTION public.is_tag_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        CASE
          WHEN p.admin_role IN ('full_admin', 'tag_admin') THEN true
          WHEN p.admin_role IS NULL AND p.is_admin = true THEN true
          ELSE false
        END
      FROM public.profiles p
      WHERE p.id = auth.uid()
    ),
    false
  );
$$;

-- 3) Helper: is_any_admin() — true for any admin role (can view member list).
CREATE OR REPLACE FUNCTION public.is_any_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT
        CASE
          WHEN p.admin_role IN ('full_admin', 'membership_admin', 'tag_admin') THEN true
          WHEN p.admin_role IS NULL AND p.is_admin = true THEN true
          ELSE false
        END
      FROM public.profiles p
      WHERE p.id = auth.uid()
    ),
    false
  );
$$;

-- 4) Allow tag_admin to UPDATE member detail columns on profiles.
--    (SELECT is already open to all authenticated users via "Profiles are viewable by authenticated users".)
--    (Full admin already has FOR ALL via "Full admins can manage profiles".)
CREATE POLICY "Tag admins can update member details" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_tag_admin())
  WITH CHECK (public.is_tag_admin());

-- 5) Update belt_exams policies to include tag_admin.
--    The existing "Admins can manage belt exams" uses is_current_user_admin() which maps to
--    is_membership_admin(). We need tag_admin access too.
DROP POLICY IF EXISTS "Admins can manage belt exams" ON public.belt_exams;
CREATE POLICY "Admins can manage belt exams" ON public.belt_exams
  FOR ALL TO authenticated USING (public.is_tag_admin());

DROP POLICY IF EXISTS "Users can view own belt exams" ON public.belt_exams;
CREATE POLICY "Users can view own belt exams" ON public.belt_exams
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_tag_admin()
  );

-- 6) Update training_camps policies to include tag_admin.
DROP POLICY IF EXISTS "Admins can manage training camps" ON public.training_camps;
CREATE POLICY "Admins can manage training camps" ON public.training_camps
  FOR ALL TO authenticated USING (public.is_tag_admin());

DROP POLICY IF EXISTS "Users can view own training camps" ON public.training_camps;
CREATE POLICY "Users can view own training camps" ON public.training_camps
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_tag_admin()
  );

-- 7) Allow tag_admin to write audit logs.
DROP POLICY IF EXISTS "System can write admin logs" ON public.admin_action_logs;
CREATE POLICY "System can write admin logs" ON public.admin_action_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_any_admin());

DROP POLICY IF EXISTS "Admins can view admin logs" ON public.admin_action_logs;
CREATE POLICY "Admins can view admin logs" ON public.admin_action_logs
  FOR SELECT TO authenticated USING (public.is_any_admin());

-- 8) Update log_admin_action to accept any admin.
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action_type TEXT,
  p_target_user_id UUID DEFAULT NULL,
  p_target_membership_id UUID DEFAULT NULL,
  p_target_attendance_id UUID DEFAULT NULL,
  p_membership_type TEXT DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_any_admin() THEN
    RETURN;
  END IF;

  INSERT INTO public.admin_action_logs (
    admin_id,
    action_type,
    target_user_id,
    target_membership_id,
    target_attendance_id,
    membership_type,
    details
  )
  VALUES (
    v_actor,
    p_action_type,
    p_target_user_id,
    p_target_membership_id,
    p_target_attendance_id,
    p_membership_type,
    COALESCE(p_details, '{}'::jsonb)
  );
END;
$$;

-- END 019_tag_admin_role.sql


-- BEGIN 020_profiles_email_and_soft_delete_columns.sql

-- Migration 020: Separate auth account data from profile details
-- Adds profile mirror fields for auth email and soft-delete lifecycle tracking.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Keep a local mirror of auth.users.email for admin UIs and reset operations.
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS DISTINCT FROM u.email;

CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles (email);

-- Ensure signup trigger populates email mirror and soft-delete defaults.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    full_name,
    avatar_url,
    birth_date,
    email,
    is_disabled,
    deleted_at
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url',
    NULLIF(NEW.raw_user_meta_data->>'birth_date', '')::DATE,
    NEW.email,
    FALSE,
    NULL
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        updated_at = now();

  RETURN NEW;
END;
$$;

-- Keep profiles.email synchronized when auth email changes.
CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET email = NEW.email,
      updated_at = now()
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_profile_email_from_auth_user();

-- END 020_profiles_email_and_soft_delete_columns.sql


-- BEGIN 021_admin_auth_email_management.sql

-- Migration 021: Full-admin RPC for auth email updates

CREATE OR REPLACE FUNCTION public.update_user_email_admin(
  p_target_user_id UUID,
  p_new_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_old_email TEXT;
  v_new_email TEXT;
BEGIN
  IF NOT public.is_full_admin() THEN
    RETURN jsonb_build_object('error', 'Csak teljes admin módosíthat bejelentkezesi email cimet.');
  END IF;

  IF p_target_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Hianyzik a cel felhasznalo azonositoja.');
  END IF;

  v_new_email := lower(trim(COALESCE(p_new_email, '')));
  IF v_new_email = '' THEN
    RETURN jsonb_build_object('error', 'Az email cim nem lehet ures.');
  END IF;

  IF v_actor = p_target_user_id THEN
    RETURN jsonb_build_object('error', 'Sajat fiok email cime itt nem modosithato.');
  END IF;

  SELECT u.email
    INTO v_old_email
  FROM auth.users u
  WHERE u.id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'A kivalsztott auth felhasznalo nem talalhato.');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id <> p_target_user_id
      AND lower(u.email) = v_new_email
  ) THEN
    RETURN jsonb_build_object('error', 'Ez az email cim mar foglalt.');
  END IF;

  UPDATE auth.users
  SET email = v_new_email,
      updated_at = now()
  WHERE id = p_target_user_id;

  UPDATE public.profiles
  SET email = v_new_email,
      updated_at = now()
  WHERE id = p_target_user_id;

  PERFORM public.log_admin_action(
    'user_email_changed',
    p_target_user_id,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'old_email', v_old_email,
      'new_email', v_new_email
    )
  );

  RETURN jsonb_build_object('success', true, 'email', v_new_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_user_email_admin(UUID, TEXT) TO authenticated;

-- END 021_admin_auth_email_management.sql


-- BEGIN 022_admin_user_delete_modes.sql

-- Migration 022: Full-admin hard and soft delete user flows

CREATE OR REPLACE FUNCTION public.admin_soft_delete_user(
  p_target_user_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF NOT public.is_full_admin() THEN
    RETURN jsonb_build_object('error', 'Csak teljes admin vegezheti ezt a muveletet.');
  END IF;

  IF p_target_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Hianyzik a cel felhasznalo azonositoja.');
  END IF;

  IF v_actor = p_target_user_id THEN
    RETURN jsonb_build_object('error', 'Sajat fiok nem inaktivalhato innen.');
  END IF;

  SELECT *
    INTO v_profile
  FROM public.profiles
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'A kivalasztott profil nem talalhato.');
  END IF;

  UPDATE public.profiles
  SET is_disabled = TRUE,
      deleted_at = COALESCE(deleted_at, now()),
      is_admin = FALSE,
      admin_role = NULL,
      updated_at = now()
  WHERE id = p_target_user_id;

  UPDATE auth.users
  SET banned_until = '2099-12-31 00:00:00+00'::timestamptz,
      updated_at = now()
  WHERE id = p_target_user_id;

  PERFORM public.log_admin_action(
    'user_soft_deleted',
    p_target_user_id,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'full_name', v_profile.full_name,
      'email', v_profile.email,
      'reason', NULLIF(trim(COALESCE(p_reason, '')), '')
    )
  );

  RETURN jsonb_build_object('success', true, 'mode', 'soft');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_hard_delete_user(
  p_target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF NOT public.is_full_admin() THEN
    RETURN jsonb_build_object('error', 'Csak teljes admin vegezheti ezt a muveletet.');
  END IF;

  IF p_target_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Hianyzik a cel felhasznalo azonositoja.');
  END IF;

  IF v_actor = p_target_user_id THEN
    RETURN jsonb_build_object('error', 'Sajat fiok nem torolheto innen.');
  END IF;

  SELECT *
    INTO v_profile
  FROM public.profiles
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'A kivalasztott profil nem talalhato.');
  END IF;

  -- Log the action FIRST (while the user still exists) to capture their details.
  -- Use NULL for target_user_id to avoid FK constraint issues with the user being deleted.
  PERFORM public.log_admin_action(
    'user_hard_deleted',
    NULL,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'full_name', v_profile.full_name,
      'email', v_profile.email,
      'deleted_user_id', p_target_user_id::text
    )
  );

  -- For hard delete, remove audit logs that reference this user to avoid FK constraint issues.
  -- Logs where this user was the admin_id
  DELETE FROM public.admin_action_logs
  WHERE admin_id = p_target_user_id;

  -- Logs where this user was the target
  UPDATE public.admin_action_logs
  SET target_user_id = NULL,
      details = COALESCE(details, '{}'::jsonb) || jsonb_build_object('deleted_target_user_id', p_target_user_id::text)
  WHERE target_user_id = p_target_user_id;

  DELETE FROM auth.users
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Az auth felhasznalo nem torolheto.');
  END IF;

  RETURN jsonb_build_object('success', true, 'mode', 'hard');
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_soft_delete_user(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hard_delete_user(UUID) TO authenticated;

-- END 022_admin_user_delete_modes.sql


-- BEGIN 023_fix_membership_delete_target_user_fk.sql

-- Migration 023: Avoid target_user_id FK violations during cascaded profile deletes.
--
-- When a profile is hard-deleted, memberships can be deleted by FK cascade.
-- The memberships DELETE trigger must not write OLD.user_id into
-- admin_action_logs.target_user_id, because that profile row may already be gone
-- by commit time. Keep the deleted user id in details JSON instead.

CREATE OR REPLACE FUNCTION public.memberships_lifecycle_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions <= 0 THEN
      NEW.remaining_sessions := 0;
      NEW.status := 'expired';
    END IF;

    IF NEW.status = 'active' AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = NEW.user_id AND m.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Egy tagnak egyszerre csak egy aktív tagsága lehet.';
    END IF;

    PERFORM public.log_admin_action(
      'membership_created',
      NEW.user_id,
      NEW.id,
      NULL,
      NEW.type,
      jsonb_build_object(
        'total_sessions', NEW.total_sessions,
        'remaining_sessions', NEW.remaining_sessions,
        'status', NEW.status,
        'valid_until', NEW.valid_until
      )
    );

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.remaining_sessions IS NOT NULL AND NEW.remaining_sessions <= 0 THEN
      NEW.remaining_sessions := 0;
      NEW.status := 'expired';
    END IF;

    IF OLD.status = 'expired' AND NEW.status = 'active' THEN
      RAISE EXCEPTION 'Lejárt tagság nem aktiválható újra. Helyette új tagságot kell létrehozni.';
    END IF;

    IF OLD.status = 'expired' AND NEW.remaining_sessions > OLD.remaining_sessions THEN
      RAISE EXCEPTION 'Lejárt tagság alkalmai nem növelhetők. Helyette új tagságot kell létrehozni.';
    END IF;

    IF NEW.status = 'active' AND EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.user_id = NEW.user_id AND m.status = 'active' AND m.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'Egy tagnak egyszerre csak egy aktív tagsága lehet.';
    END IF;

    IF NEW.total_sessions IS NOT NULL AND NEW.remaining_sessions IS NOT NULL
       AND NEW.remaining_sessions > NEW.total_sessions THEN
      NEW.total_sessions := NEW.remaining_sessions;
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status
       OR OLD.remaining_sessions IS DISTINCT FROM NEW.remaining_sessions
       OR OLD.total_sessions IS DISTINCT FROM NEW.total_sessions THEN
      PERFORM public.log_admin_action(
        'membership_updated',
        NEW.user_id,
        NEW.id,
        NULL,
        NEW.type,
        jsonb_build_object(
          'old_status', OLD.status,
          'new_status', NEW.status,
          'old_remaining', OLD.remaining_sessions,
          'new_remaining', NEW.remaining_sessions,
          'old_total', OLD.total_sessions,
          'new_total', NEW.total_sessions,
          'actor_id', v_actor
        )
      );
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.log_admin_action(
      'membership_deleted',
      NULL,
      NULL,
      NULL,
      OLD.type,
      jsonb_build_object(
        'deleted_user_id', OLD.user_id::text,
        'deleted_membership_id', OLD.id,
        'status', OLD.status,
        'remaining_sessions', OLD.remaining_sessions,
        'total_sessions', OLD.total_sessions,
        'actor_id', v_actor
      )
    );

    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- END 023_fix_membership_delete_target_user_fk.sql

