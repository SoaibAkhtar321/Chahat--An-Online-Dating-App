import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Pencil,
  LogOut,
  ChevronRight,
  Crown,
  Settings,
  Bell,
  PhoneCall,
  ShieldCheck,
  LayoutDashboard,
  Sparkles,
  BadgeCheck,
  BarChart3,
  Lock,
} from "lucide-react";
import { VoiceIntro } from "@/components/milo/VoiceIntro";
import { Phone, cardCls } from "@/components/milo/Phone";
import { ConfirmDialog } from "@/components/milo/SafetyDialogs";
import {
  TIER_NAMES,
  ageFrom,
  can,
  isPremium,
  mainThumb,
  setState,
  tierOf,
  useMilo,
} from "@/lib/milo-store";
import { logOut } from "@/lib/milo-cloud";
import { INTERESTS } from "./onboarding";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/me")({
  head: () => meta("Your profile", "Manage your Milo profile and settings."),
  component: Me,
});

function Me() {
  const me = useMilo((s) => s.me);
  const premium = useMilo(isPremium);
  const tier = useMilo(tierOf);
  const ver = useMilo((s) => s.verification.status);
  const insights = useMilo((s) => can(s, "insights"));
  const st = useMilo((s) => s);
  const nav = useNavigate();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const checks = [
    me.name,
    me.dob,
    me.bio,
    me.city,
    me.prompt.a,
    me.work || me.education,
    me.photos.length >= 3,
    me.interests.length >= 3,
    Object.keys(me.lifestyle).length > 0,
    me.languages.length > 0,
  ];
  const pct = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  const rows = [
    {
      icon: Pencil,
      label: "Edit profile & photos",
      on: () => {
        setState(() => ({ onboardingStep: 0 }));
        nav({ to: "/onboarding" });
      },
    },
    {
      icon: Crown,
      label: premium ? `${TIER_NAMES[tier]} · active (test)` : "Get Premium",
      on: () => nav({ to: "/premium" }),
    },
    {
      icon: BadgeCheck,
      label:
        ver === "approved"
          ? "Verified"
          : ver === "pending"
            ? "Verification · in review"
            : "Verify your profile",
      on: () => nav({ to: "/verification" }),
    },
    { icon: Sparkles, label: "Explore (demo previews)", on: () => nav({ to: "/explore" }) },
    { icon: Bell, label: "Notifications", on: () => nav({ to: "/notifications" }) },
    { icon: PhoneCall, label: "Calls & billing", on: () => nav({ to: "/calls" }) },
    { icon: Settings, label: "Settings & privacy", on: () => nav({ to: "/settings" }) },
    { icon: ShieldCheck, label: "Safety centre", on: () => nav({ to: "/safety" }) },
    { icon: LogOut, label: "Log out", on: () => setLogoutOpen(true) },
  ];
  return (
    <Phone auth tabs className="px-5 pt-8 pb-6">
      <div className="text-center">
        <div className="relative mx-auto size-28">
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100" aria-hidden>
            <circle cx="50" cy="50" r="47" fill="none" strokeWidth="5" className="stroke-muted" />
            <circle
              cx="50"
              cy="50"
              r="47"
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              className="stroke-primary"
              strokeDasharray={`${pct * 2.95} 400`}
            />
          </svg>
          <img
            src={mainThumb(me)}
            alt=""
            className="absolute inset-2 size-24 rounded-full object-cover"
          />
        </div>
        <h1 className="mt-3 text-2xl font-semibold">
          {me.name || "Your name"}
          {me.dob ? `, ${ageFrom(me.dob)}` : ""}{" "}
          {premium && <Crown className="inline size-5 text-accent" />}
        </h1>
        <p className="mt-1 text-xs font-semibold text-muted-foreground">
          {ver === "approved" ? (
            <span className="inline-flex items-center gap-1 text-highlight">
              <BadgeCheck className="size-4" /> Verified (demo review)
            </span>
          ) : ver === "pending" ? (
            "Verification requested · waiting for review (demo)"
          ) : ver === "rejected" ? (
            "Verification not approved · you can try again"
          ) : (
            "Not verified"
          )}
        </p>
        <p className="text-muted-foreground">
          {me.city || "City not set"} · Profile {pct}% complete
        </p>
        {pct < 100 && (
          <p className="mx-auto mt-2 max-w-xs text-xs text-muted-foreground">
            To finish:{" "}
            {[
              !me.prompt.a && "a prompt",
              me.photos.length < 3 && "3+ photos",
              !(me.work || me.education) && "work or education",
              !Object.keys(me.lifestyle).length && "lifestyle",
              !me.languages.length && "languages you speak",
            ]
              .filter(Boolean)
              .join(", ")}
            .
          </p>
        )}
        {me.languages.length > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">Speaks {me.languages.join(", ")}</p>
        )}
        {me.interests.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {me.interests.map((i) => (
              <span
                key={i}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${INTERESTS.includes(i) ? "border bg-card" : "bg-highlight text-highlight-foreground"}`}
              >
                {i}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="mt-6">
        <VoiceIntro />
      </div>
      <div className={`${cardCls} mt-4 p-4`}>
        <p className="flex items-center gap-2 font-semibold">
          <BarChart3 className="size-4 text-primary" /> Profile insights{" "}
          {!insights && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
              <Lock className="size-3" /> Premium Pro
            </span>
          )}
        </p>
        {insights ? (
          (() => {
            const v = Object.values(st.swiped);
            const likes = v.filter((x) => x === "like").length;
            const sent = Object.values(st.messages)
              .flat()
              .filter((m) => m.from === "me").length;
            return (
              <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs">
                {[
                  ["Likes sent", likes],
                  ["Passes", v.length - likes],
                  ["Matches", st.matches.length],
                  ["Messages", sent],
                ].map(([k, n]) => (
                  <div key={k} className="rounded-xl bg-muted p-2">
                    <b className="block font-display text-xl">{n}</b>
                    {k}
                  </div>
                ))}
                <p className="col-span-4 text-left text-muted-foreground">
                  Based only on your own activity in this browser. Who viewed you isn't tracked in
                  the demo.
                </p>
              </div>
            );
          })()
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            See a summary of your own activity. Included in Premium Pro (plan contents pending
            approval).
          </p>
        )}
      </div>
      <div className={`${cardCls} mt-4`}>
        {rows.map(({ icon: Icon, label, on }) => (
          <button
            key={label}
            onClick={on}
            className="flex w-full items-center gap-3 border-b px-4 py-3.5 text-left last:border-0"
          >
            <Icon className="size-5 text-primary" />
            <span className="flex-1 font-medium">{label}</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        ))}
      </div>
      <Link
        to="/admin"
        className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold text-muted-foreground"
      >
        <LayoutDashboard className="size-4" /> Admin dashboard (demo)
      </Link>
      <ConfirmDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title="Log out?"
        body="Your profile and chats are kept for when you log back in (stored in this browser only)."
        confirm="Log out"
        onConfirm={async () => {
          await logOut();
          nav({ to: "/" });
        }}
      />
    </Phone>
  );
}
