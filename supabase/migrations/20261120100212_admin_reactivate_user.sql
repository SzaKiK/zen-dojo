CREATE OR REPLACE FUNCTION public.admin_reactivate_user(
  p_target_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF NOT public.is_full_admin() THEN
    RETURN jsonb_build_object('error', 'Csak teljes admin aktiválhat újra felhasználót.');
  END IF;

  IF p_target_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Hiányzik a felhasználó azonosítója.');
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'A kiválasztott profil nem található.');
  END IF;

  IF NOT v_profile.is_disabled AND v_profile.deleted_at IS NULL THEN
    RETURN jsonb_build_object('error', 'A felhasználói fiók már aktív.');
  END IF;

  UPDATE public.profiles
  SET is_disabled = FALSE,
      deleted_at = NULL,
      updated_at = now()
  WHERE id = p_target_user_id;

  UPDATE auth.users
  SET banned_until = NULL,
      updated_at = now()
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The auth user could not be reactivated';
  END IF;

  PERFORM public.log_admin_action(
    'user_reactivated',
    p_target_user_id,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'full_name', v_profile.full_name,
      'email', v_profile.email,
      'previous_deleted_at', v_profile.deleted_at,
      'reactivated_by', v_actor
    )
  );

  RETURN jsonb_build_object('success', true, 'mode', 'reactivated');
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reactivate_user(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_user(UUID) TO authenticated;