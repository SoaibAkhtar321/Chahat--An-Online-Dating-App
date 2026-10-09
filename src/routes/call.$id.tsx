import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, SwitchCamera, PhoneOff, Phone as PhoneIcon, AlertTriangle, FastForward } from "lucide-react";
import { Phone, btnPrimary, btnGhost, btnDanger } from "@/components/milo/Phone";
import { can, canMessage, mainPhoto, activeRate, freeSecondsFor, getState, markFreeUsed, notify, profileById, setState, uid, useMilo, type CallRecord } from "@/lib/milo-store";
import { meta } from "@/lib/meta";

type Search = { mode: "video" | "audio"; incoming: boolean };
export const Route = createFileRoute("/call/$id")({
  validateSearch: (s: Record<string, unknown>): Search => ({ mode: s["mode"] === "audio" ? "audio" : "video", incoming: s["incoming"] === true || s["incoming"] === "true" }),
  head: () => meta("Call", "Video and voice calls with your matches on Milo."),
  component: CallPage,
});

function CallPage() {
  return <Phone auth className="bg-ink text-ink-foreground"><CallInner /></Phone>;
}

type PhaseT = "incoming" | "ringing" | "connecting" | "active" | "consent" | "paid" | "ended";
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function CallInner() {
  const { id } = Route.useParams();
  useMilo((s) => s.people); // re-render once real members finish loading
  const { mode: initialMode, incoming } = Route.useSearch();
  const nav = useNavigate();
  const p = profileById(id)!;
  const myPhoto = useMilo((s) => mainPhoto(s.me));
  const cfg = useMilo((s) => s.callConfig);
  const [phase, setPhase] = useState<PhaseT>(incoming ? "incoming" : "ringing");
  const [mode] = useState(initialMode);
  const [sec, setSec] = useState(0);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [front, setFront] = useState(true);
  const [outcome, setOutcome] = useState<CallRecord["outcome"]>("completed");
  const [endNote, setEndNote] = useState("");
  const free = useRef(freeSecondsFor(id)).current; // the server decides this in production
  const rate = useRef(activeRate()).current; // locked at call start
  // PROVISIONAL rule (owner approval needed): "premium_continue" lets a Premium caller keep talking without a per-minute price.
  const covered = useRef(getState().callConfig.paidRule === "premium_continue" && can(getState(), "longerCalls")).current;
  const warnAt = Math.max(0, Math.min(cfg.warnAt, free - 5));
  const paidSec = Math.max(0, sec - free);
  const units = rate ? Math.ceil(paidSec / rate.incrementSec) : 0;
  const est = rate ? Math.round(units * (rate.incrementSec / 60) * rate.ratePerMin! * (1 + (rate.taxPct ?? 0) / 100) * 100) / 100 : 0;

  // Only matched, unblocked people can be called.
  useEffect(() => { if (!canMessage(id)) finish("failed", "You can only call people you're matched with."); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // simulated connection flow
  useEffect(() => {
    if (phase === "ringing") { const t = setTimeout(() => setPhase("connecting"), 2500); return () => clearTimeout(t); }
    if (phase === "connecting") { const t = setTimeout(() => setPhase(free > 0 ? "active" : "consent"), 1500); return () => clearTimeout(t); }
    return undefined;
  }, [phase, free]);
  // timer (display only — billing would use server timestamps)
  useEffect(() => {
    if (phase !== "active" && phase !== "paid") return;
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  useEffect(() => {
    if (phase === "active" && sec >= free) { markFreeUsed(id); setPhase("consent"); }
    if (phase === "paid" && rate?.maxMinutes && paidSec >= rate.maxMinutes * 60) finish("completed", "Maximum paid call length reached.");
  }, [sec, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  function finish(o: CallRecord["outcome"], note = "") {
    if (phase === "ended") return;
    if (sec > 0 && sec < free) markFreeUsed(id);
    setOutcome(o); setEndNote(note); setPhase("ended");
    const rec: CallRecord = { id: uid(), with: id, at: Date.now(), mode, direction: incoming ? "in" : "out", outcome: o, freeSec: Math.min(sec, free), paidSec,
      ...(rate && paidSec ? { currency: rate.currency, estCost: est } : {}) };
    setState((s) => ({ calls: [rec, ...s.calls] }));
    if (o === "missed") notify("call", `Missed call ${incoming ? "from" : "to"} ${p.name}`, `/chat/${id}`);
  }

  if (phase === "ended") {
    return (
      <div className="flex h-full flex-col items-center px-6 py-14 text-center">
        <img src={p.photos[0]} alt="" className="size-24 rounded-full object-cover" />
        <h1 className="mt-4 text-3xl font-semibold">{outcome === "completed" ? "Call ended" : outcome === "missed" ? "No answer" : outcome === "declined" ? "Call declined" : "Call failed"}</h1>
        {endNote && <p className="mt-1 opacity-80">{endNote}</p>}
        <div className="mt-8 w-full space-y-2 rounded-2xl bg-ink-foreground/10 p-5 text-left text-sm">
          <Row k="With" v={p.name} /><Row k="Duration" v={mmss(sec)} /><Row k="Free time used" v={mmss(Math.min(sec, free))} />
          <Row k="Paid time" v={mmss(paidSec)} />
          {rate && paidSec > 0 && <Row k="Estimated cost" v={`${rate.currency} ${est.toFixed(2)}`} />}
          <p className="pt-2 text-xs opacity-70">Demo: no money was charged. In the real app, the final amount comes from server records and appears in billing history.</p>
        </div>
        <div className="mt-auto w-full space-y-2">
          <Link to="/chat/$id" params={{ id }} className={btnPrimary}>Back to chat</Link>
          <Link to="/calls" className={`${btnGhost} border-ink-foreground/30 bg-transparent`}>Call history & help</Link>
        </div>
      </div>
    );
  }

  const remoteVisible = mode === "video" && (phase === "active" || phase === "paid" || phase === "consent");
  return (
    <div className="relative h-full">
      <img src={p.photos[0]} alt="" className={`absolute inset-0 size-full object-cover transition ${remoteVisible ? (phase === "consent" ? "blur-xl brightness-50" : "") : "blur-2xl brightness-[0.35]"}`} />
      <div className="relative flex h-full flex-col items-center px-6 pb-8 pt-12">
        {!remoteVisible && (
          <div className="mt-10 text-center">
            <img src={p.photos[0]} alt="" className={`mx-auto size-28 rounded-full border-4 border-ink-foreground/30 object-cover ${phase === "ringing" || phase === "incoming" ? "animate-pulse" : ""}`} />
            <h1 className="mt-4 text-3xl font-semibold">{p.name}</h1>
            <p className="mt-1 opacity-80">{phase === "incoming" ? `Incoming ${mode} call…` : phase === "ringing" ? "Ringing…" : phase === "connecting" ? "Connecting…" : mode === "audio" ? mmss(sec) : ""}</p>
          </div>
        )}
        {(phase === "active" || phase === "paid") && (
          <div className="flex w-full flex-col items-center gap-2">
            <span className="rounded-full bg-ink/70 px-3 py-1 text-sm font-semibold tabular-nums">{phase === "active" ? `Free · ${mmss(Math.max(0, free - sec))} left` : `Paid · ${mmss(paidSec)} · ~${rate!.currency} ${est.toFixed(2)}`}</span>
            {phase === "active" && sec >= warnAt && (
              <div role="alert" className="flex items-center gap-2 rounded-2xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"><AlertTriangle className="size-4" /> Free time ends in {free - sec}s. You'll be asked before anything is charged.</div>
            )}
          </div>
        )}
        {mode === "video" && (phase === "active" || phase === "paid") && (
          <div className="absolute right-4 top-28 h-36 w-24 overflow-hidden rounded-2xl border-2 border-ink-foreground/40 bg-ink">
            {camOff ? <div className="grid size-full place-items-center text-xs opacity-70">Camera off</div> : <img src={myPhoto} alt="You" className={`size-full object-cover ${front ? "" : "scale-x-[-1]"}`} />}
          </div>
        )}

        <div className="mt-auto w-full">
          {phase === "incoming" ? (
            <div className="flex justify-around">
              <button aria-label="Decline" onClick={() => finish("declined")} className="grid size-18 place-items-center rounded-full bg-destructive text-destructive-foreground"><PhoneOff className="size-7" /></button>
              <button aria-label="Accept" onClick={() => setPhase("connecting")} className="grid size-18 place-items-center rounded-full bg-success text-ink-foreground"><PhoneIcon className="size-7" /></button>
            </div>
          ) : phase !== "consent" && (
            <>
              <div className="flex items-center justify-center gap-4">
                <Ctl label={muted ? "Unmute" : "Mute"} on={muted} onClick={() => setMuted(!muted)}>{muted ? <MicOff /> : <Mic />}</Ctl>
                {mode === "video" && <Ctl label={camOff ? "Turn camera on" : "Turn camera off"} on={camOff} onClick={() => setCamOff(!camOff)}>{camOff ? <VideoOff /> : <Video />}</Ctl>}
                {mode === "video" && <Ctl label="Switch camera" onClick={() => setFront(!front)}><SwitchCamera /></Ctl>}
                <button aria-label="End call" onClick={() => finish(phase === "ringing" || phase === "connecting" ? "missed" : "completed")} className="grid size-16 place-items-center rounded-full bg-destructive text-destructive-foreground"><PhoneOff className="size-7" /></button>
              </div>
              <div className="mt-4 flex justify-center gap-4 text-xs opacity-80">
                {(phase === "active" || phase === "paid") && <button onClick={() => setSec((s) => s + 15)} className="flex items-center gap-1 underline"><FastForward className="size-3" /> Demo: skip 15s</button>}
                {phase === "ringing" && <button onClick={() => finish("missed")} className="underline">Demo: no answer</button>}
                {phase === "ringing" && <button onClick={() => finish("failed", "Calling is temporarily unavailable. No time or money was used. Please try again later.")} className="underline">Demo: call service unavailable</button>}
                {phase === "connecting" && <button onClick={() => finish("failed", "Couldn't connect. Check your internet and try again.")} className="underline">Demo: connection fails</button>}
              </div>
            </>
          )}
        </div>
      </div>

      {phase === "consent" && (
        <div className="absolute inset-x-0 bottom-0 z-10 rounded-t-3xl bg-card p-6 text-card-foreground" role="dialog" aria-labelledby="consent-title">
          <h2 id="consent-title" className="text-2xl font-semibold">{free > 0 ? "Your free minute is up" : "Free time already used"}</h2>
          {covered ? (
            <>
              <p className="mt-2 text-muted-foreground">Your Premium plan includes longer calls (provisional demo rule, awaiting approval). No per-minute charge applies.</p>
              <div className="mt-4 space-y-2">
                <button className={btnPrimary} onClick={() => setPhase("paid")}>Continue call</button>
                <button className={btnGhost} onClick={() => finish("completed", "You ended the call.")}>End call</button>
              </div>
            </>
          ) : rate ? (
            <>
              <p className="mt-2 text-muted-foreground">To keep talking with {p.name}, calling continues at:</p>
              <p className="mt-3 font-display text-4xl font-semibold">{rate.currency} {rate.ratePerMin!.toFixed(2)}<span className="font-sans text-base font-medium text-muted-foreground"> / min</span></p>
              <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
                <li>• Charged per {rate.incrementSec} seconds, rounded up</li>
                <li>• {rate.taxPct != null ? `Taxes: ${rate.taxPct}%` : "Taxes: shown before payment"}</li>
                {rate.maxMinutes && <li>• Calls stop automatically after {rate.maxMinutes} paid minutes</li>}
                <li>• You can end the call at any time</li>
              </ul>
              <p className="mt-3 rounded-xl bg-secondary p-3 text-xs">Demo: no payment will be taken. In the real app, payment goes through the approved store billing system.</p>
              <div className="mt-4 space-y-2">
                <button className={btnPrimary} onClick={() => setPhase("paid")}>Continue at {rate.currency} {rate.ratePerMin!.toFixed(2)}/min</button>
                <button className={btnGhost} onClick={() => finish("completed", "You chose not to continue with paid calling.")}>No thanks, end call</button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-muted-foreground">Paid calling isn't available right now because the price for your region hasn't been confirmed. You won't be charged.</p>
              <p className="mt-2 text-xs text-muted-foreground">Demo tip: set a price in Admin → Call pricing for region "{getState().callConfig.billingRegion}".</p>
              <button className={`${btnDanger} mt-4`} onClick={() => finish("completed", "Free time ended.")}>End call</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Ctl({ label, on, onClick, children }: { label: string; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button aria-label={label} aria-pressed={!!on} onClick={onClick} className={`grid size-14 place-items-center rounded-full ${on ? "bg-ink-foreground text-ink" : "bg-ink-foreground/20"}`}>{children}</button>;
}
function Row({ k, v }: { k: string; v: string }) { return <div className="flex justify-between"><span className="opacity-70">{k}</span><b>{v}</b></div>; }
