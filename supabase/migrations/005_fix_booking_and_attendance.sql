-- Fix: Allow regular users to book training sessions via a SECURITY DEFINER function.
-- This avoids giving non-admin users direct UPDATE access to training_sessions.

-- RPC function: book a training session (atomic)
CREATE OR REPLACE FUNCTION public.book_training_session(
  p_session_id UUID,
  p_user_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_session RECORD;
  v_existing RECORD;
BEGIN
  -- Check if already booked today
  SELECT id INTO v_existing
    FROM public.bookings
    WHERE user_id = p_user_id
      AND session_id = p_session_id
      AND booking_date = v_today;

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
    VALUES (p_user_id, p_session_id, v_today);

  -- Increment current_bookings
  UPDATE public.training_sessions
    SET current_bookings = current_bookings + 1
    WHERE id = p_session_id;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Also allow regular users to log their own attendance (for QR scan by admin or self-checkin)
-- The current policy only allows admin INSERT. Let's keep admin-only for attendance creation
-- since admins scan QR codes to log attendance.

-- Make sure training_sessions SELECT policy exists (from migration 001, not dropped in 003)
-- No action needed.
