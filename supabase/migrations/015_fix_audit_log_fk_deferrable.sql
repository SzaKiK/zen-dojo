-- Migration 015: Make admin_action_logs FK deferrable
--
-- The BEFORE INSERT trigger on memberships calls log_admin_action() which
-- inserts into admin_action_logs with target_membership_id referencing the
-- not-yet-committed membership row. Making the FK deferrable (checked at
-- transaction commit instead of statement time) fixes this.

ALTER TABLE public.admin_action_logs
  DROP CONSTRAINT admin_action_logs_target_membership_id_fkey;

ALTER TABLE public.admin_action_logs
  ADD CONSTRAINT admin_action_logs_target_membership_id_fkey
  FOREIGN KEY (target_membership_id)
  REFERENCES public.memberships(id)
  ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;
