-- Per-user daily counters for the cost guards (C105): MAX_RUNS_PER_USER_PER_DAY is checked against
-- runs_started by reserve_user_run, which increments and checks in one statement.
create table public.usage_daily (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  runs_started int not null default 0,
  nodes_built int not null default 0,
  primary key (user_id, day)
);
