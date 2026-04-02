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
