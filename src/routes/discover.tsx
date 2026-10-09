import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion, useMotionValue, useTransform, animate, type PanInfo } from "framer-motion";
import { useState } from "react";
import { Heart, X, MapPin, SlidersHorizontal, RotateCcw, Rocket, Bell, Lock, Check, Gem, Plane, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { Phone, Logo, Chip, Field, btnGhost, btnPrimary } from "@/components/milo/Phone";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LANGUAGES, can, eligibleDeck, superLike, travel, isPremium, swipe, undoSwipe, useMilo, setState, PROFILES, type Profile, type Filters } from "@/lib/milo-store";
import { INTERESTS } from "./onboarding";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/discover")({
  head: () => meta("Discover", "Swipe through people near you on Milo."),
  component: Discover,
});

function Discover() {
  const nav = useNavigate();
  const st = useMilo((s) => s);
  const deck = eligibleDeck(st);
  const premium = isPremium(st);
  const canUndo = can(st, "undoPass"), canBoost = can(st, "boost"), canFilters = can(st, "advancedFilters"), unlimited = can(st, "unlimitedLikes");
  const myInterests = st.me.interests;
  const lastSwipe = useMilo((s) => (s.lastSwipe && s.swiped[s.lastSwipe] === "pass" ? s.lastSwipe : null));
  const boostMin = useMilo((s) => s.callConfig.boostMinutes);
  const boostUntil = useMilo((s) => s.boostUntil);
  const likesLeft = useMilo((s) => s.callConfig.freeDailyLikes - s.likesUsed);
  const unreadNotices = useMilo((s) => s.notices.filter((n) => !n.read).length);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);

  const canSuper = can(st, "superLike");
  const superLeft = Math.max(0, st.callConfig.superLikesPerDay - st.superLikesUsed);
  const traveling = travel(st);
  const hidden = st.settings.privacy["Show me in Discover"] === false;
  const priority = (id: string) => {
    const r = superLike(id);
    if (r === "locked") { toast("Priority Likes are a Premium feature", { action: { label: "See Premium", onClick: () => nav({ to: "/premium" }) } }); return; }
    if (r === "none-left") { toast("No Priority Likes left today (demo daily allowance)"); return; }
    if (r === "limit") { setLimitOpen(true); return; }
    if (r === "match") { nav({ to: "/match/$id", params: { id } }); return; }
    if (r === "ok") toast.success("Priority Like sent. It'll be highlighted for them (demo). No match is guaranteed.");
  };
  const act = (id: string, dir: "like" | "pass") => {
    const r = swipe(id, dir);
    if (r === "limit") setLimitOpen(true);
    if (r === "match") nav({ to: "/match/$id", params: { id } });
    return r;
  };
  const undo = () => {
    if (!canUndo) { toast("Undo Pass is a Premium feature", { action: { label: "See Premium", onClick: () => nav({ to: "/premium" }) } }); return; }
    if (undoSwipe()) toast("Brought back the profile you passed");
  };
  const boost = () => {
    if (!canBoost) { toast("Boost is a Premium feature", { action: { label: "See Premium", onClick: () => nav({ to: "/premium" }) } }); return; }
    // No stacking: a Boost already running must finish before a new one can start.
    if (boostUntil > Date.now()) { toast(`Boost already active until ${new Date(boostUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. You can start another after it ends.`); return; }
    if (hidden) { toast("Your profile is hidden from Discover. Turn visibility back on in Settings to use Boost."); return; }
    setState(() => ({ boostUntil: Date.now() + boostMin * 60e3 })); toast.success(`Boost on for ${boostMin} minutes (demo). More people may see you; Likes aren't guaranteed.`);
  };
  const boosting = boostUntil > Date.now();

  return (
    <Phone auth tabs className="flex flex-col">
      <header className="flex items-center justify-between px-5 pb-2 pt-7">
        <Logo />
        <div className="flex gap-2">
          <Link to="/notifications" aria-label="Notifications" className="relative grid size-10 place-items-center rounded-full border bg-card">
            <Bell className="size-5" />{unreadNotices > 0 && <span className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-card bg-primary" />}
          </Link>
          <button aria-label="Filters" onClick={() => setFiltersOpen(true)} className="grid size-10 place-items-center rounded-full border bg-card"><SlidersHorizontal className="size-5" /></button>
        </div>
      </header>
      {st.announcements.filter((a) => a.active).slice(0, 1).map((a) => <p key={a.id} className="mx-5 mb-1 rounded-xl bg-secondary px-3 py-2 text-xs font-semibold">📣 {a.text}</p>)}
      {boosting && <p className="px-5 text-xs font-semibold text-primary">Boost active until {new Date(boostUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (demo). More people may see you; no Likes are guaranteed.</p>}
      {hidden && <p className="mx-5 mb-1 flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs font-semibold"><EyeOff className="size-4" /> Your profile is hidden. New people won't see you; you can still browse and chat. <Link to="/settings" className="underline">Change</Link></p>}
      {traveling && <p className="mx-5 mb-1 flex items-center gap-2 rounded-xl bg-highlight/15 px-3 py-2 text-xs font-semibold"><Plane className="size-4" /> Travel mode: showing people in {st.me.travelCity} first (demo).</p>}
      {!unlimited && <p className="px-5 text-xs text-muted-foreground">{Math.max(0, likesLeft)} likes left today (demo limit)</p>}
      <div className="relative mx-4 mb-3 mt-2 flex-1">
        {deck.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div className="px-6">
              <div className="mx-auto grid size-16 place-items-center rounded-full bg-secondary text-primary"><MapPin className="size-8" /></div>
              <h2 className="mt-4 text-2xl font-semibold">No one new right now</h2>
              <p className="mt-2 text-muted-foreground">Try widening your age, distance or interests, or check back later.</p>
              <button className={`${btnPrimary} mt-6`} onClick={() => setFiltersOpen(true)}>Adjust filters</button>
              <button className={`${btnGhost} mt-2`} onClick={() => setState(() => ({ swiped: { kavya: "like" }, likesUsed: 0, lastSwipe: null }))}><RotateCcw className="mr-2 size-4" /> Reset demo deck</button>
            </div>
          </div>
        ) : (
          deck.slice(0, 2).reverse().map((p, i, arr) => <Card key={p.id} p={p} top={i === arr.length - 1} onSwipe={(d) => act(p.id, d)} mine={myInterests} />)
        )}
      </div>
      {deck[0] && (
        <div className="flex items-center justify-center gap-4 pb-3">
          <button aria-label="Undo last pass" disabled={!lastSwipe} onClick={undo} className="grid size-12 place-items-center rounded-full border bg-card text-accent-foreground shadow-card disabled:opacity-40"><RotateCcw className="size-5" /></button>
          <button aria-label="Pass" onClick={() => act(deck[0]!.id, "pass")} className="grid size-16 place-items-center rounded-full border bg-card text-muted-foreground shadow-card active:scale-90"><X className="size-8" strokeWidth={2.5} /></button>
          <button aria-label="Like" onClick={() => act(deck[0]!.id, "like")} className="grid size-18 place-items-center rounded-full bg-brand text-primary-foreground shadow-glow active:scale-90"><Heart className="size-8" fill="currentColor" /></button>
          <button aria-label="Priority Like" title={canSuper ? `${superLeft} left today` : "Premium"} onClick={() => priority(deck[0]!.id)} className="relative grid size-12 place-items-center rounded-full border bg-card text-highlight shadow-card active:scale-90"><Gem className="size-5" />{canSuper && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-highlight text-[10px] font-bold text-highlight-foreground">{superLeft}</span>}</button>
          <button aria-label="Boost profile" onClick={boost} className={`grid size-12 place-items-center rounded-full border shadow-card ${boosting ? "bg-accent text-accent-foreground" : "bg-card text-primary"}`}><Rocket className="size-5" /></button>
        </div>
      )}
      <FilterSheet open={filtersOpen} onOpenChange={setFiltersOpen} premium={canFilters} travelOk={can(st, "travelMode")} />
      <Sheet open={limitOpen} onOpenChange={setLimitOpen}>
        <SheetContent side="bottom" className="mx-auto max-w-[400px] rounded-t-3xl">
          <SheetHeader><SheetTitle className="font-display text-2xl">You're out of likes for today</SheetTitle></SheetHeader>
          <p className="px-4 text-muted-foreground">Likes reset daily. Premium gives you unlimited likes.</p>
          <div className="space-y-2 p-4"><Link to="/premium" className={btnPrimary}>See Premium</Link><button className={btnGhost} onClick={() => setLimitOpen(false)}>Maybe later</button></div>
        </SheetContent>
      </Sheet>
    </Phone>
  );
}

function FilterSheet({ open, onOpenChange, premium, travelOk }: { open: boolean; onOpenChange: (o: boolean) => void; premium: boolean; travelOk: boolean }) {
  const f = useMilo((s) => s.filters);
  const INTENTS = useMilo((s) => s.intentOptions);
  const travelCity = useMilo((s) => s.me.travelCity);
  const mine = useMilo((s) => s.me.interests);
  // Preset hobbies + your custom ones + any shown on profiles (de-duplicated, case-insensitive).
  const all: string[] = [];
  for (const i of [...INTERESTS, ...mine, ...PROFILES.flatMap((p) => p.interests)]) if (!all.some((x) => x.toLowerCase() === i.toLowerCase())) all.push(i);
  const set = (p: Partial<Filters>) => setState((s) => ({ filters: { ...s.filters, ...p } }));
  const tog = (k: "intents" | "interests" | "languages", v: string) => set({ [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[85vh] max-w-[400px] overflow-y-auto rounded-t-3xl">
        <SheetHeader><SheetTitle className="font-display text-2xl">Filters</SheetTitle></SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          <Field label={`Age ${f.ageMin}–${f.ageMax}`}>
            <div className="flex gap-3">
              <input aria-label="Minimum age" type="range" min={18} max={60} value={f.ageMin} onChange={(e) => set({ ageMin: Math.min(+e.target.value, f.ageMax - 1) })} className="w-full accent-primary" />
              <input aria-label="Maximum age" type="range" min={19} max={70} value={f.ageMax} onChange={(e) => set({ ageMax: Math.max(+e.target.value, f.ageMin + 1) })} className="w-full accent-primary" />
            </div>
          </Field>
          <Field label={`Distance up to ${f.distance} km`}><input type="range" min={2} max={150} value={f.distance} onChange={(e) => set({ distance: +e.target.value })} className="w-full accent-primary" /></Field>
          <div>
            <p className="mb-1 text-sm font-semibold">Speaks</p>
            <p className="mb-2 text-xs text-muted-foreground">Optional. Leave empty to see everyone; pick languages to only show people who speak at least one of them.</p>
            <div className="flex flex-wrap gap-2">{LANGUAGES.map((l) => <Chip key={l} active={f.languages.includes(l)} onClick={() => tog("languages", l)}>{l}</Chip>)}</div>
          </div>
          <div className="relative">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold">Advanced {!premium && <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground"><Lock className="size-3" /> Premium</span>}</p>
            <div className={premium ? "" : "pointer-events-none opacity-40"}>
              <p className="mb-2 text-sm">Looking for</p>
              <div className="flex flex-wrap gap-2">{INTENTS.map((i) => <Chip key={i} active={f.intents.includes(i)} onClick={() => tog("intents", i)}>{i}</Chip>)}</div>
              <p className="mb-2 mt-4 text-sm">Interests</p>
              <div className="flex flex-wrap gap-2">{all.map((i) => <Chip key={i} active={f.interests.includes(i)} onClick={() => tog("interests", i)}>{i}</Chip>)}</div>
            </div>
            {!premium && <Link to="/premium" className="mt-3 block text-sm font-semibold text-primary">Unlock advanced filters →</Link>}
          </div>
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><Plane className="size-4" /> Travel mode {!travelOk && <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground"><Lock className="size-3" /> Premium</span>}</p>
            <select aria-label="Travel city" disabled={!travelOk} className="h-11 w-full rounded-xl border bg-card px-3 text-sm disabled:opacity-40" value={travelCity} onChange={(e) => setState((s) => ({ me: { ...s.me, travelCity: e.target.value } }))}>
              <option value="">Off (people near me)</option>{[...new Set(PROFILES.map((p) => p.city))].map((c) => <option key={c}>{c}</option>)}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Ignores the distance limit and shows the chosen city first. Your own location isn't changed.</p>
          </div>
          <div className="flex gap-2">
            <button className={btnGhost} onClick={() => set({ ageMin: 18, ageMax: 60, distance: 150, intents: [], interests: [], languages: [] })}>Reset</button>
            <button className={btnPrimary} onClick={() => onOpenChange(false)}>Show people</button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Card({ p, top, onSwipe, mine }: { p: Profile; top: boolean; onSwipe: (d: "like" | "pass") => string; mine: string[] }) {
  const shared = (i: string) => mine.some((m) => m.toLowerCase() === i.toLowerCase());
  const tags = [...p.interests].sort((a, b) => Number(shared(b)) - Number(shared(a)));
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-14, 14]);
  const likeO = useTransform(x, [20, 120], [0, 1]);
  const nopeO = useTransform(x, [-120, -20], [1, 0]);
  const [photo, setPhoto] = useState(0);
  const end = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.offset.x) > 110) {
      const dir = info.offset.x > 0 ? "like" : "pass";
      animate(x, info.offset.x > 0 ? 500 : -500, { duration: 0.22 }).then(() => { if (onSwipe(dir) === "limit") animate(x, 0); });
    } else animate(x, 0, { type: "spring", stiffness: 400, damping: 30 });
  };
  return (
    <motion.div drag={top ? "x" : false} dragElastic={0.7} onDragEnd={end} style={{ x, rotate }}
      initial={{ scale: 0.95 }} animate={{ scale: top ? 1 : 0.95 }}
      className="absolute inset-0 cursor-grab overflow-hidden rounded-3xl bg-muted shadow-card active:cursor-grabbing">
      <img src={p.photos[photo]} alt={p.name} draggable={false} width={768} height={1024} className="size-full select-none object-cover" />
      <div className="absolute inset-x-3 top-3 flex gap-1">{p.photos.map((_, k) => <span key={k} className={`h-1 flex-1 rounded-full ${k === photo ? "bg-ink-foreground" : "bg-ink-foreground/40"}`} />)}</div>
      <button aria-label="Previous photo" className="absolute left-0 top-0 h-2/3 w-1/3" onClick={() => setPhoto(Math.max(0, photo - 1))} />
      <button aria-label="Next photo" className="absolute right-0 top-0 h-2/3 w-1/3" onClick={() => setPhoto(Math.min(p.photos.length - 1, photo + 1))} />
      <div className="pointer-events-none absolute inset-0 bg-photo-fade" />
      <motion.span style={{ opacity: likeO }} className="pointer-events-none absolute left-1/2 top-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-card px-4 py-2 text-sm font-bold text-primary shadow-card"><Heart className="size-4" fill="currentColor" /> Interested</motion.span>
      <motion.span style={{ opacity: nopeO }} className="pointer-events-none absolute left-1/2 top-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-card px-4 py-2 text-sm font-bold text-muted-foreground shadow-card"><X className="size-4" /> Not now</motion.span>
      <Link to="/profile/$id" params={{ id: p.id }} className="absolute inset-x-0 bottom-0 block p-5 text-ink-foreground">
        <p className="font-display text-3xl font-semibold">{p.name}, {p.age}</p>
        <p className="mt-1 flex items-center gap-1 text-sm opacity-90"><MapPin className="size-4" /> {p.city} · ~{p.distanceKm} km away</p>
        <p className="mt-1 text-sm font-semibold opacity-95">{p.intent}</p>
        {p.languages.length > 0 && <p className="mt-0.5 text-xs opacity-90">Speaks {p.languages.join(", ")}</p>}
        <p className="mt-2 line-clamp-2 text-sm opacity-90">{p.bio}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">{tags.slice(0, 3).map((i) => <span key={i} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold backdrop-blur ${shared(i) ? "bg-highlight text-highlight-foreground" : "bg-ink-foreground/20"}`}>{shared(i) && <Check className="size-3" />}{i}</span>)}<span className="px-1 py-1 text-xs font-semibold underline">View profile</span></div>
      </Link>
    </motion.div>
  );
}
