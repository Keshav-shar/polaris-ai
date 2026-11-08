-- The writer's stored result for idempotency rule 2 on AWS (A14, A23): a 3-9 KB draft in the DynamoDB node item
-- would cost up to 9 WCU per write against 5 provisioned, so it lives here. Write-once: the first draft for a node
-- wins and every later delivery reads it back, so two deliveries can never store different articles or questions.
create table public.article_drafts (
  node_id uuid primary key references public.nodes (id) on delete cascade,
  draft jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.article_drafts enable row level security;
revoke all on public.article_drafts from anon, authenticated;

-- Insert if absent, then return what is stored - the new draft or the one that got there first.
create function public.put_article_draft(p_node_id uuid, p_draft jsonb)
returns jsonb
language plpgsql
set search_path = public, extensions
as $$
declare
  v_draft jsonb;
begin
  insert into public.article_drafts (node_id, draft) values (p_node_id, p_draft)
  on conflict (node_id) do nothing;
  select draft into v_draft from public.article_drafts where node_id = p_node_id;
  return v_draft;
end;
$$;

revoke all on function public.put_article_draft(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.put_article_draft(uuid, jsonb) to service_role;
