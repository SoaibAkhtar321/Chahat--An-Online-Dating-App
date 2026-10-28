import { useEffect, useRef, useState } from 'react';

export type Place = { id: string; name: string; state: string | null; country: string; lat: number; lon: number };
export type PlaceError = { code: 'network' | 'rate_limited' | 'server' | 'no_match'; message: string };
export type SearchOutcome = { ok: true; places: Place[] } | ({ ok: false } & PlaceError);
export type Invoke = (fn: string, opts: { body: unknown }) => Promise<{ data: any; error: any }>;

const MSG = {
  network: 'No connection. Check your internet and retry.',
  rate_limited: 'Too many searches. Wait a moment and retry.',
  server: 'City search is unavailable right now. Retry shortly.',
  no_match: "We couldn't work out your city from your location. Search for your city instead.",
};
const bad = (code: PlaceError['code']): SearchOutcome => ({ ok: false, code, message: MSG[code] });

function classify(error: any): SearchOutcome {
  const status = error?.context?.status;
  if (status === 429) return bad('rate_limited');
  if (typeof status === 'number') return bad('server');
  return bad('network');
}

export async function searchCities(invoke: Invoke, query: string): Promise<SearchOutcome> {
  const q = query.trim();
  if (q.length < 1) return { ok: true, places: [] };
  try {
    const { data, error } = await invoke('place-search', { body: { mode: 'search', q } });
    if (error) return classify(error);
    return { ok: true, places: Array.isArray(data?.places) ? data.places : [] };
  } catch {
    return bad('network');
  }
}

/** Coordinates are rounded to ~1 km before leaving the device: a city label does not need a precise fix. */
export async function reverseToCity(invoke: Invoke, lat: number, lon: number): Promise<SearchOutcome> {
  try {
    const { data, error } = await invoke('place-search', {
      body: { mode: 'reverse', lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 },
    });
    if (error) return classify(error);
    const place = data?.places?.[0];
    return place ? { ok: true, places: [place] } : bad('no_match');
  } catch {
    return bad('network');
  }
}

/** Debounced typeahead. Late responses for old queries are discarded. */
export function useCitySearch(invoke: Invoke, delayMs = 300) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<{ loading: boolean; places: Place[]; error: PlaceError | null; searched: boolean }>(
    { loading: false, places: [], error: null, searched: false },
  );
  const seq = useRef(0);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setState({ loading: false, places: [], error: null, searched: false }); return; }
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(async () => {
      const r = await searchCities(invoke, q);
      if (mine !== seq.current) return;
      setState(r.ok
        ? { loading: false, places: r.places, error: null, searched: true }
        : { loading: false, places: [], error: { code: r.code, message: r.message }, searched: true });
    }, delayMs);
    return () => clearTimeout(t);
  }, [query, retryTick, invoke, delayMs]);

  return { query, setQuery, ...state, retry: () => setRetryTick((n) => n + 1) };
}
