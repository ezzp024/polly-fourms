-- Quick Security Fix - Run in Supabase SQL Editor

-- Drop old reports policies and recreate properly
drop policy if exists "Authenticated create reports" on public.reports;
drop policy if exists "Admin read reports" on public.reports;
drop policy if exists "Admin update reports" on public.reports;

create policy "Reports insert for auth"
on public.reports for insert
to authenticated
with check (auth.uid() = reporter_user_id);

create policy "Reports read admin only"
on public.reports for select
to authenticated
using (public.is_admin());

create policy "Reports update admin only"
on public.reports for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Ensure posts policies are correct
drop policy if exists "Owner update posts" on public.posts;
drop policy if exists "Owner delete posts" on public.posts;

create policy "Owner can update own posts"
on public.posts for update
to authenticated
using (auth.uid() = author_user_id)
with check (auth.uid() = author_user_id);

create policy "Owner can delete own posts"  
on public.posts for delete
to authenticated
using (auth.uid() = author_user_id);

-- Comments policies
drop policy if exists "Authenticated insert comments" on public.comments;
drop policy if exists "Owner update comments" on public.comments;
drop policy if exists "Owner delete comments" on public.comments;

create policy "Authenticated can create comments"
on public.comments for insert
to authenticated
with check (auth.uid() = author_user_id);

create policy "Owner can update own comments"
on public.comments for update
to authenticated
using (auth.uid() = author_user_id)
with check (auth.uid() = author_user_id);

create policy "Owner can delete own comments"
on public.comments for delete
to authenticated
using (auth.uid() = author_user_id);

-- Refresh policies
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.reports enable row level security;

SELECT 'Security policies fixed!' as result;
