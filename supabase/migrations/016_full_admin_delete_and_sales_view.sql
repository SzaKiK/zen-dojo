-- Migration 016: Only full admins can delete memberships.
-- The admin_action_monthly_summary view already includes all action types;
-- the frontend correctly filters to 'membership_created' for sales stats.
-- Deletion events remain in admin_action_logs for accountability.

-- 1) Restrict membership deletion to full admins only (was: any membership_admin).
DROP POLICY IF EXISTS "Membership admins can delete memberships" ON public.memberships;
DROP POLICY IF EXISTS "Admins can delete memberships" ON public.memberships;

CREATE POLICY "Full admins can delete memberships" ON public.memberships
  FOR DELETE TO authenticated USING (public.is_full_admin());
