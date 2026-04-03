-- Migration 006: Subscriptions list, cancel booking, QR-based membership management

-- 1. Update book_training_session to accept an explicit booking date
CREATE OR REPLACE FUNCTION public.book_training_session(
  p_session_id UUID,
  p_user_id UUID,
  p_booking_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB AS $$
DECLARE
  v_session RECORD;
  v_existing RECORD;
BEGIN
  -- Check if already booked on that date
  SELECT id INTO v_existing
    FROM public.bookings
    WHERE user_id = p_user_id
      AND session_id = p_session_id
      AND booking_date = p_booking_date;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'Már foglaltál erre az edzésre.');
  END IF;

  -- Get session and check capacity
  SELECT id, capacity, current_bookings INTO v_session
    FROM public.training_sessions
    WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Az edzés nem található.');
  END IF;

  IF v_session.current_bookings >= v_session.capacity THEN
    RETURN jsonb_build_object('error', 'Az edzés betelt.');
  END IF;

  -- Create booking
  INSERT INTO public.bookings (user_id, session_id, booking_date)
    VALUES (p_user_id, p_session_id, p_booking_date);

  -- Increment current_bookings
  UPDATE public.training_sessions
    SET current_bookings = current_bookings + 1
    WHERE id = p_session_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 2. Cancel booking function (decrements current_bookings atomically)
CREATE OR REPLACE FUNCTION public.cancel_booking(
  p_session_id UUID,
  p_user_id UUID,
  p_booking_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB AS $$
DECLARE
  v_existing_id UUID;
BEGIN
  SELECT id INTO v_existing_id
    FROM public.bookings
    WHERE user_id = p_user_id
      AND session_id = p_session_id
      AND booking_date = p_booking_date;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Nincs ilyen foglalás.');
  END IF;

  DELETE FROM public.bookings WHERE id = v_existing_id;

  UPDATE public.training_sessions
    SET current_bookings = GREATEST(0, current_bookings - 1)
    WHERE id = p_session_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 3. Get all upcoming bookings for a user (with session details)
CREATE OR REPLACE FUNCTION public.get_user_bookings(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'booking_id',    b.id,
      'session_id',    b.session_id,
      'booking_date',  b.booking_date,
      'checked_in',    b.checked_in,
      'session_title', ts.title,
      'instructor',    ts.instructor_name,
      'start_time',    ts.start_time,
      'end_time',      ts.end_time,
      'day_of_week',   ts.day_of_week,
      'level',         ts.level
    )
    ORDER BY b.booking_date ASC
  )
  INTO v_result
  FROM public.bookings b
  JOIN public.training_sessions ts ON ts.id = b.session_id
  WHERE b.user_id = p_user_id
    AND b.booking_date >= CURRENT_DATE;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 4. Get subscribers for a session on a given date (admin use)
CREATE OR REPLACE FUNCTION public.get_session_subscribers(
  p_session_id UUID,
  p_booking_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id',    p.id,
      'full_name',  p.full_name,
      'belt_level', p.belt_level,
      'avatar_url', p.avatar_url,
      'appeared',   EXISTS (
        SELECT 1 FROM public.attendance_log al
        WHERE al.user_id = p.id
          AND al.session_id = p_session_id
          AND al.checked_in_at::date = p_booking_date
      )
    )
    ORDER BY p.full_name ASC
  )
  INTO v_result
  FROM public.bookings b
  JOIN public.profiles p ON p.id = b.user_id
  WHERE b.session_id = p_session_id
    AND b.booking_date = p_booking_date;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 5. Log attendance for a session (admin marks a member as appeared)
CREATE OR REPLACE FUNCTION public.log_event_attendance(
  p_admin_id UUID,
  p_user_id UUID,
  p_session_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_existing UUID;
BEGIN
  SELECT is_admin INTO v_is_admin FROM public.profiles WHERE id = p_admin_id;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('error', 'Csak admin végezheti ezt a műveletet.');
  END IF;

  -- Prevent duplicate attendance for same session+day
  SELECT id INTO v_existing
    FROM public.attendance_log
    WHERE user_id = p_user_id
      AND session_id = p_session_id
      AND checked_in_at::date = CURRENT_DATE;

  IF FOUND THEN
    RETURN jsonb_build_object('error', 'A tag már megjelölt erre az edzésre.');
  END IF;

  INSERT INTO public.attendance_log (user_id, session_id)
    VALUES (p_user_id, p_session_id);

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 6. Allow admins to delete memberships via direct DELETE (add missing policy)
DROP POLICY IF EXISTS "Admins can delete memberships" ON public.memberships;
CREATE POLICY "Admins can delete memberships" ON public.memberships
  FOR DELETE TO authenticated USING (public.is_current_user_admin());

-- 7. Allow self-service booking cancellation via RPC (already handled by SECURITY DEFINER)
-- Ensure users can still view their bookings
DROP POLICY IF EXISTS "Users can view own bookings" ON public.bookings;
CREATE POLICY "Users can view own bookings" ON public.bookings
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_current_user_admin()
  );
