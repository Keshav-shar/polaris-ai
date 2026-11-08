-- What Polaris has inferred about a learner (C139), one row per user, written only by the background refresh job
-- and read once at kickoff. `level` and `preferences` are closed vocabularies rendered into prompts by code;
-- `guidance` is model-written and always travels inside a data block.
create table public.learner_insights (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  level text not null check (level in ('introductory', 'standard', 'advanced')),
  preferences text[] not null default '{}'
    check (preferences <@ array['more-examples', 'shorter', 'more-depth', 'plainer-language']::text[]),
  guidance text not null default '' check (char_length(guidance) <= 1000),
  -- The newest feedback/quiz signal this insight was computed from; a later one makes the next refresh worth a call.
  source_through timestamptz not null,
  prompt_version text not null,
  updated_at timestamptz not null default now()
);

-- The quiz-progress half of the insight job's input: a learner's newest node_progress rows across every run.
create index node_progress_user_updated_idx on public.node_progress (user_id, updated_at desc);

alter table public.learner_insights enable row level security;
revoke all on public.learner_insights from anon, authenticated;
