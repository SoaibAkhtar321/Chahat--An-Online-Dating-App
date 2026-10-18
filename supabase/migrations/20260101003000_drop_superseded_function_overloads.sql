-- 20260101003000_drop_superseded_function_overloads.sql
-- Defect: 20260101002800 changed the argument lists of get_discovery_feed_page (+ _min_radius_km)
-- and get_match_messages (+ _limit) via CREATE OR REPLACE. A changed argument list creates a NEW
-- overload, so the older functions stayed alongside the new ones. Calls that omit the new defaulted
-- argument then match both candidates and fail with "function ... is not unique"
-- (this also breaks PostgREST RPC resolution).
-- Fix (forward-only): drop the superseded overloads. The new functions keep their grants
-- (authenticated/service_role only; anon and PUBLIC revoked) and default the added argument.
DROP FUNCTION IF EXISTS public.get_discovery_feed_page(
  integer, integer, integer, integer, text[], text[], text[], integer, text
);
DROP FUNCTION IF EXISTS public.get_match_messages(uuid);