-- Migration 007: Birth date, belt rank (kyu/dan), belt exams, training camps,
--                membership fee paid, medical validity

-- 1. Add new columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS birth_date DATE,
  ADD COLUMN IF NOT EXISTS belt_rank TEXT,            -- e.g. '9.kyu', '1.dan'
  ADD COLUMN IF NOT EXISTS medical_validity DATE,     -- Sportorvosi érvényesség
  ADD COLUMN IF NOT EXISTS membership_fee_paid BOOLEAN NOT NULL DEFAULT FALSE; -- Éves tagsági díj

-- 2. Belt exams table (Öv vizsga dátumok)
CREATE TABLE IF NOT EXISTS public.belt_exams (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exam_date     DATE NOT NULL,
  belt_rank     TEXT NOT NULL,  -- e.g. '9.kyu', '1.dan'
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 3. Training camps table (Edzőtábor dátumok)
CREATE TABLE IF NOT EXISTS public.training_camps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  camp_date     DATE NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 4. Enable RLS
ALTER TABLE public.belt_exams    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_camps ENABLE ROW LEVEL SECURITY;

-- 5. Belt exams policies – admins manage, users view own
CREATE POLICY "Users can view own belt exams" ON public.belt_exams
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_current_user_admin()
  );
CREATE POLICY "Admins can manage belt exams" ON public.belt_exams
  FOR ALL TO authenticated USING (public.is_current_user_admin());

-- 6. Training camps policies
CREATE POLICY "Users can view own training camps" ON public.training_camps
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_current_user_admin()
  );
CREATE POLICY "Admins can manage training camps" ON public.training_camps
  FOR ALL TO authenticated USING (public.is_current_user_admin());

-- 7. Allow users to update their own birth_date (public, not admin-only)
--    Admin-only fields (belt_rank, medical_validity, membership_fee_paid) are
--    protected by the existing "Admins can manage profiles" policy.
--    Users can already update their own profile via "Users can update own profile".
