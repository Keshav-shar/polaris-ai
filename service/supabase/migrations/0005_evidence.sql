-- Every source the writer was shown for a node, with the query that found it and when (C79, C123).
create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  -- Order within the node's set, as retrieval ranked it.
  position int not null,
  url text not null check (char_length(url) <= 2048),
  title text not null,
  snippet text not null,
  credibility numeric not null check (credibility between 0 and 1),
  retrieval_query text not null,
  retrieved_at timestamptz not null
);

create index evidence_node_idx on public.evidence (node_id, position);
