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
