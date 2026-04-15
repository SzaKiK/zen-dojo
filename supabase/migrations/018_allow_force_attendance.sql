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
