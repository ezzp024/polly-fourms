-- Add missing ban function
-- Run in Supabase SQL Editor

CREATE OR REPLACE FUNCTION public.is_nickname_banned(p_nickname text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.banned_users
    WHERE lower(nickname) = lower(p_nickname)
    AND active = true
  );
END;
$$;

SELECT 'Ban function added!' as result;
