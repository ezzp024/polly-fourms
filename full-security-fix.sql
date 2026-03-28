-- COMPLETE SECURITY POLICY REPLACE
-- Run this in Supabase SQL Editor

-- Drop ALL posts policies and recreate
DROP POLICY IF EXISTS "Public read posts" ON posts;
DROP POLICY IF EXISTS "Public read all posts" ON posts;
DROP POLICY IF EXISTS "Authenticated create posts" ON posts;
DROP POLICY IF EXISTS "Auth create posts" ON posts;
DROP POLICY IF EXISTS "Owner update posts" ON posts;
DROP POLICY IF EXISTS "Owner delete posts" ON posts;
DROP POLICY IF EXISTS "Admin update posts" ON posts;
DROP POLICY IF EXISTS "Admin delete posts" ON posts;
DROP POLICY IF EXISTS "Owner admin update posts" ON posts;
DROP POLICY IF EXISTS "Owner admin delete posts" ON posts;

-- Public can read non-hidden posts
CREATE POLICY "Public read posts" ON posts FOR SELECT 
TO anon, authenticated 
USING (is_hidden = false OR auth.uid() = author_user_id OR public.is_admin() = true);

-- Auth users can create posts
CREATE POLICY "Auth create posts" ON posts FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = author_user_id);

-- Owner or admin can update
CREATE POLICY "Owner admin update posts" ON posts FOR UPDATE 
TO authenticated 
USING (auth.uid() = author_user_id OR public.is_admin() = true) 
WITH CHECK (auth.uid() = author_user_id OR public.is_admin() = true);

-- Owner or admin can delete
CREATE POLICY "Owner admin delete posts" ON posts FOR DELETE 
TO authenticated 
USING (auth.uid() = author_user_id OR public.is_admin() = true);

-- Comments policies
DROP POLICY IF EXISTS "Public read comments" ON comments;
DROP POLICY IF EXISTS "Authenticated insert comments" ON comments;
DROP POLICY IF EXISTS "Auth create comments" ON comments;
DROP POLICY IF EXISTS "Owner update comments" ON comments;
DROP POLICY IF EXISTS "Owner delete comments" ON comments;
DROP POLICY IF EXISTS "Owner can update own comments" ON comments;
DROP POLICY IF EXISTS "Owner can delete own comments" ON comments;
DROP POLICY IF EXISTS "Owner can update own posts" ON comments;
DROP POLICY IF EXISTS "Owner can delete own posts" ON comments;

CREATE POLICY "Public read comments" ON comments FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Auth create comments" ON comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_user_id);

CREATE POLICY "Owner update comments" ON comments FOR UPDATE TO authenticated USING (auth.uid() = author_user_id) WITH CHECK (auth.uid() = author_user_id);

CREATE POLICY "Owner delete comments" ON comments FOR DELETE TO authenticated USING (auth.uid() = author_user_id);

-- Reports - admin only
DROP POLICY IF EXISTS "Authenticated create reports" ON reports;
DROP POLICY IF EXISTS "Auth create reports" ON reports;
DROP POLICY IF EXISTS "Admin read reports" ON reports;
DROP POLICY IF EXISTS "Admin update reports" ON reports;
DROP POLICY IF EXISTS "Reports insert for auth" ON reports;
DROP POLICY IF EXISTS "Reports read admin only" ON reports;
DROP POLICY IF EXISTS "Reports update admin only" ON reports;

CREATE POLICY "Auth create reports" ON reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_user_id);

CREATE POLICY "Admin read reports" ON reports FOR SELECT TO authenticated USING (public.is_admin() = true);

CREATE POLICY "Admin update reports" ON reports FOR UPDATE TO authenticated USING (public.is_admin() = true) WITH CHECK (public.is_admin() = true);

-- Bans - admin only
DROP POLICY IF EXISTS "Admin read bans" ON banned_users;
DROP POLICY IF EXISTS "Admin write bans" ON banned_users;

CREATE POLICY "Admin read bans" ON banned_users FOR SELECT TO authenticated USING (public.is_admin() = true);

CREATE POLICY "Admin write bans" ON banned_users FOR ALL TO authenticated USING (public.is_admin() = true) WITH CHECK (public.is_admin() = true);

-- Friendships
CREATE TABLE IF NOT EXISTS friendships (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  requester_name text not null,
  addressee_user_id uuid not null references auth.users(id) on delete cascade,
  addressee_name text not null,
  status text not null default 'accepted',
  created_at timestamptz not null default now(),
  check (requester_user_id <> addressee_user_id)
);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own friendships" ON friendships;
DROP POLICY IF EXISTS "Create own friendships" ON friendships;
DROP POLICY IF EXISTS "Delete own friendships" ON friendships;

CREATE POLICY "Read own friendships"
ON friendships FOR SELECT
TO authenticated
USING (requester_user_id = auth.uid() OR addressee_user_id = auth.uid() OR public.is_admin() = true);

CREATE POLICY "Create own friendships"
ON friendships FOR INSERT
TO authenticated
WITH CHECK (requester_user_id = auth.uid() OR addressee_user_id = auth.uid());

CREATE POLICY "Delete own friendships"
ON friendships FOR DELETE
TO authenticated
USING (requester_user_id = auth.uid() OR addressee_user_id = auth.uid() OR public.is_admin() = true);

SELECT 'All policies replaced!' as result;
