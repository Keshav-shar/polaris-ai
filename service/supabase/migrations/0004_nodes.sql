-- Tree structure. `path` is an ltree built from node ids (`n_<uuid without hyphens>`), never titles.
create table public.nodes (
  -- Deterministic UUIDv5 of (run, parent, normalized topic): the same id the in-flight state uses.
  id uuid primary key,
  run_id uuid not null references public.runs (id) on delete cascade,
  parent_id uuid references public.nodes (id) on delete cascade,
  path extensions.ltree not null,
  topic text not null check (char_length(topic) <= 1000),
  -- Written by the node's PARENT when the row is created (C99); '' for the root until its own call returns.
  brief text not null default '',
  depth int not null check (depth >= 0),
  -- Stored states only: `blocked` is derived by the read model for a halted run and never written (C54).
  status text not null check (status in ('pending', 'expanded', 'done', 'failed')),
  attempts int not null default 0,
  -- The ARTICLE's terminal state, which moves independently of `status`.
  article_status text check (article_status in ('done', 'failed')),
  article_failure_reason text check (char_length(article_failure_reason) <= 2000),
  -- Insertion order, which is the order siblings are shown in. created_at cannot give it: a whole child set is
  -- written in one statement and shares one now().
  seq bigint generated always as identity,
  created_at timestamptz not null default now(),
  unique (run_id, path)
);

create index nodes_run_seq_idx on public.nodes (run_id, seq);
create index nodes_parent_seq_idx on public.nodes (parent_id, seq);
create index nodes_path_gist_idx on public.nodes using gist (path);
