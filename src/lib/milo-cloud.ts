// Lovable Cloud layer: real sign-in and server storage for accounts, profiles, Likes,
// Matches and chats. Other prototype features (Premium, calls, admin) stay local demos.
import { toast } from "sonner";
import type { RealtimeChannel, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  ageFrom, emptyUser, getState, migrate, notify, profileById, setState, subscribe, sync,
  type Message, type MePhoto, type MeProfile, type Profile, type UserData,
} from "./milo-store";
import { deleteMyAccount } from "./account.functions";

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type StoredPhoto = { id: string; path: string; thumbPath: string; w: number; h: number; kb: number; status: MePhoto["status"] };

/** Private per-account fields kept in `account_state` (only the owner can read them). */
const PRIVATE_KEYS = ["onboardingStep", "filters", "likesUsed", "lastSwipe", "notices", "premium", "boostUntil", "settings", "freeUsed",
  "calls", "purchases", "superLikesUsed", "superLiked", "verification", "groups", "quiz", "games", "polls"] as const;
const ME_PRIVATE = ["locMode", "ageMin", "ageMax", "distance", "voice", "travelCity"] as const;
const PUBLIC_COLS = "id,is_demo,name,dob,gender,seeking,city,bio,work,education,intents,interests,languages,lifestyle,prompt,photos,onboarded,last_active";

let uid: string | null = null;
let loading: Promise<void> | null = null;
let channel: RealtimeChannel | null = null;
let started = false;
const urlCache = new Map<string, string>();
const matchOther = new Map<string, string>(); // match id -> other profile id

// ---------- helpers ----------
async function signUrls(bucket: "photos" | "chat", paths: string[]) {
  const need = [...new Set(paths.filter((p) => p && !urlCache.has(`${bucket}:${p}`)))];
  if (need.length) {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(need, 60 * 60 * 24);
    data?.forEach((d) => { if (d.signedUrl && d.path) urlCache.set(`${bucket}:${d.path}`, d.signedUrl); });
  }
  return (p: string) => urlCache.get(`${bucket}:${p}`) ?? "";
}
const asPhotos = (j: Json): StoredPhoto[] => (Array.isArray(j) ? (j as unknown as StoredPhoto[]) : []);
const minutesAgo = (t: string) => Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));

function toProfile(r: ProfileRow, url: (p: string) => string): Profile {
  const prompt = (r.prompt ?? {}) as { q?: string; a?: string };
  return {
    id: r.id, name: r.name || "Milo member", age: r.dob ? ageFrom(r.dob) : 0, city: r.city, distanceKm: 0, bio: r.bio,
    photos: asPhotos(r.photos).map((p) => url(p.path)).filter(Boolean), interests: r.interests, intent: r.intents[0] ?? "Not sure yet",
    ...(r.work ? { work: r.work } : {}), ...(r.education ? { education: r.education } : {}),
    ...(prompt.q && prompt.a ? { prompt: { q: prompt.q, a: prompt.a } } : {}),
    lifestyle: (r.lifestyle ?? {}) as Record<string, string>, languages: r.languages,
    lastActiveMin: minutesAgo(r.last_active), likesYou: false,
    ...(r.gender === "man" || r.gender === "woman" ? { gender: r.gender } : {}),
  };
}

async function loadPeople(ids: string[], pool: boolean) {
  const rows: ProfileRow[] = [];
  if (pool) {
    const { data } = await supabase.from("profiles").select(PUBLIC_COLS).eq("is_demo", false).eq("onboarded", true).neq("id", uid!).order("last_active", { ascending: false }).limit(200);
    rows.push(...((data ?? []) as ProfileRow[]));
  }
  const missing = ids.filter((id) => !rows.some((r) => r.id === id) && !profileById(id).demo);
  if (missing.length) {
    const { data } = await supabase.from("profiles").select(PUBLIC_COLS).in("id", missing);
    rows.push(...((data ?? []) as ProfileRow[]));
  }
  const url = await signUrls("photos", rows.flatMap((r) => asPhotos(r.photos).map((p) => p.path)));
  const out: Record<string, Profile> = {};
  for (const r of rows) if (!r.is_demo) out[r.id] = toProfile(r, url);
  return out;
}

async function toMessages(rows: MessageRow[]) {
  const url = await signUrls("chat", rows.map((m) => m.image_path ?? "").filter(Boolean));
  return rows.map((m): Message => ({
    id: m.id, from: m.sender === uid ? "me" : "them", text: m.body, at: new Date(m.created_at).getTime(),
    status: m.sender === uid ? (m.read_at ? "read" : "sent") : "read",
    ...(m.image_path ? { image: url(m.image_path) } : {}),
  }));
}

// ---------- load a signed-in account ----------
async function loadAccount(user: User) {
  uid = user.id;
  const id = user.id;
  const [prof, st, mine, liked, mt, bl] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("account_state").select("data").eq("user_id", id).maybeSingle(),
    supabase.from("swipes").select("to_id,kind").eq("from_id", id),
    supabase.from("swipes").select("from_id").eq("to_id", id).neq("kind", "pass"),
    supabase.from("matches").select("id,user_a,user_b,created_at").order("created_at"),
    supabase.from("blocks").select("blocked").eq("blocker", id),
  ]);
  const row = prof.data;
  const blob = (st.data?.data ?? {}) as Partial<UserData> & { me?: Partial<MeProfile> };
  const matches: string[] = []; const matchIds: Record<string, string> = {};
  matchOther.clear();
  for (const m of mt.data ?? []) { const o = m.user_a === id ? m.user_b : m.user_a; matches.push(o); matchIds[o] = m.id; matchOther.set(m.id, o); }
  const likers = (liked.data ?? []).map((r) => r.from_id);
  const swiped: Record<string, "like" | "pass"> = {};
  for (const s of mine.data ?? []) swiped[s.to_id] = s.kind === "pass" ? "pass" : "like";

  const msgRows = matches.length ? (await supabase.from("messages").select("*").in("match_id", Object.values(matchIds)).order("created_at")).data ?? [] : [];
  const msgs = await toMessages(msgRows);
  const messages: Record<string, Message[]> = {}; const unread: Record<string, number> = {};
  msgRows.forEach((r, k) => {
    const o = matchOther.get(r.match_id); if (!o) return;
    (messages[o] ??= []).push(msgs[k]!);
    if (r.sender !== id && !r.read_at) unread[o] = (unread[o] ?? 0) + 1;
  });

  const people = await loadPeople([...matches, ...likers], true);
  const myPhotos = asPhotos(row?.photos ?? []);
  const url = await signUrls("photos", myPhotos.flatMap((p) => [p.path, p.thumbPath]));
  const base = emptyUser();
  const prompt = (row?.prompt ?? {}) as { q?: string; a?: string };
  const me: MeProfile = {
    ...base.me, ...(blob.me ?? {}),
    name: row?.name ?? "", dob: row?.dob ?? "", gender: (row?.gender ?? "") as MeProfile["gender"], seeking: (row?.seeking ?? "") as MeProfile["seeking"],
    intents: row?.intents ?? [], city: row?.city ?? "", work: row?.work ?? "", education: row?.education ?? "", bio: row?.bio ?? "",
    prompt: { q: prompt.q ?? base.me.prompt.q, a: prompt.a ?? "" }, interests: row?.interests ?? [], languages: row?.languages ?? [],
    lifestyle: (row?.lifestyle ?? {}) as Record<string, string>,
    photos: myPhotos.map((p) => ({ id: p.id, src: url(p.path), thumb: url(p.thumbPath) || url(p.path), w: p.w, h: p.h, kb: p.kb, status: p.status, path: p.path, thumbPath: p.thumbPath })),
  };
  const priv = Object.fromEntries(PRIVATE_KEYS.filter((k) => k in blob).map((k) => [k, blob[k]])) as Partial<UserData>;
  setState(() => ({
    ...base, ...migrate({ ...priv, me }),
    onboarded: !!row?.onboarded, swiped, matches, matchIds, messages, unread, likers, people,
    blocked: (bl.data ?? []).map((b) => b.blocked),
    account: { email: user.email ?? "", verified: true, id }, loggedIn: true, sessionReady: true,
  }));
  lastPub = JSON.stringify(publicRow()); lastPriv = JSON.stringify(privateBlob()); lastPaths = new Set(myPhotos.flatMap((p) => [p.path, p.thumbPath]));
  void supabase.from("profiles").update({ last_active: new Date().toISOString() }).eq("id", id);
  listen(id);
}

function clearAccount() {
  uid = null; matchOther.clear();
  if (channel) { void supabase.removeChannel(channel); channel = null; }
  setState(() => ({ ...emptyUser(), loggedIn: false, account: null, people: {}, likers: [], matchIds: {}, sessionReady: true }));
}

function ensureLoaded(user: User | null | undefined) {
  if (!user) { clearAccount(); return Promise.resolve(); }
  if (uid === user.id && getState().loggedIn) return Promise.resolve();
  if (!user.email_confirmed_at && !user.confirmed_at) { setState(() => ({ account: { email: user.email ?? "", verified: false }, sessionReady: true })); return Promise.resolve(); }
  loading ??= loadAccount(user).catch((e) => { console.error(e); toast.error("Couldn't load your account. Check your connection and try again."); setState(() => ({ sessionReady: true })); }).finally(() => { loading = null; });
  return loading;
}

// ---------- realtime ----------
function listen(id: string) {
  if (channel) void supabase.removeChannel(channel);
  channel = supabase.channel(`milo-${id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, async (payload) => {
      const r = payload.new as MessageRow; const o = matchOther.get(r.match_id); if (!o) return;
      if (getState().messages[o]?.some((m) => m.id === r.id)) return;
      const [m] = await toMessages([r]);
      setState((s) => ({ messages: { ...s.messages, [o]: [...(s.messages[o] ?? []).filter((x) => x.id !== r.id), m!] }, ...(r.sender !== id ? { unread: { ...s.unread, [o]: (s.unread[o] ?? 0) + 1 } } : {}) }));
      if (r.sender !== id) notify("message", `${profileById(o).name} sent you a message`, `/chat/${o}`);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
      const r = payload.new as MessageRow; const o = matchOther.get(r.match_id); if (!o || r.sender !== id || !r.read_at) return;
      setState((s) => ({ messages: { ...s.messages, [o]: (s.messages[o] ?? []).map((m) => (m.id === r.id ? { ...m, status: "read" as const } : m)) } }));
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches" }, async (payload) => {
      const m = payload.new as { id: string; user_a: string; user_b: string };
      const o = m.user_a === id ? m.user_b : m.user_a; matchOther.set(m.id, o);
      if (!profileById(o).demo && !getState().people[o]) { const p = await loadPeople([o], false); setState((s) => ({ people: { ...s.people, ...p } })); }
      const fresh = !getState().matches.includes(o);
      setState((s) => ({ matchIds: { ...s.matchIds, [o]: m.id }, matches: s.matches.includes(o) ? s.matches : [...s.matches, o] }));
      if (fresh) notify("match", `You matched with ${profileById(o).name}`, `/chat/${o}`);
    })
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "matches" }, (payload) => {
      const mid = (payload.old as { id?: string }).id; const o = mid ? matchOther.get(mid) : undefined; if (!o) return;
      matchOther.delete(mid!);
      setState((s) => { const mi = { ...s.matchIds }; delete mi[o]; const ms = { ...s.messages }; delete ms[o]; return { matchIds: mi, messages: ms, matches: s.matches.filter((x) => x !== o) }; });
    })
    .subscribe();
}

// ---------- write-through ----------
const publicRow = () => {
  const s = getState(); const m = s.me;
  return {
    name: m.name.slice(0, 40), dob: m.dob || null, gender: m.gender, seeking: m.seeking, city: m.city, work: m.work, education: m.education,
    bio: m.bio.slice(0, 500), intents: m.intents, interests: m.interests, languages: m.languages, lifestyle: m.lifestyle as Json, prompt: m.prompt as Json,
    photos: m.photos.filter((p) => p.path).map((p): StoredPhoto => ({ id: p.id, path: p.path!, thumbPath: p.thumbPath ?? p.path!, w: p.w, h: p.h, kb: p.kb, status: p.status })) as unknown as Json,
    onboarded: s.onboarded,
  };
};
const privateBlob = () => {
  const s = getState();
  return { ...Object.fromEntries(PRIVATE_KEYS.map((k) => [k, s[k]])), me: Object.fromEntries(ME_PRIVATE.map((k) => [k, s.me[k]])) };
};
let lastPub = ""; let lastPriv = ""; let lastPaths = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined; let saving = false; let again = false;

async function uploadPhoto(p: MePhoto): Promise<MePhoto> {
  const ext = p.src.startsWith("data:image/webp") ? "webp" : "jpg";
  const up = async (data: string, suffix: string) => {
    const blob = await (await fetch(data)).blob();
    const path = `${uid}/${p.id}${suffix}.${ext}`;
    const { error } = await supabase.storage.from("photos").upload(path, blob, { upsert: true, contentType: blob.type });
    if (error) throw error;
    return path;
  };
  const [path, thumbPath] = await Promise.all([up(p.src, ""), up(p.thumb, "_t")]);
  return { ...p, path, thumbPath };
}

async function flush() {
  if (!uid || !getState().loggedIn) return;
  if (saving) { again = true; return; }
  saving = true;
  try {
    const pending = getState().me.photos.filter((p) => !p.path && p.src.startsWith("data:"));
    if (pending.length) {
      const done = await Promise.all(pending.map(uploadPhoto));
      const byId = new Map(done.map((d) => [d.id, d]));
      setState((s) => ({ me: { ...s.me, photos: s.me.photos.map((p) => byId.get(p.id) ?? p) } }));
    }
    const pub = publicRow(); const pubS = JSON.stringify(pub);
    if (pubS !== lastPub) {
      const { error } = await supabase.from("profiles").update(pub).eq("id", uid);
      if (error) { toast.error(/18/.test(error.message) ? error.message : "Couldn't save your profile. We'll retry."); throw error; }
      lastPub = pubS;
      const now = new Set(getState().me.photos.flatMap((p) => [p.path, p.thumbPath].filter(Boolean) as string[]));
      const gone = [...lastPaths].filter((p) => !now.has(p));
      if (gone.length) void supabase.storage.from("photos").remove(gone);
      lastPaths = now;
    }
    const priv = privateBlob(); const privS = JSON.stringify(priv);
    if (privS !== lastPriv) {
      const { error } = await supabase.from("account_state").upsert({ user_id: uid, data: priv as unknown as Json, updated_at: new Date().toISOString() });
      if (error) throw error;
      lastPriv = privS;
    }
  } catch (e) {
    console.error("save failed", e);
    again = false; setTimeout(schedule, 5000);
  } finally {
    saving = false;
    if (again) { again = false; void flush(); }
  }
}
function schedule() { clearTimeout(timer); timer = setTimeout(() => void flush(), 700); }

async function matchIdFor(otherId: string) {
  const known = getState().matchIds[otherId]; if (known) return known;
  const [a, b] = [uid!, otherId].sort();
  const { data } = await supabase.from("matches").select("id").eq("user_a", a!).eq("user_b", b!).maybeSingle();
  if (data) { matchOther.set(data.id, otherId); setState((s) => ({ matchIds: { ...s.matchIds, [otherId]: data.id } })); }
  return data?.id ?? null;
}

function registerSync() {
  sync.active = true;
  sync.swipe = async (id, kind, match) => {
    const { error } = await supabase.from("swipes").insert({ from_id: uid!, to_id: id, kind });
    if (error && error.code !== "23505") {
      toast.error("Couldn't save that. Please try again.");
      setState((s) => { const sw = { ...s.swiped }; delete sw[id]; return { swiped: sw, matches: s.matches.filter((m) => m !== id) }; });
      return;
    }
    if (match) await matchIdFor(id);
  };
  sync.unswipe = (id) => { void supabase.from("swipes").delete().eq("from_id", uid!).eq("to_id", id).eq("kind", "pass"); };
  sync.send = async (otherId, msg) => {
    const fail = () => setState((s) => ({ messages: { ...s.messages, [otherId]: (s.messages[otherId] ?? []).map((m) => (m.id === msg.id ? { ...m, status: "failed" as const } : m)) } }));
    try {
      const mid = await matchIdFor(otherId); if (!mid) return fail();
      let image_path: string | null = null;
      if (msg.image?.startsWith("data:")) {
        const blob = await (await fetch(msg.image)).blob();
        image_path = `${mid}/${msg.id}.${blob.type.includes("webp") ? "webp" : "jpg"}`;
        const { error } = await supabase.storage.from("chat").upload(image_path, blob, { contentType: blob.type });
        if (error) return fail();
      }
      const { error } = await supabase.from("messages").insert({ id: msg.id, match_id: mid, sender: uid!, body: msg.text.slice(0, 1000), image_path });
      if (error) return fail();
      if (profileById(otherId).demo) setTimeout(() => { void supabase.rpc("demo_reply", { _match: mid }).then(() => markMineRead(otherId)); }, 1800);
    } catch { fail(); }
  };
  sync.markRead = async (otherId) => {
    if (getState().settings.privacy["Read receipts"] === false) return;
    const mid = getState().matchIds[otherId]; if (!mid) return;
    await supabase.from("messages").update({ read_at: new Date().toISOString() }).eq("match_id", mid).neq("sender", uid!).is("read_at", null);
  };
  sync.unmatch = (otherId) => { const mid = getState().matchIds[otherId]; if (mid) void supabase.from("matches").delete().eq("id", mid); };
  sync.block = (otherId) => {
    void supabase.from("blocks").insert({ blocker: uid!, blocked: otherId });
    const mid = getState().matchIds[otherId]; if (mid) void supabase.from("matches").delete().eq("id", mid);
  };
  sync.unblock = (otherId) => { void supabase.from("blocks").delete().eq("blocker", uid!).eq("blocked", otherId); };
  sync.report = (target, category, note, source) => {
    void supabase.from("reports").insert({ reporter: uid!, target, category: category.slice(0, 60), note, source: (["profile", "chat", "call"].includes(source) ? source : "profile") });
  };
}
/** Demo partners "read" my messages when they reply. */
function markMineRead(otherId: string) {
  setState((s) => ({ messages: { ...s.messages, [otherId]: (s.messages[otherId] ?? []).map((m) => (m.from === "me" && m.status === "sent" ? { ...m, status: "read" as const } : m)) } }));
}

/** Starts session tracking once per page load (browser only). */
export function initCloud() {
  if (started || typeof window === "undefined") return;
  started = true;
  registerSync();
  subscribe(() => { if (uid && getState().loggedIn && !loading) schedule(); });
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") { clearAccount(); return; }
    if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "INITIAL_SESSION") setTimeout(() => void ensureLoaded(session?.user), 0);
  });
}

// ---------- auth actions ----------
const norm = (e: string) => e.trim().toLowerCase();
export async function signUp(email: string, pw: string): Promise<"ok" | "exists" | string> {
  const { data, error } = await supabase.auth.signUp({ email: norm(email), password: pw, options: { emailRedirectTo: `${window.location.origin}/login` } });
  if (error) return /registered|exists/i.test(error.message) ? "exists" : error.message;
  if (data.user && data.user.identities?.length === 0) return "exists";
  setState(() => ({ account: { email: norm(email), verified: false } }));
  return "ok";
}
export async function logIn(email: string, pw: string): Promise<"ok" | "invalid" | "unverified" | string> {
  const { data, error } = await supabase.auth.signInWithPassword({ email: norm(email), password: pw });
  if (error) {
    if (/confirm/i.test(error.message)) { setState(() => ({ account: { email: norm(email), verified: false } })); return "unverified"; }
    if (/invalid/i.test(error.message)) return "invalid";
    return error.message;
  }
  await ensureLoaded(data.user);
  return "ok";
}
export async function signInWithGoogle() {
  const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: `${window.location.origin}/login` });
  if (r.error) { toast.error("Google sign-in didn't complete. Please try again."); return false; }
  return true;
}
export async function resendConfirmation(email: string) {
  const { error } = await supabase.auth.resend({ type: "signup", email: norm(email), options: { emailRedirectTo: `${window.location.origin}/login` } });
  return !error;
}
export async function sendPasswordReset(email: string) {
  await supabase.auth.resetPasswordForEmail(norm(email), { redirectTo: `${window.location.origin}/reset-password` });
}
export async function logOut() {
  await flush();
  await supabase.auth.signOut();
  clearAccount();
}
export async function deleteAccount() {
  await deleteMyAccount();
  await supabase.auth.signOut();
  clearAccount();
}
