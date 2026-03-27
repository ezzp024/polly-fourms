create extension if not exists pgcrypto;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 3 and 4000),
  category text not null default 'discussion',
  software_url text,
  tags text[] not null default '{}',
  author_name text not null check (char_length(author_name) between 2 and 24),
  created_at timestamptz not null default now()
);

alter table public.posts add column if not exists is_pinned boolean not null default false;
alter table public.posts add column if not exists is_sticky boolean not null default false;
alter table public.posts add column if not exists is_hidden boolean not null default false;
alter table public.posts add column if not exists hidden_reason text;

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

alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;

drop policy if exists "Public read posts" on public.posts;
drop policy if exists "Public create posts" on public.posts;
drop policy if exists "Public update posts" on public.posts;
drop policy if exists "Public read comments" on public.comments;
drop policy if exists "Public create comments" on public.comments;
drop policy if exists "Public read reports" on public.reports;
drop policy if exists "Public create reports" on public.reports;
drop policy if exists "Public update reports" on public.reports;

create policy "Public read posts"
on public.posts for select
to anon
using (true);

create policy "Public create posts"
on public.posts for insert
to anon
with check (true);

create policy "Public update posts"
on public.posts for update
to anon
using (true)
with check (true);

create policy "Public read comments"
on public.comments for select
to anon
using (true);

create policy "Public create comments"
on public.comments for insert
to anon
with check (true);

create policy "Public read reports"
on public.reports for select
to anon
using (true);

create policy "Public create reports"
on public.reports for insert
to anon
with check (true);

create policy "Public update reports"
on public.reports for update
to anon
using (true)
with check (true);
