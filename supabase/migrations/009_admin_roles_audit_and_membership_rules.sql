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