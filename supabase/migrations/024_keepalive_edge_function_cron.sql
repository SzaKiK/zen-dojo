-- Migration 024: Minimal keepalive to prevent Supabase inactivity pausing.
-- This sends one very infrequent request to a no-op edge function.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.keepalive_edge_function_url()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT 'https://gcawwfiqfnuiwaylxskg.functions.supabase.co/keepalive';
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'keepalive-edge-function-weekly'
  ) THEN
    PERFORM cron.schedule(
      'keepalive-edge-function-weekly',
      '17 3 * * 0',
      $job$SELECT net.http_get(url := public.keepalive_edge_function_url());$job$
    );
  END IF;
END $$;