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
