-- The durable run record, owned (C105). Created before `nodes`, its FK target.
create table public.runs (
  id uuid primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private', 'unlisted', 'public')),
  -- Provisional (cut from the request) until the root call names the canonical topic (C100).
  topic text not null check (char_length(topic) between 1 and 1000),
  -- The learner's raw prompt, for the owner only; never returned for someone else's run.
  request text not null check (char_length(request) <= 2000),
  max_depth int not null check (max_depth >= 1),
  status text not null check (status in ('constructing', 'constructed', 'done', 'failed', 'halted')),
  halt_reason text check (char_length(halt_reason) <= 2000),
  -- The run-state counters, copied at each terminal transition because those expire with DynamoDB (C107).
  stats jsonb,
  prompt_version text not null,
  -- Bumped on every update of the run row; the ?since= delta cursor arrives in Phase 10.11.
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index runs_owner_created_idx on public.runs (owner_id, created_at desc);
create index runs_public_created_idx on public.runs (created_at desc) where visibility = 'public';
-- countActive(): MAX_CONCURRENT_RUNS is a count over this partial index.
create index runs_constructing_idx on public.runs (id) where status = 'constructing';

create function public.touch_run()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end;
$$;

revoke all on function public.touch_run() from public, anon, authenticated;

create trigger runs_touch
  before update on public.runs
  for each row execute function public.touch_run();
