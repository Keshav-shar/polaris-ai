-- A learner's tags on one lesson (C138): a thumb plus a closed vocabulary, NO free-text column on purpose - the
-- rows are summarised into later prompts, and a closed vocabulary carries no instructions. One row per
-- (user, node), replaced on every save. The checks are generous safety nets; the real limits live in code.
create table public.lesson_feedback (
  user_id uuid not null references public.profiles (id) on delete cascade,
  node_id uuid not null references public.nodes (id) on delete cascade,
  run_id uuid not null references public.runs (id) on delete cascade,
  helpful boolean,
  tags text[] not null default '{}'
    check (
      cardinality(tags) <= 8
      and tags <@ array['too-basic', 'too-advanced', 'too-long', 'too-short', 'needs-examples', 'unclear',
                        'just-right']::text[]
    ),
  updated_at timestamptz not null default now(),
  primary key (user_id, node_id)
);

-- The insight job reads a learner's newest rows across every run.
create index lesson_feedback_user_updated_idx on public.lesson_feedback (user_id, updated_at desc);

-- Deny by default, as 0011 does for every other table.
alter table public.lesson_feedback enable row level security;
revoke all on public.lesson_feedback from anon, authenticated;
