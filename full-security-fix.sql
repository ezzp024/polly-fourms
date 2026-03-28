-- COMPLETE SECURITY POLICY REPLACE
-- Run this in Supabase SQL Editor

-- Drop ALL posts policies and recreate
DROP POLICY IF EXISTS "Public read posts" ON posts;
DROP POLICY IF EXISTS "Public read all posts" ON posts;
DROP POLICY IF EXISTS "Authenticated create posts" ON posts;
DROP POLICY IF EXISTS "Owner update posts" ON posts;
DROP POLICY IF EXISTS "Owner delete posts" ON posts;
DROP POLICY IF EXISTS "Admin update posts" ON posts;
DROP POLICY IF EXISTS "Admin delete posts" ON posts;

-- Public can read non-hidden posts
CREATE POLICY "Public read posts" ON posts FOR SELECT 
TO anon, authenticated 
USING (is_hidden = false OR auth.uid() = author_user_id OR is_admin() = true);

-- Auth users can create posts
CREATE POLICY "Auth create posts" ON posts FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = author_user_id);

-- Owner or admin can update
CREATE POLICY "Owner admin update posts" ON posts FOR UPDATE 
TO authenticated 
USING (auth.uid() = author_user_id OR is_admin() = true) 
WITH CHECK (auth.uid() = author_user_id OR is_admin() = true);

-- Owner or admin can delete
CREATE POLICY "Owner admin delete posts" ON posts FOR DELETE 
TO authenticated 
USING (auth.uid() = author_user_id OR is_admin() = true);

-- Comments policies
DROP POLICY IF EXISTS "Public read comments" ON comments;
DROP POLICY IF EXISTS "Authenticated insert comments" ON comments;
DROP POLICY IF EXISTS "Owner update comments" ON comments;
DROP POLICY IF EXISTS "Owner delete comments" ON comments;

CREATE POLICY "Public read comments" ON comments FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Auth create comments" ON comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_user_id);

CREATE POLICY "Owner update comments" ON comments FOR UPDATE TO authenticated USING (auth.uid() = author_user_id) WITH CHECK (auth.uid() = author_user_id);

CREATE POLICY "Owner delete comments" ON comments FOR DELETE TO authenticated USING (auth.uid() = author_user_id);

-- Reports - admin only
DROP POLICY IF EXISTS "Authenticated create reports" ON reports;
DROP POLICY IF EXISTS "Admin read reports" ON reports;
DROP POLICY IF EXISTS "Admin update reports" ON reports;

CREATE POLICY "Auth create reports" ON reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_user_id);

CREATE POLICY "Admin read reports" ON reports FOR SELECT TO authenticated USING (is_admin() = true);

CREATE POLICY "Admin update reports" ON reports FOR UPDATE TO authenticated USING (is_admin() = true) WITH CHECK (is_admin() = true);

-- Bans - admin only
DROP POLICY IF EXISTS "Admin read bans" ON banned_users;
DROP POLICY IF EXISTS "Admin write bans" ON banned_users;

CREATE POLICY "Admin read bans" ON banned_users FOR SELECT TO authenticated USING (is_admin() = true);

CREATE POLICY "Admin write bans" ON banned_users FOR ALL TO authenticated USING (is_admin() = true) WITH CHECK (is_admin() = true);

SELECT 'All policies replaced!' as result;
