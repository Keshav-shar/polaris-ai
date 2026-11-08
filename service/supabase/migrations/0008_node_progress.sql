-- Per-user read state and quiz results (C106). Written from Phase 12.1 / C; created now with the rest of the
-- schema so the migration order stays the one data-model.md lists.
create table public.node_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  node_id uuid not null references public.nodes (id) on delete cascade,
  run_id uuid not null references public.runs (id) on delete cascade,
  read_at timestamptz,
  quiz_attempts int not null default 0,
  quiz_best smallint check (quiz_best >= 0),
  last_answers jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, node_id)
);

create index node_progress_user_run_idx on public.node_progress (user_id, run_id);
