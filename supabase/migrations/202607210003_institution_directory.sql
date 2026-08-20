CREATE TABLE IF NOT EXISTS public.school_directory_credentials (
  id integer PRIMARY KEY CHECK (id = 1),
  encrypted_key text NOT NULL,
  iv text NOT NULL,
  key_last4 text NOT NULL,
  updated_by bigint REFERENCES public.members(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.official_school_cache (
  cache_key text PRIMARY KEY,
  query_name text NOT NULL,
  region text NOT NULL DEFAULT '',
  results_json text NOT NULL DEFAULT '[]',
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.institution_name_decisions (
  pair_key text PRIMARY KEY,
  left_key text NOT NULL,
  right_key text NOT NULL,
  left_organization text NOT NULL,
  right_organization text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('related', 'different')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS official_school_cache_fetched_idx
  ON public.official_school_cache (fetched_at);
CREATE INDEX IF NOT EXISTS institution_name_decisions_left_idx
  ON public.institution_name_decisions (left_key);
CREATE INDEX IF NOT EXISTS institution_name_decisions_right_idx
  ON public.institution_name_decisions (right_key);

ALTER TABLE public.school_directory_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_school_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institution_name_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.school_directory_credentials FROM anon, authenticated;
REVOKE ALL ON public.official_school_cache FROM anon, authenticated;
REVOKE ALL ON public.institution_name_decisions FROM anon, authenticated;

INSERT INTO public.vercel_schema_migrations (version)
VALUES ('202607210003_institution_directory')
ON CONFLICT (version) DO NOTHING;
