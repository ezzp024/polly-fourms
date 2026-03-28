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
create unique index if not exists idx_profiles_display_name_lower_unique on public.profiles ((lower(display_name)));

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

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requester_name text not null check (char_length(requester_name) between 2 and 24),
  addressee_user_id uuid not null references auth.users(id) on delete cascade,
  addressee_name text not null check (char_length(addressee_name) between 2 and 24),
  status text not null default 'accepted' check (status in ('accepted')),
  created_at timestamptz not null default now(),
  check (requester_user_id <> addressee_user_id)
);

create unique index if not exists idx_friendships_pair_unique on public.friendships (
  least(requester_user_id::text, addressee_user_id::text),
  greatest(requester_user_id::text, addressee_user_id::text)
);

do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles','posts','comments','reports','banned_users','moderation_logs','friendships')
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

create table if not exists public.action_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  last_at timestamptz not null default now(),
  primary key (user_id, action)
);

create table if not exists public.blocked_link_domains (
  domain text primary key
);

insert into public.blocked_link_domains(domain) values
  ('localhost'),
  ('127.0.0.1'),
  ('0.0.0.0')
on conflict (domain) do nothing;

create index if not exists idx_posts_author_user_id on public.posts (author_user_id);
create index if not exists idx_comments_author_user_id on public.comments (author_user_id);
create index if not exists idx_reports_post_id on public.reports (post_id);
create index if not exists idx_banned_users_user_id_active on public.banned_users (user_id, active);
create index if not exists idx_banned_users_nickname_active on public.banned_users (nickname, active);
create index if not exists idx_friendships_requester on public.friendships (requester_user_id);
create index if not exists idx_friendships_addressee on public.friendships (addressee_user_id);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;
alter table public.banned_users enable row level security;
alter table public.moderation_logs enable row level security;
alter table public.friendships enable row level security;

create or replace function public.enforce_action_rate_limit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p_action text;
  p_min_seconds int;
  v_uid uuid;
  v_last timestamptz;
begin
  p_action := tg_argv[0];
  p_min_seconds := coalesce(tg_argv[1]::int, 5);

  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Login required';
  end if;

  select last_at into v_last
  from public.action_rate_limits
  where user_id = v_uid and action = p_action
  for update;

  if v_last is not null and extract(epoch from (now() - v_last)) < p_min_seconds then
    raise exception 'Rate limit exceeded for action %', p_action;
  end if;

  insert into public.action_rate_limits(user_id, action, last_at)
  values (v_uid, p_action, now())
  on conflict (user_id, action)
  do update set last_at = excluded.last_at;

  return new;
end;
$$;

revoke all on function public.enforce_action_rate_limit_trigger() from public;
grant execute on function public.enforce_action_rate_limit_trigger() to authenticated;

create or replace function public.validate_post_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_domain text;
begin
  if new.software_url is not null and length(trim(new.software_url)) > 0 then
    v_url := trim(new.software_url);
    if v_url !~* '^https://' then
      raise exception 'Only HTTPS links are allowed.';
    end if;

    v_domain := lower(split_part(replace(replace(v_url, 'https://', ''), 'http://', ''), '/', 1));
    if exists (select 1 from public.blocked_link_domains b where b.domain = v_domain) then
      raise exception 'Unsafe link domain is blocked.';
    end if;
  end if;

  if new.body ~* 'http://' then
    raise exception 'Only HTTPS links are allowed in post body.';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_profile_display_name_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trimmed text;
begin
  v_trimmed := trim(new.display_name);
  if v_trimmed is null or char_length(v_trimmed) < 2 then
    raise exception 'Display name must be at least 2 characters.';
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(p.display_name) = lower(v_trimmed)
      and p.user_id <> coalesce(new.user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'Display name is already in use.';
  end if;

  new.display_name := v_trimmed;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.enforce_post_owner_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Login required';
  end if;

  if public.is_admin() then
    return new;
  end if;

  if old.author_user_id is distinct from auth.uid() then
    raise exception 'Permission denied for this action.';
  end if;

  if new.author_user_id is distinct from old.author_user_id then
    raise exception 'Author identity cannot be changed.';
  end if;

  if new.author_name is distinct from old.author_name then
    raise exception 'Author name cannot be changed.';
  end if;

  if new.category is distinct from old.category then
    raise exception 'Category cannot be changed after publish.';
  end if;

  if new.is_pinned is distinct from old.is_pinned
     or new.is_sticky is distinct from old.is_sticky
     or new.is_hidden is distinct from old.is_hidden
     or new.is_locked is distinct from old.is_locked
     or new.is_solved is distinct from old.is_solved
     or coalesce(new.hidden_reason, '') is distinct from coalesce(old.hidden_reason, '') then
    raise exception 'Only admins can change moderation fields.';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_comment_owner_update_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Login required';
  end if;

  if public.is_admin() then
    return new;
  end if;

  if old.author_user_id is distinct from auth.uid() then
    raise exception 'Permission denied for this action.';
  end if;

  if new.post_id is distinct from old.post_id then
    raise exception 'Comment post cannot be changed.';
  end if;

  if new.author_user_id is distinct from old.author_user_id then
    raise exception 'Author identity cannot be changed.';
  end if;

  if new.author_name is distinct from old.author_name then
    raise exception 'Author name cannot be changed.';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'Created time cannot be changed.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_posts_rate_limit_insert on public.posts;
create trigger trg_posts_rate_limit_insert
before insert on public.posts
for each row execute function public.enforce_action_rate_limit_trigger('create_thread', '15');

drop trigger if exists trg_posts_updated_at on public.posts;
create trigger trg_posts_updated_at
before update on public.posts
for each row execute function public.set_row_updated_at();

drop trigger if exists trg_profiles_rules_insupd on public.profiles;
create trigger trg_profiles_rules_insupd
before insert or update on public.profiles
for each row execute function public.enforce_profile_display_name_rules();

drop trigger if exists trg_comments_rate_limit_insert on public.comments;
create trigger trg_comments_rate_limit_insert
before insert on public.comments
for each row execute function public.enforce_action_rate_limit_trigger('create_comment', '8');

drop trigger if exists trg_reports_rate_limit_insert on public.reports;
create trigger trg_reports_rate_limit_insert
before insert on public.reports
for each row execute function public.enforce_action_rate_limit_trigger('create_report', '20');

drop trigger if exists trg_posts_validate_links_insupd on public.posts;
create trigger trg_posts_validate_links_insupd
before insert or update on public.posts
for each row execute function public.validate_post_links();

drop trigger if exists trg_posts_owner_guard_update on public.posts;
create trigger trg_posts_owner_guard_update
before update on public.posts
for each row execute function public.enforce_post_owner_update_rules();

drop trigger if exists trg_comments_owner_guard_update on public.comments;
create trigger trg_comments_owner_guard_update
before update on public.comments
for each row execute function public.enforce_comment_owner_update_rules();

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

create policy "Owner update comments"
on public.comments for update
to authenticated
using (auth.uid() = author_user_id)
with check (auth.uid() = author_user_id);

create policy "Admin delete comments"
on public.comments for delete
to authenticated
using (public.is_admin());

create policy "Admin update comments"
on public.comments for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

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

create policy "Read own friendships"
on public.friendships for select
to authenticated
using (requester_user_id = auth.uid() or addressee_user_id = auth.uid() or public.is_admin());

create policy "Create own friendships"
on public.friendships for insert
to authenticated
with check (
  (requester_user_id = auth.uid() or addressee_user_id = auth.uid())
  and exists (
    select 1
    from public.profiles p1
    where p1.user_id = requester_user_id
      and p1.display_name = requester_name
  )
  and exists (
    select 1
    from public.profiles p2
    where p2.user_id = addressee_user_id
      and p2.display_name = addressee_name
  )
);

create policy "Delete own friendships"
on public.friendships for delete
to authenticated
using (requester_user_id = auth.uid() or addressee_user_id = auth.uid() or public.is_admin());
