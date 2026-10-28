# Chahat location kit: status, setup, checklist

## Status (honest)
- Written WITHOUT access to C:\Chahat. These are drafts to merge, not a patch against your tree.
- Verified here: TypeScript check and 13 Jest tests pass for `location.ts` and `places.ts` (mocked expo-location).
- NOT verified: SQL migration and SQL tests (no Postgres/PostGIS run), Edge Function (not deployed, Photon not called), React hook, any UI screen, any physical Android device, ESLint.
- Not delivered (need your repo): picker/Discover screen edits, removal of the hardcoded city list and the preselected Pune, wiring into the existing Discover query, a real `git diff` patch.

## Likely root cause of the client's failure (confirm in code)
The screenshot says "We couldn't match your location to a supported city". The GPS fix likely succeeds, then the result is matched against the hardcoded city list; a city outside it (or a geocoder returning a district/suburb with empty `city`) fails. Hardcoded chips work because they skip GPS + geocoding. Fix: delete the supported-city gate; use `reverseToCity`, which falls back city -> county -> district.
Secondary suspects to check: `getLastKnownPositionAsync` or Balanced-only accuracy returning stale/coarse fixes; `Location.reverseGeocodeAsync` returning empty on devices with weak Google Play services.

## Merge steps
1. Merge `location.ts` / `places.ts` into `mobile/src/services/`. Pass `supabase.functions.invoke.bind(supabase.functions)` as `invoke`.
2. Picker: remove hardcoded array + default Pune; two options only. On GPS success call `reverseToCity`, then `set_my_discovery_location(lat, lon, 'gps', fix.quality, accuracyM, city, state, placeId)`. On city pick call it with the place's centroid, `'city'`, `'city'`. Show "approximate" wording whenever `is_approximate` is true.
3. Discover: keep the existing query; add `distance_to_profiles(ids)` and render `distance_km` ("0.8 km away"); no row = no distance text. Define `public.can_discover(viewer, candidate)` from your existing rules BEFORE applying the migration.
4. app.json (Expo SDK 52): `"plugins": [["expo-location", { "locationAlwaysAndWhenInUsePermission": false }]]` and Android permissions `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` only. No background location.

## Deploy (you run these)
```
supabase db push            # after reviewing the migration against the live schema
supabase functions deploy place-search
supabase secrets set PHOTON_URL=https://your-photon-host   # optional; default is the public demo server
```

## Provider notes
- Photon on photon.komoot.io: free, no key, fair-use rate limits, no SLA, OSM data (ODbL: show "(c) OpenStreetMap contributors"). Use a self-hosted Photon or Google Places/Mapbox for production; with a paid provider keep the key in function secrets.
- No geocoder guarantees exhaustive coverage of every Indian town; verify your examples (G -> Gorakhpur, Greater Noida; K -> Kolkata, Kushinagar). Single-letter prefix quality varies; consider a 2-character minimum if results are noisy.
- Photon's multi-tag filtering and reverse behaviour on the public instance were written from memory of its docs; test them.

## Privacy and security notes
- Table has RLS on with no policies and no grants; only SECURITY DEFINER RPCs touch it, always scoped to `auth.uid()`.
- Reverse geocoding sends coordinates rounded to ~1 km, rounded again server-side. Do not log request bodies.
- Distance oracle risk: anyone can pass candidate IDs and, with moves/repeated queries, trilaterate. Mitigations: `can_discover` limits IDs to eligible profiles; 100-ID cap; consider coarser rounding (whole km, "<1 km"), rate limits, and snapping stored coordinates to a grid. The spec's 0.8 km display is less private than whole-km.
- Straight-line (geodesic) distance differs from driving distance and from perceived distance. City-source locations are city-centre points, so distances involving them are marked approximate.

## Physical Android checklist
Reproduce the bug first (before merging): use a phone/city outside the hardcoded list, tap Use my current location.
1. Fresh install: tap button -> permission prompt appears once; Allow precise -> city/state shown, saved.
2. Choose "Approximate" in the prompt -> works, labelled approximate.
3. Deny once -> clear message, retry works. Deny + "don't ask again" -> Open Settings action + Search City.
4. Revoke permission in Settings while app is backgrounded, return -> handled.
5. Turn location off in quick settings -> services-off message; turn on, retry.
6. Airplane mode -> no endless spinner; error + retry.
7. Mash the button 10x -> one request.
8. City search: type G, K, a small town, a misspelling, no match, offline, rapid typing (no flicker from old results).
9. Two test accounts, known real distance apart: Discover shows matching km; move one -> refresh -> updates. Blocked/reported/out-of-age users never appear. No coordinates in network inspector or logcat.
10. Account with no location: no "0 km", handled per product rules.
