import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowLeft,
  Heart,
  X,
  MapPin,
  Briefcase,
  Flag,
  GraduationCap,
  Ban,
  Languages,
  Gem,
} from "lucide-react";
import { toast } from "sonner";
import { Phone } from "@/components/milo/Phone";
import { ReportDialog, ConfirmDialog } from "@/components/milo/SafetyDialogs";
import { block, profileById, superLike, swipe, useMilo, lastSeen } from "@/lib/milo-store";
import { compatibility } from "@/lib/compat";

export const Route = createFileRoute("/profile/$id")({
  head: () => ({
    meta: [
      { title: "Profile — Milo" },
      { name: "description", content: "View a profile on Milo." },
      { property: "og:title", content: "Profile — Milo" },
      { property: "og:description", content: "View a profile on Milo." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { id } = Route.useParams();
  useMilo((s) => s.people); // re-render once real members finish loading
  const p = profileById(id)!;
  const nav = useNavigate();
  const done = useMilo((s) => !!s.swiped[id]);
  const isMatch = useMilo((s) => s.matches.includes(id));
  const myMe = useMilo((s) => s.me);
  const compat = compatibility(myMe, p);
  const seen = useMilo((s) => lastSeen(s, p));
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const act = (d: "like" | "pass") => {
    const r = swipe(id, d);
    if (r === "limit") {
      toast("You're out of likes for today");
      nav({ to: "/premium" });
      return;
    }
    nav(r === "match" ? { to: "/match/$id", params: { id } } : { to: "/discover" });
  };
  const priority = () => {
    const r = superLike(id);
    if (r === "locked") {
      toast("Priority Likes are a Premium feature");
      return;
    }
    if (r === "none-left") {
      toast("No Priority Likes left today");
      return;
    }
    if (r === "limit") {
      toast("You're out of likes for today");
      return;
    }
    if (r === "ok") toast.success("Priority Like sent (demo)");
    nav(r === "match" ? { to: "/match/$id", params: { id } } : { to: "/discover" });
  };

  return (
    <Phone auth className="pb-28">
      <div className="relative">
        <div className="flex snap-x snap-mandatory overflow-x-auto no-scrollbar">
          {p.photos.map((ph, k) => (
            <img
              key={ph}
              src={ph}
              alt={`${p.name} photo ${k + 1}`}
              loading={k ? "lazy" : undefined}
              className="aspect-[3/4] w-full shrink-0 snap-center object-cover"
            />
          ))}
        </div>
        <Link
          to={isMatch ? "/chat/$id" : "/discover"}
          params={{ id }}
          aria-label="Back"
          className="absolute left-4 top-6 grid size-10 place-items-center rounded-full bg-card/90"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <span className="absolute bottom-3 right-3 rounded-full bg-ink/60 px-2 py-0.5 text-xs text-ink-foreground">
          Swipe for {p.photos.length} photos
        </span>
      </div>
      <div className="space-y-5 px-5 pt-5">
        <div>
          <h1 className="text-3xl font-semibold">
            {p.name}, {p.age}
          </h1>
          <p className="mt-1 flex items-center gap-1 text-muted-foreground">
            <MapPin className="size-4" /> {p.city} · ~{p.distanceKm} km away
          </p>
          {seen && <p className="mt-0.5 text-xs font-semibold text-success">{seen}</p>}
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-sm font-semibold">
            <span className="font-display text-2xl text-primary">{compat.score}%</span>{" "}
            compatibility estimate{" "}
            <span className="block text-xs font-normal text-muted-foreground">
              Based on simple, visible rules. Not AI and not a scientific prediction.
            </span>
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {compat.reasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
        </div>
        <span className="inline-block rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground">
          Looking for: {p.intent}
        </span>
        <p className="leading-relaxed">{p.bio}</p>
        {p.prompt && (
          <div className="rounded-2xl bg-card p-4 shadow-card">
            <p className="text-sm font-semibold text-primary">{p.prompt.q}</p>
            <p className="mt-1 font-display text-xl">{p.prompt.a}</p>
          </div>
        )}
        <div className="space-y-2 text-sm">
          {p.work && (
            <p className="flex items-center gap-2">
              <Briefcase className="size-4 text-muted-foreground" /> {p.work}
            </p>
          )}
          {p.languages.length > 0 && (
            <p className="flex items-center gap-2">
              <Languages className="size-4 text-muted-foreground" /> Speaks {p.languages.join(", ")}
            </p>
          )}
          {p.education && (
            <p className="flex items-center gap-2">
              <GraduationCap className="size-4 text-muted-foreground" /> {p.education}
            </p>
          )}
        </div>
        <div>
          <h2 className="mb-2 font-sans text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Interests
          </h2>
          <div className="flex flex-wrap gap-2">
            {p.interests.map((i) => (
              <span key={i} className="rounded-full border bg-card px-3 py-1 text-sm">
                {i}
              </span>
            ))}
          </div>
        </div>
        <div>
          <h2 className="mb-2 font-sans text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Lifestyle
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(p.lifestyle).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-card px-3 py-2 text-sm">
                <span className="block text-xs text-muted-foreground">{k}</span>
                {v}
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-5 border-t pt-4">
          <button
            onClick={() => setReportOpen(true)}
            className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"
          >
            <Flag className="size-4" /> Report
          </button>
          <button
            onClick={() => setBlockOpen(true)}
            className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"
          >
            <Ban className="size-4" /> Block
          </button>
        </div>
      </div>
      {!done && (
        <div className="sticky bottom-4 mt-6 flex justify-center gap-6">
          <button
            aria-label="Pass"
            onClick={() => act("pass")}
            className="grid size-16 place-items-center rounded-full border bg-card shadow-card"
          >
            <X className="size-8" />
          </button>
          <button
            aria-label="Priority Like"
            onClick={priority}
            className="grid size-16 place-items-center rounded-full border bg-card text-highlight shadow-card"
          >
            <Gem className="size-7" />
          </button>
          <button
            aria-label="Like"
            onClick={() => act("like")}
            className="grid size-16 place-items-center rounded-full bg-brand text-primary-foreground shadow-glow"
          >
            <Heart className="size-8" fill="currentColor" />
          </button>
        </div>
      )}
      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        targetId={id}
        name={p.name}
        onDone={() => nav({ to: "/discover" })}
      />
      <ConfirmDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        danger
        title={`Block ${p.name}?`}
        body="You won't see each other anywhere on Milo. Any match and chat will be removed."
        confirm="Block"
        onConfirm={() => {
          block(id);
          toast(`${p.name} is blocked`);
          nav({ to: "/discover" });
        }}
      />
    </Phone>
  );
}
