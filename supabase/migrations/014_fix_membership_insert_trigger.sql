-- Migration 014: Fix membership INSERT trigger timing
--
-- Bug: migration 013 added a guard check (EXISTS for active memberships) to
-- the INSERT path of membership_lifecycle_guard_and_audit(), but the INSERT
-- trigger from migration 009 fires AFTER INSERT. At that point the new row
-- is already visible in the table, so the EXISTS check always finds it and
-- raises an exception — making it impossible to create any active membership.
--
-- Fix: replace the AFTER INSERT trigger with a BEFORE INSERT trigger so the
-- guard check runs before the row is committed, and the audit log call still
-- works because log_admin_action() is a separate function.

-- Drop the broken AFTER INSERT trigger
DROP TRIGGER IF EXISTS memberships_lifecycle_audit_after_insert ON public.memberships;

-- Create a BEFORE INSERT trigger instead
CREATE TRIGGER memberships_lifecycle_guard_before_insert
  BEFORE INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.membership_lifecycle_guard_and_audit();
