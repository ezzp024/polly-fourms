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

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_name text not null check (char_length(author_name) between 2 and 24),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.posts enable row level security;
alter table public.comments enable row level security;

drop policy if exists "Public read posts" on public.posts;
drop policy if exists "Public create posts" on public.posts;
drop policy if exists "Public read comments" on public.comments;
drop policy if exists "Public create comments" on public.comments;

create policy "Public read posts"
on public.posts for select
to anon
using (true);

create policy "Public create posts"
on public.posts for insert
to anon
with check (true);

create policy "Public read comments"
on public.comments for select
to anon
using (true);

create policy "Public create comments"
on public.comments for insert
to anon
with check (true);
