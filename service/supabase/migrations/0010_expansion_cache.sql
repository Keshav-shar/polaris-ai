-- The cache ExpansionCachePort promises (C47). Key = expansionCacheKey (prompt version + model namespace +
-- position + normalized topic + ancestors). Holds model output for a topic, never a learner's raw request, so
-- it is safe to share across users.
create table public.expansion_cache (
  key text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);

create index expansion_cache_created_idx on public.expansion_cache (created_at);
