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
