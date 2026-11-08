-- One row per auth user: the FK target for ownership (C105). Deleting the auth user cascades to everything
-- they own.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 100),
  -- admin = exempt from the per-user daily cap, for the owner's own testing.
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

-- Runs as the table owner so the auth schema's insert can write here; search_path pinned to nothing, so every
-- name below is schema-qualified and cannot be hijacked.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'user_name'), 100)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Anyone who signed up before this migration ran.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;
