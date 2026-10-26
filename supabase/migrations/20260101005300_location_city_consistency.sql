-- 20260101005300_location_city_consistency.sql
-- Bug: a member's profile can show "Faridabad" while their stored device coordinates (discovery_locations)
-- are somewhere else (for example the Mumbai area, ~1,131 km away). profiles.city and discovery_locations are two
-- separate stores and profiles.city can be written directly (saveProfile in onboarding / complete-profile), so
-- nothing kept them consistent. get_distance_to() and the feed trust the coordinates, so two accounts that both
-- say "Faridabad" were shown as ~1135 km apart.
--   1. One-time cleanup: drop stored coordinates that are more than 150 km from the member's profile city.
--      The member then falls back to their city centre until they tap "Use current location" again.
--   2. Trigger: whenever profiles.city changes, drop stored coordinates that no longer match the new city
--      (same 150 km tolerance as set_my_location_selection). Selections made through set_my_location_selection
--      are unaffected because that function already validates the coordinates against the chosen city.
BEGIN;

-- 1. One-time cleanup of existing inconsistent rows.
DELETE FROM public.discovery_locations l
USING public.profiles p, public.city_centroids c
WHERE p.user_id = l.user_id
  AND c.name_key = public.normalize_city_key(p.city)
  AND public.haversine_km(l.latitude, l.longitude, c.latitude, c.longitude) > 150;

-- 2. Keep coordinates consistent with the profile city from now on.
CREATE OR REPLACE FUNCTION public.drop_location_on_city_mismatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _c public.city_centroids;
BEGIN
  IF NEW.city IS NOT DISTINCT FROM OLD.city THEN RETURN NEW; END IF;
  SELECT * INTO _c FROM public.city_centroids WHERE name_key = public.normalize_city_key(NEW.city);
  IF _c.name_key IS NULL THEN
    -- Unknown / cleared city: stored coordinates can no longer be tied to it.
    DELETE FROM public.discovery_locations WHERE user_id = NEW.user_id;
  ELSE
    DELETE FROM public.discovery_locations l
    WHERE l.user_id = NEW.user_id
      AND public.haversine_km(l.latitude, l.longitude, _c.latitude, _c.longitude) > 150;
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.drop_location_on_city_mismatch() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS profiles_city_location_consistency ON public.profiles;
CREATE TRIGGER profiles_city_location_consistency
  AFTER UPDATE OF city ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.drop_location_on_city_mismatch();

COMMIT;