CREATE TABLE public.member_record_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL CONSTRAINT member_record_requests_user_id_fkey REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('belt_exam', 'training_camp')),
  event_date DATE NOT NULL,
  belt_rank TEXT,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT member_record_requests_fields_check CHECK (
    (request_type = 'belt_exam' AND belt_rank IS NOT NULL AND description = '')
    OR (request_type = 'training_camp' AND belt_rank IS NULL)
  ),
  CONSTRAINT member_record_requests_review_check CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status <> 'pending' AND reviewed_at IS NOT NULL)
  )
);

ALTER TABLE public.member_record_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view own record requests" ON public.member_record_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_tag_admin());

CREATE POLICY "Members can submit own record requests" ON public.member_record_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );

CREATE INDEX idx_member_record_requests_pending
  ON public.member_record_requests (created_at)
  WHERE status = 'pending';

CREATE INDEX idx_member_record_requests_user_created
  ON public.member_record_requests (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.review_member_record_request(
  p_request_id UUID,
  p_approve BOOLEAN,
  p_review_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.member_record_requests%ROWTYPE;
  v_status TEXT;
BEGIN
  IF NOT public.is_tag_admin() THEN
    RAISE EXCEPTION 'Only member-detail admins can review record requests';
  END IF;
  IF p_approve IS NULL THEN
    RAISE EXCEPTION 'A review decision is required';
  END IF;

  SELECT * INTO v_request
  FROM public.member_record_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record request not found';
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Record request has already been reviewed';
  END IF;

  IF p_approve THEN
    IF v_request.request_type = 'belt_exam' THEN
      INSERT INTO public.belt_exams (user_id, exam_date, belt_rank)
      VALUES (v_request.user_id, v_request.event_date, v_request.belt_rank);
      v_status := 'approved';
    ELSE
      INSERT INTO public.training_camps (user_id, camp_date, description)
      VALUES (v_request.user_id, v_request.event_date, v_request.description);
      v_status := 'approved';
    END IF;
  ELSE
    v_status := 'rejected';
  END IF;

  UPDATE public.member_record_requests
  SET status = v_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = NULLIF(btrim(p_review_note), '')
  WHERE id = v_request.id;

  PERFORM public.log_admin_action(
    'member_record_request_' || v_status,
    v_request.user_id,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'request_id', v_request.id,
      'request_type', v_request.request_type,
      'event_date', v_request.event_date,
      'belt_rank', v_request.belt_rank
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_member_record_request(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_member_record_request(UUID, BOOLEAN, TEXT) TO authenticated;