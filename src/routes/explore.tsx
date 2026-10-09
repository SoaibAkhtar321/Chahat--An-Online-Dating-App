import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Gift, RotateCcw } from "lucide-react";
import { Phone, Header, cardCls } from "@/components/milo/Phone";
import { allPeople, isHidden, profileById, sendMessage, setState, useMilo, type Profile } from "@/lib/milo-store";
import { compatibility, DATE_TIPS } from "@/lib/compat";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/explore")({
  head: () => meta("Explore", "Daily pick, quizzes, couple games, interest groups and first-date tips on Milo."),
  component: Explore,
});

const QUIZ = [["Mountains", "Beaches"], ["Chai", "Coffee"], ["Movie night", "Concert"], ["Plan everything", "Go with the flow"]] as const;
const GROUPS: [string, string][] = [["Music", "Gigs, playlists and riyaaz"], ["Travel", "Weekend trips and travel stories"], ["Movies", "Bollywood, regional and world cinema"], ["Fitness", "Runs, yoga and gym buddies"], ["Books", "What everyone's reading"]];
const GAME = [
  { q: "Ideal first date?", o: ["Café", "Street food walk", "Museum", "Live music"] },
  { q: "Weekend energy?", o: ["Homebody", "Out and about"] },
  { q: "Texting style?", o: ["Long messages", "Voice notes", "Quick replies"] },
  { q: "Pick a trip", o: ["Goa", "Ladakh", "Kerala", "Rajasthan"] },
];
const POLL = { id: "p1", q: "Best first-date snack?", o: ["Pani puri", "Momos", "Samosa", "Ice cream"] };
const dayNo = () => Math.floor(Date.now() / 864e5);
/** Deterministic demo stand-in for a match's answers, derived from their profile id. Clearly labelled as simulated. */
const sampleAnswer = (p: Profile, i: number) => { const o = GAME[i]!.o; let h = i + 7; for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return o[h % o.length]!; };

function Explore() {
  const st = useMilo((s) => s);
  const day = dayNo();
  const pool = allPeople(st).filter((p) => !st.swiped[p.id] && !isHidden(st, p.id));
  const ranked = pool.map((p, i) => ({ p, c: compatibility(st.me, p), k: (i + day) % Math.max(1, pool.length) })).sort((a, b) => b.c.score - a.c.score || a.k - b.k);
  const pick = ranked[0];
  const recs = ranked.slice(1, 4);
  // Daily Surprise: someone outside your usual top picks, chosen by date so it stays the same all day.
  const rest = ranked.slice(1);
  const surprise = rest.length ? rest[(day * 7) % rest.length] : undefined;
  const matches = st.matches.filter((m) => !isHidden(st, m)).map(profileById).filter(Boolean) as Profile[];
  const [partner, setPartner] = useState(matches[0]?.id ?? "");
  const game = st.games[partner] ?? {};
  const done = Object.keys(game).length === GAME.length;
  const quizDone = Object.keys(st.quiz).length === QUIZ.length;
  const p = profileById(partner);

  return (
    <Phone auth>
      <Header title="Explore" back="/me" />
      <div className="space-y-5 p-5">
        <p className="rounded-xl bg-secondary p-3 text-xs">Demo previews. Picks use simple, visible rules. Nothing here is shared with other people or creates Likes, Matches or messages unless you tap to send.</p>

        <section className={`${cardCls} p-4`}>
          <h2 className="font-semibold">Today's pick</h2>
          {pick ? <Row p={pick.p} sub={`${pick.c.score}% estimate · ${pick.c.reasons[0]}`} /> : <p className="mt-1 text-sm text-muted-foreground">You've seen everyone for now. Check back tomorrow.</p>}
        </section>

        <section className={`${cardCls} p-4`}>
          <h2 className="flex items-center gap-2 font-semibold"><Gift className="size-4 text-primary" /> Daily surprise</h2>
          {surprise ? <Row p={surprise.p} sub={`Someone a little different: ${surprise.p.intent.toLowerCase()} · ${surprise.p.city}`} /> : <p className="mt-1 text-sm text-muted-foreground">No surprise today. You've seen everyone available.</p>}
        </section>

        <section className={`${cardCls} p-4`}>
          <h2 className="font-semibold">Recommended for you</h2>
          {recs.length ? recs.map(({ p: r, c }) => <Row key={r.id} p={r} sub={`${c.score}% · ${c.reasons[0]}`} />) : <p className="mt-1 text-sm text-muted-foreground">No more recommendations today.</p>}
          <p className="mt-2 text-xs text-muted-foreground">Ranked by shared interests, intentions, spoken languages, lifestyle and distance. Same list all day.</p>
        </section>

        <section className={`${cardCls} p-4`}>
          <div className="flex items-center justify-between"><h2 className="font-semibold">This or That</h2>{Object.keys(st.quiz).length > 0 && <button className="flex items-center gap-1 text-xs font-semibold text-primary" onClick={() => setState(() => ({ quiz: {} }))}><RotateCcw className="size-3" /> Reset</button>}</div>
          <div className="mt-2 space-y-2">{QUIZ.map(([a, b], i) => (
            <div key={a} className="grid grid-cols-2 gap-2">{[a, b].map((o) => (
              <button key={o} onClick={() => setState((s) => ({ quiz: { ...s.quiz, [i]: o } }))} className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold ${st.quiz[i] === o ? "border-primary bg-primary/10" : "border-transparent bg-muted"}`}>{o}</button>
            ))}</div>
          ))}</div>
          {quizDone && <p className="mt-2 text-sm text-primary">Done! You're: {Object.values(st.quiz).join(" · ")}.</p>}
        </section>

        <section className={`${cardCls} p-4`}>
          <h2 className="font-semibold">Couple quiz</h2>
          {matches.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Available once you have a match.</p> : <>
            <select aria-label="Play with" className="mt-2 h-10 w-full rounded-xl border bg-card px-3 text-sm" value={partner} onChange={(e) => setPartner(e.target.value)}>{matches.map((m) => <option key={m.id} value={m.id}>Play with {m.name}</option>)}</select>
            <div className="mt-3 space-y-3">{GAME.map((g, i) => (
              <div key={g.q}><p className="text-sm font-semibold">{g.q}</p><div className="mt-1 flex flex-wrap gap-2">{g.o.map((o) => (
                <button key={o} disabled={done} onClick={() => setState((s) => ({ games: { ...s.games, [partner]: { ...(s.games[partner] ?? {}), [i]: o } } }))} className={`rounded-full border px-3 py-1 text-sm ${game[i] === o ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>{o}</button>))}</div></div>
            ))}</div>
            {done && p && (() => { const same = GAME.filter((_, i) => sampleAnswer(p, i) === game[i]).length; return (
              <div className="mt-4 rounded-xl bg-muted p-3 text-sm">
                <p className="font-semibold">Results: {same}/{GAME.length} in common</p>
                <ul className="mt-1 space-y-0.5">{GAME.map((g, i) => <li key={g.q}>{g.q} You: <b>{game[i]}</b> · {p.name}: <b>{sampleAnswer(p, i)}</b></li>)}</ul>
                <p className="mt-2 text-xs text-muted-foreground">Demo: {p.name}'s answers are simulated. In the real app they'd answer on their own phone.</p>
                <div className="mt-2 flex gap-2">
                  <button className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground" onClick={() => { if (sendMessage(partner, `I just did the couple quiz: ${GAME.map((_, i) => game[i]).join(", ")}. Your turn!`)) toast.success(`Sent to ${p.name}`); }}>Share my answers in chat</button>
                  <button className="rounded-full border px-3 py-1.5 text-xs font-semibold" onClick={() => setState((s) => { const g = { ...s.games }; delete g[partner]; return { games: g }; })}>Play again</button>
                </div>
              </div>); })()}
          </>}
        </section>

        <section className={`${cardCls} p-4`}>
          <h2 className="font-semibold">Poll: {POLL.q}</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">{POLL.o.map((o) => <button key={o} onClick={() => setState((s) => ({ polls: { ...s.polls, [POLL.id]: o } }))} className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold ${st.polls[POLL.id] === o ? "border-primary bg-primary/10" : "border-transparent bg-muted"}`}>{o}</button>)}</div>
          {st.polls[POLL.id] && <p className="mt-2 text-xs text-muted-foreground">You voted {st.polls[POLL.id]}. Results from other people need the real backend, so none are shown. <button className="font-semibold text-primary" onClick={() => setState((s) => { const x = { ...s.polls }; delete x[POLL.id]; return { polls: x }; })}>Change vote</button></p>}
        </section>

        <section className={`${cardCls} p-4`}>
          <h2 className="font-semibold">Interest groups</h2>
          <p className="text-xs text-muted-foreground">Joined: {st.groups.length ? st.groups.join(", ") : "none yet"}. Demo: groups have no members or posts yet.</p>
          <div className="mt-2 space-y-2">{GROUPS.map(([g, d]) => { const on = st.groups.includes(g); return (
            <div key={g} className="flex items-center gap-3 rounded-xl border px-3 py-2"><div className="flex-1"><b className="text-sm">{g}</b><p className="text-xs text-muted-foreground">{d}</p></div>
              <button onClick={() => { setState((s) => ({ groups: on ? s.groups.filter((x) => x !== g) : [...s.groups, g] })); toast(on ? `Left ${g}` : `Joined ${g} (demo)`); }} className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? "border" : "bg-primary text-primary-foreground"}`}>{on ? "Leave" : "Join"}</button></div>); })}</div>
        </section>

        <section className={`${cardCls} p-4`}>
          <h2 className="font-semibold">Connection journey & first-date tips</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{DATE_TIPS.map((t) => <li key={t}>{t}</li>)}</ol>
          <p className="mt-2 text-xs text-muted-foreground">Open any chat and tap "Ideas" for suggestions based on both profiles.</p>
        </section>
      </div>
    </Phone>
  );
}

function Row({ p, sub }: { p: Profile; sub: string }) {
  return (
    <Link to="/profile/$id" params={{ id: p.id }} className="mt-2 flex items-center gap-3">
      <img src={p.photos[0]} alt={p.name} className="size-14 rounded-2xl object-cover" />
      <div><b>{p.name}, {p.age}</b><p className="text-sm text-muted-foreground">{sub}</p></div>
    </Link>
  );
}
