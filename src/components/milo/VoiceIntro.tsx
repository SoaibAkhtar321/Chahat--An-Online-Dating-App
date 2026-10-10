import { useEffect, useRef, useState } from "react";
import { Mic, Square, Play, Pause, RotateCcw, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { setState, useMilo } from "@/lib/milo-store";
import { ConfirmDialog } from "./SafetyDialogs";

const MAX_SEC = 30,
  MIN_SEC = 3;

/** Voice intro (demo): records with the browser microphone. The clip stays in this browser only; nothing is uploaded. */
export function VoiceIntro() {
  const saved = useMilo((s) => s.me.voice);
  const [phase, setPhase] = useState<"idle" | "recording" | "preview">("idle");
  const [draft, setDraft] = useState<{ src: string; sec: number } | null>(null);
  const [sec, setSec] = useState(0);
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);
  const started = useRef(0);

  const cleanup = () => {
    if (timer.current) window.clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(
    () => () => {
      if (rec.current?.state === "recording") {
        rec.current.stop();
      }
      cleanup();
    },
    [],
  );

  const start = async () => {
    setErr("");
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setErr("Voice recording isn't supported in this browser.");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const r = new MediaRecorder(s);
      rec.current = r;
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        const len = Math.round((Date.now() - started.current) / 1000);
        cleanup();
        if (len < MIN_SEC) {
          setPhase("idle");
          setErr(`Too short. Record at least ${MIN_SEC} seconds.`);
          return;
        }
        const fr = new FileReader();
        fr.onload = () => {
          setDraft({ src: String(fr.result), sec: Math.min(len, MAX_SEC) });
          setPhase("preview");
        };
        fr.onerror = () => {
          setPhase("idle");
          setErr("Couldn't process the recording. Try again.");
        };
        fr.readAsDataURL(new Blob(chunks, { type: r.mimeType || "audio/webm" }));
      };
      started.current = Date.now();
      setSec(0);
      r.start();
      setPhase("recording");
      timer.current = window.setInterval(() => {
        const n = Math.floor((Date.now() - started.current) / 1000);
        setSec(n);
        if (n >= MAX_SEC && r.state === "recording") r.stop();
      }, 250);
    } catch (e) {
      cleanup();
      const name = (e as DOMException)?.name;
      setErr(
        name === "NotAllowedError"
          ? "Microphone access was blocked. Allow it in your browser settings to record."
          : name === "NotFoundError"
            ? "No microphone found on this device."
            : "Couldn't start recording. Try again.",
      );
    }
  };
  const stop = () => rec.current?.state === "recording" && rec.current.stop();
  const save = () => {
    if (!draft) return;
    setState((s) => ({ me: { ...s.me, voice: { ...draft, at: Date.now() } } }));
    setDraft(null);
    setPhase("idle");
    toast.success("Voice intro saved in this browser (demo, not uploaded)");
  };

  return (
    <div className="rounded-2xl border bg-card p-4" aria-label="Voice intro">
      <div className="flex items-center justify-between">
        <p className="font-semibold">
          Voice intro{" "}
          <span className="text-xs font-normal text-muted-foreground">(optional, demo)</span>
        </p>
        {saved && phase === "idle" && (
          <span className="flex items-center gap-1 text-xs font-semibold text-success">
            <Check className="size-3" /> Saved · {saved.sec}s
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Up to {MAX_SEC} seconds. Kept only in this browser; in the real app it would be uploaded and
        reviewed.
      </p>
      {phase === "recording" && (
        <div className="mt-3 flex items-center gap-3">
          <span className="size-3 animate-pulse rounded-full bg-destructive" />
          <span className="font-mono text-sm" aria-live="polite">
            0:{String(sec).padStart(2, "0")} / 0:{MAX_SEC}
          </span>
          <button
            onClick={stop}
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground"
          >
            <Square className="size-4" /> Stop
          </button>
        </div>
      )}
      {phase === "preview" && draft && (
        <div className="mt-3 space-y-2">
          <Player src={draft.src} label="Preview" />
          <div className="flex gap-2">
            <button
              onClick={save}
              className="flex-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Use this ({draft.sec}s)
            </button>
            <button
              onClick={() => {
                setDraft(null);
                start();
              }}
              className="inline-flex items-center gap-1 rounded-full border px-4 py-2 text-sm font-semibold"
            >
              <RotateCcw className="size-4" /> Re-record
            </button>
          </div>
        </div>
      )}
      {phase === "idle" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {saved && <Player src={saved.src} label="Play" />}
          <button
            onClick={start}
            className="inline-flex items-center gap-1 rounded-full border px-4 py-2 text-sm font-semibold"
          >
            <Mic className="size-4" /> {saved ? "Re-record" : "Record"}
          </button>
          {saved && (
            <button
              onClick={() => setConfirmDel(true)}
              className="inline-flex items-center gap-1 rounded-full border px-4 py-2 text-sm font-semibold text-destructive"
            >
              <Trash2 className="size-4" /> Remove
            </button>
          )}
        </div>
      )}
      {err && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {err}
        </p>
      )}
      <ConfirmDialog
        open={confirmDel}
        onOpenChange={setConfirmDel}
        danger
        title="Remove voice intro?"
        body="The recording will be deleted from this browser."
        confirm="Remove"
        onConfirm={() => {
          setState((s) => ({ me: { ...s.me, voice: null } }));
          toast("Voice intro removed");
        }}
      />
    </div>
  );
}

export function Player({ src, label }: { src: string; label: string }) {
  const a = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const toggle = () => {
    const el = a.current;
    if (!el) return;
    if (on) {
      el.pause();
      setOn(false);
    } else
      el.play()
        .then(() => setOn(true))
        .catch(() => toast.error("Couldn't play this recording"));
  };
  return (
    <>
      <audio ref={a} src={src} onEnded={() => setOn(false)} preload="metadata" />
      <button
        onClick={toggle}
        aria-label={on ? "Pause voice intro" : `${label} voice intro`}
        className="inline-flex items-center gap-1 rounded-full bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground"
      >
        {on ? <Pause className="size-4" /> : <Play className="size-4" />} {on ? "Pause" : label}
      </button>
    </>
  );
}
