create extension if not exists pgcrypto;

-- Admin email configured for this project.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (auth.jwt() ->> 'email') = 'ezzp024@gmail.com';
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null unique check (char_length(display_name) between 2 and 24),
  bio text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists bio text default '';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
create unique index if not exists idx_profiles_display_name_unique on public.profiles (display_name);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 3 and 4000),
  category text not null default 'discussion',
  software_url text,
  tags text[] not null default '{}',
  author_name text not null check (char_length(author_name) between 2 and 24),
  author_user_id uuid references auth.users(id) on delete set null,
  is_pinned boolean not null default false,
  is_sticky boolean not null default false,
  is_hidden boolean not null default false,
  is_locked boolean not null default false,
  is_solved boolean not null default false,
  hidden_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.posts add column if not exists author_user_id uuid references auth.users(id) on delete set null;
alter table public.posts add column if not exists is_pinned boolean not null default false;
alter table public.posts add column if not exists is_sticky boolean not null default false;
alter table public.posts add column if not exists is_hidden boolean not null default false;
alter table public.posts add column if not exists is_locked boolean not null default false;
alter table public.posts add column if not exists is_solved boolean not null default false;
alter table public.posts add column if not exists hidden_reason text;
alter table public.posts add column if not exists updated_at timestamptz not null default now();

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 2 and 24),
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.comments add column if not exists author_user_id uuid references auth.users(id) on delete set null;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  reporter_name text not null check (char_length(reporter_name) between 2 and 24),
  reporter_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'open',
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.reports add column if not exists reporter_user_id uuid references auth.users(id) on delete set null;

create table if not exists public.banned_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  nickname text,
  reason text,
  banned_by text,
  active boolean not null default true,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.banned_users add column if not exists user_id uuid references auth.users(id) on delete cascade;

do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','posts','comments','reports','banned_users','moderation_logs')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create table if not exists public.moderation_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  target_type text not null,
  target_id text,
  actor_email text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_posts_author_user_id on public.posts (author_user_id);
create index if not exists idx_comments_author_user_id on public.comments (author_user_id);
create index if not exists idx_reports_post_id on public.reports (post_id);
create index if not exists idx_banned_users_user_id_active on public.banned_users (user_id, active);
create index if not exists idx_banned_users_nickname_active on public.banned_users (nickname, active);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;
alter table public.banned_users enable row level security;
alter table public.moderation_logs enable row level security;

create policy "Public read profiles"
on public.profiles for select
to anon, authenticated
using (true);

create policy "Self create profile"
on public.profiles for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Self update profile"
on public.profiles for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Admin update any profile"
on public.profiles for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Public read posts"
on public.posts for select
to anon, authenticated
using ((not is_hidden) or public.is_admin());

create policy "Authenticated create posts"
on public.posts for insert
to authenticated
with check (auth.uid() = author_user_id and exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.display_name = author_name));

create policy "Owner update posts"
on public.posts for update
to authenticated
using (auth.uid() = author_user_id)
with check (auth.uid() = author_user_id);

create policy "Owner delete posts"
on public.posts for delete
to authenticated
using (auth.uid() = author_user_id);

create policy "Admin update posts"
on public.posts for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admin delete posts"
on public.posts for delete
to authenticated
using (public.is_admin());

create policy "Public read comments"
on public.comments for select
to anon, authenticated
using (true);

create policy "Authenticated create comments"
on public.comments for insert
to authenticated
with check (
  auth.uid() = author_user_id
  and exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.display_name = author_name)
  and exists (select 1 from public.posts po where po.id = post_id and (not po.is_locked or public.is_admin()))
);

create policy "Owner delete comments"
on public.comments for delete
to authenticated
using (auth.uid() = author_user_id);

create policy "Admin delete comments"
on public.comments for delete
to authenticated
using (public.is_admin());

create policy "Authenticated create reports"
on public.reports for insert
to authenticated
with check (auth.uid() = reporter_user_id);

create policy "Admin read reports"
on public.reports for select
to authenticated
using (public.is_admin());

create policy "Admin update reports"
on public.reports for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admin read bans"
on public.banned_users for select
to authenticated
using (public.is_admin());

create policy "Admin write bans"
on public.banned_users for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admin read moderation logs"
on public.moderation_logs for select
to authenticated
using (public.is_admin());

create policy "Admin write moderation logs"
on public.moderation_logs for insert
to authenticated
with check (public.is_admin());
