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
    -- IMPORTANT: pass NULL for target_membership_id (not OLD.id) because the
    -- membership row is deleted in this same transaction. The deferred FK check
    -- would fail if we reference a row that no longer exists at commit time.
    -- The membership ID is preserved in the details JSON for audit purposes.
    PERFORM public.log_admin_action(
      'membership_deleted',
      OLD.user_id,
      NULL,   -- <-- NULL instead of OLD.id to avoid FK violation on commit
      NULL,
      OLD.type,
      jsonb_build_object(
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
