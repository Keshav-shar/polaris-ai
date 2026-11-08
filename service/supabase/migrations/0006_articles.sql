-- One article per node. `citations` is [{ url, claim, evidence_id }]: evidence_id resolved from the node's own
-- evidence rows by `save_article` (C78), and the url kept so a later evidence replacement cannot orphan it.
create table public.articles (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null unique references public.nodes (id) on delete cascade,
  content_md text not null,
  citations jsonb not null default '[]'::jsonb check (jsonb_typeof(citations) = 'array'),
  -- The credibility gate passed AND the article cites at least one source (C118).
  credibility_verified boolean not null,
  generated_at timestamptz not null default now()
);
