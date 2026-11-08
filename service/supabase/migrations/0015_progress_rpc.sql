-- Writes on node_progress and the insight daily cap that PostgREST cannot do atomically (C106, C139). Same rules
-- as 0012: search_path pinned, revoked from public/anon/authenticated, executable by service_role only.

-- read_at is set the FIRST time a learner opens the lesson and never moved afterwards.
create function public.mark_node_read(p_user_id uuid, p_node_id uuid, p_run_id uuid)
returns void
language sql
set search_path = public, extensions
as $$
  insert into public.node_progress as p (user_id, node_id, run_id, read_at, updated_at)
  values (p_user_id, p_node_id, p_run_id, now(), now())
  on conflict (user_id, node_id) do update set
    read_at = coalesce(p.read_at, excluded.read_at),
    updated_at = case when p.read_at is null then now() else p.updated_at end;
$$;

-- attempts + 1 and best = greatest(best, correct) in ONE statement, so two submissions racing cannot lose an
-- attempt or lower the best. Returns the row as stored.
create function public.record_quiz_attempt(
  p_user_id uuid, p_node_id uuid, p_run_id uuid, p_correct int, p_answers jsonb
)
returns table (read_at timestamptz, quiz_attempts int, quiz_best smallint)
language sql
set search_path = public, extensions
as $$
  insert into public.node_progress as p (user_id, node_id, run_id, quiz_attempts, quiz_best, last_answers, updated_at)
  values (p_user_id, p_node_id, p_run_id, 1, p_correct::smallint, p_answers, now())
  on conflict (user_id, node_id) do update set
    quiz_attempts = p.quiz_attempts + 1,
    quiz_best = greatest(coalesce(p.quiz_best, 0), excluded.quiz_best),
    last_answers = excluded.last_answers,
    updated_at = now()
  returning p.read_at, p.quiz_attempts, p.quiz_best;
$$;

-- INSIGHT.MAX_PER_USER_PER_DAY, on the same per-user daily row as reserve_user_run. Returns the new count, or -1
-- when the learner was already at the limit (and then counts nothing).
alter table public.usage_daily add column insights_generated int not null default 0;

create function public.reserve_user_insight(p_user_id uuid, p_limit int)
returns int
language plpgsql
set search_path = public, extensions
as $$
declare
  v_count int;
begin
  insert into public.usage_daily as u (user_id, day, insights_generated)
  values (p_user_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set insights_generated = u.insights_generated + 1
    where u.insights_generated < p_limit
  returning u.insights_generated into v_count;
  return coalesce(v_count, -1);
end;
$$;

revoke all on function public.mark_node_read(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_quiz_attempt(uuid, uuid, uuid, int, jsonb) from public, anon, authenticated;
revoke all on function public.reserve_user_insight(uuid, int) from public, anon, authenticated;

grant execute on function public.mark_node_read(uuid, uuid, uuid) to service_role;
grant execute on function public.record_quiz_attempt(uuid, uuid, uuid, int, jsonb) to service_role;
grant execute on function public.reserve_user_insight(uuid, int) to service_role;
