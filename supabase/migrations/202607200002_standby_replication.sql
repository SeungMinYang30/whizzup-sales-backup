CREATE TABLE IF NOT EXISTS public.replication_sync_state (
  id integer PRIMARY KEY CHECK (id = 1),
  source_origin text NOT NULL DEFAULT '',
  source_created_at timestamptz,
  source_checksum text NOT NULL DEFAULT '',
  source_counts_json text NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'syncing', 'succeeded', 'failed')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  duration_ms integer,
  error_message text NOT NULL DEFAULT ''
);

ALTER TABLE public.replication_sync_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.replication_sync_state FROM anon, authenticated;

INSERT INTO public.vercel_schema_migrations (version)
VALUES ('202607200002_standby_replication')
ON CONFLICT (version) DO NOTHING;
