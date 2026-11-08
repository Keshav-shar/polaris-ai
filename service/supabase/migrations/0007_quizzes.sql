-- At most one quiz per node, and possibly none: every question must cite evidence (C74, C80). The shape is
-- validated with QuizOutput on read and write by the service.
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null unique references public.nodes (id) on delete cascade,
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  generated_at timestamptz not null default now()
);
