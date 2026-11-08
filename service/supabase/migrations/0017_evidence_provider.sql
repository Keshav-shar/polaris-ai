-- Which search provider found each source (C146): the writer compares sources by kind, and a stored citation says
-- where it came from. Null on rows written before this migration.
alter table public.evidence
  add column provider text
  check (provider is null or provider in ('wikipedia', 'tavily', 'crossref', 'openalex', 'ieee', 'gdelt'));

-- replace_evidence (0012) re-created to store the provider. Same signature, so the existing grant to service_role
-- and the revoke from public / anon / authenticated carry over; they are re-stated below anyway.
create or replace function public.replace_evidence(p_node_id uuid, p_rows jsonb)
returns void
language plpgsql
set search_path = public, extensions
as $$
begin
  delete from public.evidence where node_id = p_node_id;
  insert into public.evidence (
    node_id, position, url, title, snippet, credibility, retrieval_query, retrieved_at, provider
  )
  select p_node_id, r.position, r.url, r.title, r.snippet, r.credibility, r.retrieval_query, r.retrieved_at, r.provider
  from jsonb_to_recordset(p_rows) as r(
    position int, url text, title text, snippet text, credibility numeric, retrieval_query text,
    retrieved_at timestamptz, provider text
  );
end;
$$;

revoke all on function public.replace_evidence(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_evidence(uuid, jsonb) to service_role;
