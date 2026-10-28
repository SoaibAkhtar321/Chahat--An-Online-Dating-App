-- Run against a LOCAL/STAGING database after the migration. Rolls back everything.
begin;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b2');

-- Seed as table owner (Delhi and Mumbai city centres).
insert into public.user_private_locations (user_id, geog, source, fix_quality)
values ('00000000-0000-0000-0000-0000000000a1', st_setsrid(st_makepoint(77.2090, 28.6139), 4326)::geography, 'gps', 'precise'),
       ('00000000-0000-0000-0000-0000000000b2', st_setsrid(st_makepoint(72.8777, 19.0760), 4326)::geography, 'gps', 'precise');

-- 1. Known pair: Delhi-Mumbai geodesic is ~1,150 km. Allow 1%.
do $$ declare d numeric; begin
  select st_distance(a.geog, b.geog) / 1000 into d
  from public.user_private_locations a, public.user_private_locations b
  where a.user_id = '00000000-0000-0000-0000-0000000000a1' and b.user_id = '00000000-0000-0000-0000-0000000000b2';
  if abs(d - 1150) > 12 then raise exception 'distance off: %', d; end if;
end $$;

-- 2. Signed-in user cannot read coordinates directly.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$ begin
  begin
    perform 1 from public.user_private_locations;
    raise exception 'FAIL: direct table read succeeded';
  exception when insufficient_privilege then null; end;
end $$;

-- 3. distance_to_profiles only ever measures from auth.uid() (no viewer argument exists), and returns no coordinates.
--    (Requires public.can_discover; with real rules in place also assert blocked users return no row.)
select * from public.distance_to_profiles(array['00000000-0000-0000-0000-0000000000b2']::uuid[]);
rollback;
