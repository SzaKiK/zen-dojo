-- Migration 011: Explicit training session locations for clearer weekly calendar display

ALTER TABLE public.training_sessions
  ADD COLUMN IF NOT EXISTS location TEXT;

UPDATE public.training_sessions
SET location = CASE
  WHEN instructor_name ILIKE '%Rácz%' THEN 'Senshi Usagi, Tabajd'
  WHEN instructor_name ILIKE '%Metzger%' THEN 'Dojo Metzger, Bicske'
  ELSE COALESCE(location, 'DHKSE Dojo')
END
WHERE location IS NULL OR btrim(location) = '';
