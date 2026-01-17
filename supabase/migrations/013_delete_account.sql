-- Migration: Add delete_own_account function
-- Allows users to delete their own account from the client side
-- Uses SECURITY DEFINER to run with elevated privileges

CREATE OR REPLACE FUNCTION delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id uuid;
BEGIN
  -- Get the current user's ID
  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Delete user data in order (respecting foreign keys)
  -- verse_collections will cascade from user_verses
  DELETE FROM public.verse_collections
  WHERE verse_id IN (SELECT id FROM public.user_verses WHERE user_id = current_user_id);

  DELETE FROM public.user_verses WHERE user_id = current_user_id;
  DELETE FROM public.user_collections WHERE user_id = current_user_id;
  DELETE FROM public.session_attempts WHERE user_id = current_user_id;
  DELETE FROM public.user_stats WHERE user_id = current_user_id;

  -- Finally delete the auth user
  DELETE FROM auth.users WHERE id = current_user_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION delete_own_account() TO authenticated;
