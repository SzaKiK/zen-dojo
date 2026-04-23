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
