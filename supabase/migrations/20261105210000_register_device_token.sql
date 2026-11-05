-- Register this device's push token to whoever is signed in now.
--
-- UNIQUE(expo_token) was meant to move a device's row to the next user
-- through the client's upsert, but RLS blocks it: the "users own their
-- tokens" policy hides the other user's row from ON CONFLICT DO UPDATE,
-- so B's upsert fails and the row stays on A. This function does the
-- upsert as owner, always with auth.uid(), so a device has one owner:
-- the account that registered it last.
--
-- Additive: old clients keep their direct upsert, which still works for
-- a token they already own.

CREATE FUNCTION public.register_device_token(p_expo_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'register_device_token needs a signed-in user' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.device_tokens (user_id, expo_token, platform, last_seen_at)
  VALUES (auth.uid(), p_expo_token, p_platform, now())
  ON CONFLICT (expo_token) DO UPDATE
    SET user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = excluded.last_seen_at;
END;
$$;

REVOKE ALL ON FUNCTION public.register_device_token(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_device_token(text, text) TO authenticated;
