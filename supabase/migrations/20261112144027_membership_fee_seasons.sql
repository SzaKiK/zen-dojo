CREATE TABLE public.membership_fee_seasons (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  season_start_year SMALLINT NOT NULL CHECK (season_start_year BETWEEN 2000 AND 2200),
  paid BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season_start_year)
);

ALTER TABLE public.membership_fee_seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view own membership fee seasons" ON public.membership_fee_seasons
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_tag_admin());

CREATE INDEX idx_membership_fee_seasons_user
  ON public.membership_fee_seasons (user_id, season_start_year DESC);

INSERT INTO public.membership_fee_seasons (user_id, season_start_year, paid)
SELECT
  id,
  (CASE
    WHEN EXTRACT(MONTH FROM current_date) >= 9 THEN EXTRACT(YEAR FROM current_date)::INTEGER
    ELSE EXTRACT(YEAR FROM current_date)::INTEGER - 1
  END)::SMALLINT,
  true
FROM public.profiles
WHERE membership_fee_paid = true
ON CONFLICT (user_id, season_start_year) DO NOTHING;

COMMENT ON COLUMN public.profiles.membership_fee_paid IS
  'Legacy calendar-year fee flag. Use membership_fee_seasons for current data.';

CREATE OR REPLACE FUNCTION public.set_membership_fee_season(
  p_user_id UUID,
  p_season_start_year SMALLINT,
  p_paid BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_season_start INTEGER;
BEGIN
  IF NOT public.is_tag_admin() THEN
    RAISE EXCEPTION 'Only member-detail admins can update membership fee seasons';
  END IF;
  IF p_user_id IS NULL OR p_paid IS NULL THEN
    RAISE EXCEPTION 'Member and payment status are required';
  END IF;

  v_current_season_start := CASE
    WHEN EXTRACT(MONTH FROM current_date) >= 9 THEN EXTRACT(YEAR FROM current_date)::INTEGER
    ELSE EXTRACT(YEAR FROM current_date)::INTEGER - 1
  END;

  IF p_season_start_year NOT BETWEEN v_current_season_start - 1 AND v_current_season_start + 1 THEN
    RAISE EXCEPTION 'Only the previous, current, and next season can be updated';
  END IF;

  INSERT INTO public.membership_fee_seasons (user_id, season_start_year, paid, updated_by, updated_at)
  VALUES (p_user_id, p_season_start_year, p_paid, auth.uid(), now())
  ON CONFLICT (user_id, season_start_year) DO UPDATE
  SET paid = EXCLUDED.paid,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at;

  PERFORM public.log_admin_action(
    'membership_fee_season_updated',
    p_user_id,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'season', p_season_start_year::TEXT || '/' || (p_season_start_year + 1)::TEXT,
      'paid', p_paid
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_membership_fee_season(UUID, SMALLINT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_membership_fee_season(UUID, SMALLINT, BOOLEAN) TO authenticated;