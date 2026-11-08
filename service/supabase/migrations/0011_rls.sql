-- Deny by default (C107): RLS on every table and NO policy for anon or authenticated, so a leaked anon key
-- reads nothing. Only the service talks to Postgres, with the service-role key, which bypasses RLS; ownership is
-- enforced in the use-cases. The grants are revoked as well, as a second wall.
alter table public.profiles enable row level security;
alter table public.runs enable row level security;
alter table public.nodes enable row level security;
alter table public.evidence enable row level security;
alter table public.articles enable row level security;
alter table public.quizzes enable row level security;
alter table public.node_progress enable row level security;
alter table public.usage_daily enable row level security;
alter table public.expansion_cache enable row level security;

revoke all on
  public.profiles, public.runs, public.nodes, public.evidence, public.articles, public.quizzes,
  public.node_progress, public.usage_daily, public.expansion_cache
from anon, authenticated;
