-- FORWARD-ONLY DRAFT. Review against the live schema before applying. Not applied by the author.
-- ASSUMPTIONS to verify: existing set_my_discovery_location/clear_/has_my_discovery_location may already store
-- coordinates somewhere. If so, point this migration at that table instead of creating a second store.
create extension if not exists postgis with schema extensions;

create table if not exists public.user_private_locations (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  geog        extensions.geography(Point, 4326) not null,
  source      text not null check (source in ('gps', 'city')),
  fix_quality text not null check (fix_quality in ('precise', 'approximate', 'city')),
  accuracy_m  integer check (accuracy_m is null or accuracy_m >= 0),
  city        text,
  state       text,
  place_id    text,
  updated_at  timestamptz not null default now()
);

alter table public.user_private_locations enable row level security;
-- No policies and no grants: clients can never read or write this table directly.
revoke all on public.user_private_locations from anon, authenticated, public;

create index if not exists user_private_locations_geog_gix on public.user_private_locations using gist (geog);

-- If the existing function has a different signature, check callers, then DROP it explicitly:
-- drop function if exists public.set_my_discovery_location(<old args>);
create or replace function public.set_my_discovery_location(
  p_lat double precision, p_lon double precision,
  p_source text, p_fix_quality text, p_accuracy_m integer,
  p_city text, p_state text, p_place_id text default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  if p_source not in ('gps', 'city') or p_fix_quality not in ('precise', 'approximate', 'city') then
    raise exception 'invalid source' using errcode = '22023';
  end if;
  if p_source = 'city' and p_fix_quality <> 'city' then
    raise exception 'city source must have city quality' using errcode = '22023';
  end if;
  insert into public.user_private_locations as l
    (user_id, geog, source, fix_quality, accuracy_m, city, state, place_id, updated_at)
  values (auth.uid(), st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography, p_source, p_fix_quality,
          p_accuracy_m, left(p_city, 120), left(p_state, 120), left(p_place_id, 120), now())
  on conflict (user_id) do update set
    geog = excluded.geog, source = excluded.source, fix_quality = excluded.fix_quality,
    accuracy_m = excluded.accuracy_m, city = excluded.city, state = excluded.state,
    place_id = excluded.place_id, updated_at = now();
end $$;

create or replace function public.clear_my_discovery_location() returns void
language sql security definer set search_path = public as $$
  delete from public.user_private_locations where user_id = auth.uid();
$$;

create or replace function public.has_my_discovery_location() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_private_locations where user_id = auth.uid());
$$;

-- Distance for candidates the EXISTING discovery query already approved. Viewer is always auth.uid().
-- Missing coordinates => no row (the app shows no distance, never "0 km").
-- public.can_discover(viewer, candidate) MUST wrap your existing eligibility rules (blocks, reports,
-- age range, visibility, preferences). Creation fails loudly if it does not exist.
create or replace function public.distance_to_profiles(p_ids uuid[])
returns table (profile_id uuid, distance_km numeric, is_approximate boolean)
language sql stable security definer set search_path = public, extensions as $$
  select c.user_id,
         round((st_distance(c.geog, me.geog) / 1000.0)::numeric,
               case when st_distance(c.geog, me.geog) < 10000 then 1 else 0 end),
         (me.fix_quality <> 'precise' or c.fix_quality <> 'precise')
  from public.user_private_locations me
  join public.user_private_locations c on c.user_id = any (p_ids[1:100])
  where me.user_id = auth.uid()
    and c.user_id <> me.user_id
    and public.can_discover(me.user_id, c.user_id);
$$;

revoke all on function public.set_my_discovery_location(double precision, double precision, text, text, integer, text, text, text) from public, anon;
revoke all on function public.clear_my_discovery_location() from public, anon;
revoke all on function public.has_my_discovery_location() from public, anon;
revoke all on function public.distance_to_profiles(uuid[]) from public, anon;
grant execute on function public.set_my_discovery_location(double precision, double precision, text, text, integer, text, text, text) to authenticated;
grant execute on function public.clear_my_discovery_location() to authenticated;
grant execute on function public.has_my_discovery_location() to authenticated;
grant execute on function public.distance_to_profiles(uuid[]) to authenticated;
