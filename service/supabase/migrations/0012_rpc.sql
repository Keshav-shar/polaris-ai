-- RPC functions for every write PostgREST cannot do atomically (C107). Each is executable by service_role only:
-- functions are executable by PUBLIC by default and PostgREST exposes them, so every one is revoked explicitly.

-- Upserts a batch of node rows from their queue messages. A row only moves FORWARD (pending -> expanded ->
-- done|failed, C54), a null brief means "nothing new" and never blanks one, and the article columns are left to
-- the second pass. One statement, so a whole child set appears at once.
create function public.upsert_nodes(p_nodes jsonb)
returns void
language sql
set search_path = public, extensions
as $$
  insert into public.nodes as n (id, run_id, parent_id, path, topic, depth, brief, status)
  select r.id, r.run_id, r.parent_id, r.path::extensions.ltree, r.topic, r.depth, coalesce(r.brief, ''), r.status
  from jsonb_to_recordset(p_nodes) as r(
    id uuid, run_id uuid, parent_id uuid, path text, topic text, depth int, brief text, status text
  )
  on conflict (id) do update set
    topic = excluded.topic,
    depth = excluded.depth,
    path = excluded.path,
    -- The incoming brief is '' only when the message carried none (coalesced above): keep what is stored.
    brief = case when excluded.brief = '' then n.brief else excluded.brief end,
    status = case
      when (case n.status when 'pending' then 0 when 'expanded' then 1 else 2 end)
        >= (case excluded.status when 'pending' then 0 when 'expanded' then 1 else 2 end)
      then n.status
      else excluded.status
    end;
$$;

-- Replaces a node's evidence in one transaction, so a redelivered article that searched again leaves exactly
-- one set (C123).
create function public.replace_evidence(p_node_id uuid, p_rows jsonb)
returns void
language plpgsql
set search_path = public, extensions
as $$
begin
  delete from public.evidence where node_id = p_node_id;
  insert into public.evidence (node_id, position, url, title, snippet, credibility, retrieval_query, retrieved_at)
  select p_node_id, r.position, r.url, r.title, r.snippet, r.credibility, r.retrieval_query, r.retrieved_at
  from jsonb_to_recordset(p_rows) as r(
    position int, url text, title text, snippet text, credibility numeric, retrieval_query text,
    retrieved_at timestamptz
  );
end;
$$;

-- Upserts the node's article, resolving each citation url to that node's own evidence row (C78). A citation
-- whose url matches no evidence row is KEPT with a null evidence_id: the writer agent already restricts citations
-- to the evidence it was shown, so this only happens on a url spelling mismatch, and losing the citation would be
-- worse than losing its link.
create function public.save_article(
  p_node_id uuid,
  p_content_md text,
  p_citations jsonb,
  p_credibility_verified boolean
)
returns void
language sql
set search_path = public, extensions
as $$
  insert into public.articles as a (node_id, content_md, citations, credibility_verified, generated_at)
  values (
    p_node_id,
    p_content_md,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('url', c.item ->> 'url', 'claim', c.item ->> 'claim', 'evidence_id', e.id)
          order by c.ord
        )
        from jsonb_array_elements(p_citations) with ordinality as c(item, ord)
        left join lateral (
          select ev.id from public.evidence ev
          where ev.node_id = p_node_id and ev.url = c.item ->> 'url'
          order by ev.position
          limit 1
        ) e on true
      ),
      '[]'::jsonb
    ),
    p_credibility_verified,
    now()
  )
  on conflict (node_id) do update set
    content_md = excluded.content_md,
    citations = excluded.citations,
    credibility_verified = excluded.credibility_verified,
    generated_at = excluded.generated_at;
$$;

-- MAX_RUNS_PER_USER_PER_DAY in one statement: increments today's count only while it is under the limit.
-- Returns the new count, or -1 when the caller is at the limit. Admins are counted but never refused.
create function public.reserve_user_run(p_user_id uuid, p_limit int)
returns int
language plpgsql
set search_path = public, extensions
as $$
declare
  v_admin boolean;
  v_count int;
begin
  select role = 'admin' into v_admin from public.profiles where id = p_user_id;
  insert into public.usage_daily as u (user_id, day, runs_started)
  values (p_user_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set runs_started = u.runs_started + 1
    where coalesce(v_admin, false) or u.runs_started < p_limit
  returning u.runs_started into v_count;
  return coalesce(v_count, -1);
end;
$$;

-- MAX_STORED_RUNS_PER_USER: deletes the owner's oldest PRIVATE, finished runs beyond `p_keep`, cascading to their
-- nodes, articles and progress. A run still building, or one shared with others, is never pruned. Returns how
-- many were deleted.
create function public.prune_user_runs(p_owner_id uuid, p_keep int)
returns int
language plpgsql
set search_path = public, extensions
as $$
declare
  v_deleted int;
begin
  with stale as (
    select id from public.runs
    where owner_id = p_owner_id and visibility = 'private' and status in ('done', 'failed', 'halted')
    order by created_at desc
    offset greatest(p_keep, 0)
  )
  delete from public.runs r using stale where r.id = stale.id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- QUEUE_MODE=memory only: the queues die with the process, so a run that was still building when it stopped can
-- never finish. Marks every such run halted at startup, so the UI stops polling and MAX_CONCURRENT_RUNS frees.
create function public.halt_interrupted_runs(p_reason text)
returns int
language plpgsql
set search_path = public, extensions
as $$
declare
  v_halted int;
begin
  update public.runs set status = 'halted', halt_reason = p_reason
  where status in ('constructing', 'constructed');
  get diagnostics v_halted = row_count;
  return v_halted;
end;
$$;

revoke all on function public.upsert_nodes(jsonb) from public, anon, authenticated;
revoke all on function public.replace_evidence(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.save_article(uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.reserve_user_run(uuid, int) from public, anon, authenticated;
revoke all on function public.prune_user_runs(uuid, int) from public, anon, authenticated;
revoke all on function public.halt_interrupted_runs(text) from public, anon, authenticated;

grant execute on function public.upsert_nodes(jsonb) to service_role;
grant execute on function public.replace_evidence(uuid, jsonb) to service_role;
grant execute on function public.save_article(uuid, text, jsonb, boolean) to service_role;
grant execute on function public.reserve_user_run(uuid, int) to service_role;
grant execute on function public.prune_user_runs(uuid, int) to service_role;
grant execute on function public.halt_interrupted_runs(text) to service_role;
