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
