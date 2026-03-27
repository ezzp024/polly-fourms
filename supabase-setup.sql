create extension if not exists pgcrypto;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 3 and 4000),
  category text not null default 'discussion',
  software_url text,
  tags text[] not null default '{}',
  author_name text not null check (char_length(author_name) between 2 and 24),
  is_pinned boolean not null default false,
  is_sticky boolean not null default false,
  is_hidden boolean not null default false,
  hidden_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 2 and 24),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 500),
  reporter_name text not null check (char_length(reporter_name) between 2 and 24),
  status text not null default 'open',
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.banned_users (
  id uuid primary key default gen_random_uuid(),
  nickname text not null,
  reason text,
  banned_by text,
  active boolean not null default true,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_banned_users_nickname_active on public.banned_users (nickname, active);

alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;
alter table public.banned_users enable row level security;

drop policy if exists "Public read posts" on public.posts;
drop policy if exists "Public create posts" on public.posts;
drop policy if exists "Admin update posts" on public.posts;
drop policy if exists "Admin delete posts" on public.posts;

drop policy if exists "Public read comments" on public.comments;
drop policy if exists "Public create comments" on public.comments;
drop policy if exists "Admin delete comments" on public.comments;

drop policy if exists "Public create reports" on public.reports;
drop policy if exists "Admin read reports" on public.reports;
drop policy if exists "Admin update reports" on public.reports;

drop policy if exists "Admin read bans" on public.banned_users;
drop policy if exists "Admin write bans" on public.banned_users;

create policy "Public read posts"
on public.posts for select
to anon, authenticated
using (true);

create policy "Public create posts"
on public.posts for insert
to anon, authenticated
with check (true);

create policy "Admin update posts"
on public.posts for update
to authenticated
using ((auth.jwt() ->> 'email') = 'ezzp024@gmail.com')
with check ((auth.jwt() ->> 'email') = 'ezzp024@gmail.com');

create policy "Admin delete posts"
on public.posts for delete
to authenticated
using ((auth.jwt() ->> 'email') = 'ezzp024@gmail.com');

create policy "Public read comments"
on public.comments for select
to anon, authenticated
using (true);

create policy "Public create comments"
on public.comments for insert
to anon, authenticated
with check (true);

create policy "Admin delete comments"
on public.comments for delete
to authenticated
using ((auth.jwt() ->> 'email') = 'ezzp024@gmail.com');

create policy "Public create reports"
on public.reports for insert
to anon, authenticated
with check (true);

create policy "Admin read reports"
on public.reports for select
to authenticated
using ((auth.jwt() ->> 'email') = 'ezzp024@gmail.com');

create policy "Admin update reports"
on public.reports for update
to authenticated
using ((auth.jwt() ->> 'email') = 'ezzp024@gmail.com')
with check ((auth.jwt() ->> 'email') = 'ezzp024@gmail.com');

create policy "Admin read bans"
on public.banned_users for select
to authenticated
using ((auth.jwt() ->> 'email') = 'ezzp024@gmail.com');

create policy "Admin write bans"
on public.banned_users for all
to authenticated
using ((auth.jwt() ->> 'email') = 'ezzp024@gmail.com')
with check ((auth.jwt() ->> 'email') = 'ezzp024@gmail.com');
