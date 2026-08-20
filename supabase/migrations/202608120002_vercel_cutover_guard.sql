ALTER TABLE public.replication_sync_state
  ADD COLUMN IF NOT EXISTS operating_mode text NOT NULL DEFAULT 'replica';

ALTER TABLE public.replication_sync_state
  ADD COLUMN IF NOT EXISTS cutover_at timestamptz;

ALTER TABLE public.replication_sync_state
  ADD COLUMN IF NOT EXISTS cutover_by bigint;

INSERT INTO public.vercel_schema_migrations (version)
VALUES ('202608120002_vercel_cutover_guard')
ON CONFLICT (version) DO NOTHING;
