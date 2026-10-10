import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, MapPin, X, Navigation, Plus } from "lucide-react";
import { toast } from "sonner";
import { Phone, Chip, Field, inputCls, btnPrimary, btnGhost } from "@/components/milo/Phone";
import { ageFrom, mainPhoto, setState, useMilo, type MeProfile, LANGUAGES } from "@/lib/milo-store";
import { PhotoManager } from "@/components/milo/PhotoManager";
import { Player } from "@/components/milo/VoiceIntro";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/onboarding")({
  head: () => meta("Set up your profile", "Tell Milo about yourself and who you'd like to meet."),
  component: Onboarding,
});

export const INTERESTS = [
  "Travel",
  "Coffee",
  "Cricket",
  "Bollywood",
  "Books",
  "Yoga",
  "Foodie",
  "Music",
  "Hiking",
  "Photography",
  "Gaming",
  "Dance",
  "Cooking",
  "Art",
];
const CITIES = [
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Hyderabad",
  "Chennai",
  "Kolkata",
  "Pune",
  "Jaipur",
  "Ahmedabad",
];
const PROMPTS = [
  "My ideal Sunday",
  "Green flag",
  "Two truths and a lie",
  "I'm weirdly good at",
  "Best trip ever",
  "Hot take",
];
const LIFESTYLE: Record<string, string[]> = {
  Drinking: ["Never", "Socially", "Often"],
  Smoking: ["Never", "Socially", "Regularly"],
  Workout: ["Rarely", "Sometimes", "Often"],
  Diet: ["Vegetarian", "Eggetarian", "Non-veg", "Vegan", "Jain"],
};
export const STEPS = [
  "name",
  "dob",
  "gender",
  "intents",
  "location",
  "work",
  "languages",
  "bio",
  "interests",
  "lifestyle",
  "photos",
  "prefs",
] as const;
const TOTAL = STEPS.length;
export const stepOf = (k: (typeof STEPS)[number]) => STEPS.indexOf(k);

const CUSTOM_MAX_LEN = 24,
  CUSTOM_MAX = 10;
const norm = (v: string) => v.trim().replace(/\s+/g, " ");
/** Validates a custom hobby. Returns an error, or the cleaned value (matching an existing preset if it differs only by case). */
export function checkCustomInterest(
  raw: string,
  current: string[],
): { error: string } | { value: string } {
  const v = norm(raw);
  if (!v) return { error: "Type a hobby first" };
  if (v.length > CUSTOM_MAX_LEN) return { error: `Keep it under ${CUSTOM_MAX_LEN} characters` };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} &'+-]*$/u.test(v))
    return { error: "Use letters, numbers, spaces, & or -" };
  if (current.some((x) => x.toLowerCase() === v.toLowerCase())) return { error: "Already added" };
  const preset = INTERESTS.find((x) => x.toLowerCase() === v.toLowerCase());
  if (!preset && current.filter((x) => !INTERESTS.includes(x)).length >= CUSTOM_MAX)
    return { error: `Up to ${CUSTOM_MAX} custom hobbies` };
  return { value: preset ?? v };
}
const MIN_DOB = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().slice(0, 10);
})();

const toggle = (list: string[], v: string) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

function Onboarding() {
  const nav = useNavigate();
  const step = useMilo((s) => s.onboardingStep);
  const onboarded = useMilo((s) => s.onboarded);
  const me = useMilo((s) => s.me);
  const INTENTS = useMilo((s) => s.intentOptions);
  const [err, setErr] = useState("");
  const [custom, setCustom] = useState("");
  const showAge = useMilo((s) => s.settings.privacy["Show my age"]);
  const up = (p: Partial<MeProfile>) => {
    setErr("");
    setState((s) => ({ me: { ...s.me, ...p } }));
  };
  const go = (n: number) => {
    setErr("");
    setState(() => ({ onboardingStep: Math.max(0, Math.min(TOTAL, n)) }));
  };
  const key = STEPS[step];

  const validate = (): string => {
    switch (key) {
      case "name":
        return me.name.trim().length < 2
          ? "Enter your first name"
          : /[^\p{L}\s'-]/u.test(me.name)
            ? "Use letters only"
            : "";
      case "dob": {
        const a = ageFrom(me.dob);
        const d = new Date(me.dob);
        return !me.dob
          ? "Enter your date of birth"
          : Number.isNaN(d.getTime())
            ? "Enter a valid date"
            : d > new Date()
              ? "Date of birth can't be in the future"
              : a < 18
                ? "You must be 18 or older to use Milo"
                : a > 100
                  ? "Check your date of birth"
                  : "";
      }
      case "gender":
        return !me.gender ? "Choose an option" : "";
      case "intents":
        return me.intents.length ? "" : "Pick at least one";
      case "location":
        return me.locMode === "ask" ? "Choose an option above" : !me.city ? "Choose your city" : "";
      case "bio":
        return me.bio.trim().length < 20 ? "Write at least 20 characters" : "";
      case "interests":
        return me.interests.length < 3 ? "Pick at least 3 interests" : "";
      case "photos":
        return me.photos.length < 1 ? "Add at least one photo" : "";
      default:
        return "";
    }
  };
  const next = () => {
    const e = validate();
    if (e) return setErr(e);
    go(step + 1);
  };

  const addCustom = () => {
    const r = checkCustomInterest(custom, me.interests);
    if ("error" in r) return setErr(r.error);
    up({ interests: [...me.interests, r.value] });
    setCustom("");
  };

  const finish = () => {
    setState(() => ({ onboarded: true }));
    toast.success(onboarded ? "Profile saved" : "Welcome to Milo!");
    nav({ to: onboarded ? "/me" : "/discover" });
  };

  const body = () => {
    switch (key) {
      case "name":
        return (
          <Q t="What's your first name?" d="This is how you'll appear on Milo.">
            <input
              className={inputCls}
              value={me.name}
              onChange={(e) => up({ name: e.target.value })}
              placeholder="First name"
              maxLength={30}
              autoFocus
            />
          </Q>
        );
      case "dob":
        return (
          <Q t="When's your birthday?" d="Only your age is shown. Milo is strictly 18+.">
            <input
              type="date"
              max={MIN_DOB}
              className={inputCls}
              value={me.dob}
              onChange={(e) => up({ dob: e.target.value })}
            />
            {me.dob && (
              <p className="mt-3 text-sm text-muted-foreground">
                You're <b className="text-foreground">{ageFrom(me.dob)}</b>. You can't change this
                later.
              </p>
            )}
          </Q>
        );
      case "gender":
        return (
          <Q t="I am a…" d="Milo currently matches men with women.">
            <div className="flex gap-2">
              {(["man", "woman"] as const).map((g) => (
                <Chip
                  key={g}
                  active={me.gender === g}
                  onClick={() => up({ gender: g, seeking: g === "man" ? "woman" : "man" })}
                >
                  {g === "man" ? "Man" : "Woman"}
                </Chip>
              ))}
            </div>
            {me.seeking && (
              <p className="mt-5 rounded-2xl bg-secondary p-4 text-sm">
                You'll be shown <b>{me.seeking === "woman" ? "women" : "men"}</b>.
              </p>
            )}
          </Q>
        );
      case "intents":
        return (
          <Q
            t="What are you looking for?"
            d="People with the same intentions are shown to you first. Pick as many as apply."
          >
            <div className="flex flex-wrap gap-2">
              {INTENTS.map((i) => (
                <Chip
                  key={i}
                  active={me.intents.includes(i)}
                  onClick={() => up({ intents: toggle(me.intents, i) })}
                >
                  {i}
                </Chip>
              ))}
            </div>
          </Q>
        );
      case "location":
        return (
          <Q
            t="Find people near you"
            d="Your location helps show nearby people. Others only see an approximate distance, never where you are."
          >
            {me.locMode === "ask" && (
              <div className="space-y-3">
                <div className="flex gap-3 rounded-2xl bg-secondary p-4 text-sm">
                  <MapPin className="size-5 shrink-0 text-primary" />
                  <span>We never show your exact location or address.</span>
                </div>
                <button
                  className={btnPrimary}
                  onClick={() => {
                    up({ locMode: "granted", city: me.city || "Mumbai" });
                    toast("Location allowed (demo — no real location used)");
                  }}
                >
                  <Navigation className="mr-2 size-4" /> Allow location
                </button>
                <button className={btnGhost} onClick={() => up({ locMode: "denied" })}>
                  Not now, I'll pick my city
                </button>
                <button
                  className="w-full text-center text-xs text-muted-foreground underline"
                  onClick={() => up({ locMode: "unavailable" })}
                >
                  Simulate "location unavailable"
                </button>
              </div>
            )}
            {me.locMode !== "ask" && (
              <div className="space-y-3">
                <p className="text-sm">
                  {me.locMode === "granted"
                    ? "📍 Approximate area found (demo). Correct it if needed:"
                    : me.locMode === "denied"
                      ? "No problem. Pick your city instead:"
                      : "We couldn't get your location. Pick your city instead:"}
                </p>
                <select
                  className={inputCls}
                  value={me.city}
                  onChange={(e) => up({ city: e.target.value })}
                >
                  <option value="">Select city</option>
                  {CITIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <button
                  className="text-sm font-semibold text-primary"
                  onClick={() => up({ locMode: "ask" })}
                >
                  Change location choice
                </button>
              </div>
            )}
          </Q>
        );
      case "work":
        return (
          <Q t="A bit more about you" d="All optional. Skip anything you prefer not to share.">
            <div className="space-y-4">
              <Field label="Job">
                <input
                  className={inputCls}
                  maxLength={60}
                  value={me.work}
                  onChange={(e) => up({ work: e.target.value })}
                  placeholder="e.g. Engineer at a startup"
                />
              </Field>
              <Field label="Education">
                <input
                  className={inputCls}
                  value={me.education}
                  onChange={(e) => up({ education: e.target.value })}
                  placeholder="e.g. Delhi University"
                  maxLength={60}
                />
              </Field>
            </div>
          </Q>
        );
      case "languages":
        return (
          <Q
            t="Languages you speak"
            d="Optional. Pick all that apply. Shown on your profile so people can find common ground. This doesn't change the app's language (Milo is in English)."
          >
            <div className="flex flex-wrap gap-2">
              {LANGUAGES.map((l) => (
                <Chip
                  key={l}
                  active={me.languages.includes(l)}
                  onClick={() => up({ languages: toggle(me.languages, l) })}
                >
                  {l}
                </Chip>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{me.languages.length} selected</p>
          </Q>
        );
      case "bio":
        return (
          <Q t="About you" d="A short bio and one prompt. Make it sound like you.">
            <textarea
              className={`${inputCls} h-28 py-3`}
              maxLength={300}
              value={me.bio}
              onChange={(e) => up({ bio: e.target.value })}
              placeholder="Weekend chai, Sunday cricket, always planning the next trip…"
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">{me.bio.length}/300</p>
            <Field label="Prompt (optional)">
              <select
                className={inputCls}
                value={me.prompt.q}
                onChange={(e) => up({ prompt: { ...me.prompt, q: e.target.value } })}
              >
                {PROMPTS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <input
              className={`${inputCls} mt-2`}
              value={me.prompt.a}
              maxLength={120}
              onChange={(e) => up({ prompt: { ...me.prompt, a: e.target.value } })}
              placeholder="Your answer"
            />
          </Q>
        );
      case "interests":
        return (
          <Q
            t="Your interests"
            d="Pick at least 3, or add your own. Shared interests help with matching."
          >
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map((i) => (
                <Chip
                  key={i}
                  active={me.interests.includes(i)}
                  onClick={() => up({ interests: toggle(me.interests, i) })}
                >
                  {i}
                </Chip>
              ))}
            </div>
            <p className="mb-2 mt-5 text-sm font-semibold">Add a custom hobby</p>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addCustom();
              }}
            >
              <input
                className={inputCls}
                value={custom}
                maxLength={40}
                onChange={(e) => {
                  setCustom(e.target.value);
                  setErr("");
                }}
                placeholder="e.g. Kathak, Chess, Gardening"
                aria-label="Custom hobby"
              />
              <button
                type="submit"
                aria-label="Add hobby"
                className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"
              >
                <Plus className="size-5" />
              </button>
            </form>
            {me.interests.some((i) => !INTERESTS.includes(i)) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {me.interests
                  .filter((i) => !INTERESTS.includes(i))
                  .map((i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-full bg-highlight px-3 py-1.5 text-sm font-medium text-highlight-foreground"
                    >
                      {i}
                      <button
                        aria-label={`Remove ${i}`}
                        onClick={() => up({ interests: me.interests.filter((x) => x !== i) })}
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  ))}
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{me.interests.length} selected</p>
          </Q>
        );
      case "lifestyle":
        return (
          <Q t="Lifestyle" d="Optional. Shown on your profile only if you answer.">
            <div className="space-y-4">
              {Object.entries(LIFESTYLE).map(([k, opts]) => (
                <div key={k}>
                  <p className="mb-2 text-sm font-semibold">{k}</p>
                  <div className="flex flex-wrap gap-2">
                    {opts.map((o) => (
                      <Chip
                        key={o}
                        active={me.lifestyle[k] === o}
                        onClick={() => {
                          const l = { ...me.lifestyle };
                          if (l[k] === o) delete l[k];
                          else l[k] = o;
                          up({ lifestyle: l });
                        }}
                      >
                        {o}
                      </Chip>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Q>
        );
      case "photos":
        return (
          <Q
            t="Add your photos"
            d="1 to 6 photos. Clear, recent photos of your face work best. The ★ photo is your main one; use the arrows to reorder. New photos are reviewed before others see them (demo)."
          >
            <PhotoManager photos={me.photos} onChange={(photos) => up({ photos })} />
          </Q>
        );
      case "prefs":
        return (
          <Q t="Who you'd like to see" d="You can change these anytime in Discover filters.">
            <Field label={`Age range: ${me.ageMin}–${me.ageMax}`}>
              <div className="flex gap-3">
                <input
                  aria-label="Minimum age"
                  type="range"
                  min={18}
                  max={60}
                  value={me.ageMin}
                  onChange={(e) => up({ ageMin: Math.min(+e.target.value, me.ageMax - 1) })}
                  className="w-full accent-primary"
                />
                <input
                  aria-label="Maximum age"
                  type="range"
                  min={19}
                  max={70}
                  value={me.ageMax}
                  onChange={(e) => up({ ageMax: Math.max(+e.target.value, me.ageMin + 1) })}
                  className="w-full accent-primary"
                />
              </div>
            </Field>
            <div className="mt-6">
              <Field label={`Distance: up to ${me.distance} km`}>
                <input
                  type="range"
                  min={2}
                  max={150}
                  value={me.distance}
                  onChange={(e) => up({ distance: +e.target.value })}
                  className="w-full accent-primary"
                />
              </Field>
            </div>
          </Q>
        );
      default:
        return (
          <div>
            <h1 className="text-3xl font-semibold">Looking good, {me.name || "you"}!</h1>
            <p className="mt-1 text-muted-foreground">This is how others will see you.</p>
            <div className="relative mt-5 aspect-[3/4] overflow-hidden rounded-3xl shadow-card">
              <img src={mainPhoto(me)} alt="" className="size-full object-cover" />
              <div className="absolute inset-0 bg-photo-fade" />
              <div className="absolute inset-x-0 bottom-0 p-5 text-ink-foreground">
                <p className="font-display text-3xl font-semibold">
                  {me.name}
                  {showAge ? `, ${ageFrom(me.dob)}` : ""}
                </p>
                <p className="text-sm opacity-90">
                  {me.city} · {me.intents.join(", ")}
                </p>
                <p className="mt-2 line-clamp-2 text-sm opacity-90">{me.bio}</p>
              </div>
            </div>
            {me.voice && (
              <div className="mt-4">
                <Player src={me.voice.src} label="Play" />
              </div>
            )}
            {me.languages.length > 0 && (
              <p className="mt-4 text-sm">
                <span className="font-semibold">Speaks:</span> {me.languages.join(", ")}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-1.5">
              {me.interests.map((i) => (
                <span
                  key={i}
                  className={`rounded-full px-3 py-1 text-sm ${INTERESTS.includes(i) ? "border bg-card" : "bg-highlight text-highlight-foreground"}`}
                >
                  {i}
                </span>
              ))}
            </div>
            {me.prompt.a && (
              <div className="mt-4 rounded-2xl bg-card p-4 shadow-sm">
                <p className="text-sm font-semibold text-primary">{me.prompt.q}</p>
                <p className="font-display text-lg">{me.prompt.a}</p>
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <Phone auth className="flex flex-col px-6 pb-6 pt-8">
      <div className="flex items-center gap-3">
        <button
          aria-label="Back"
          disabled={step === 0}
          onClick={() => go(step - 1)}
          className="grid size-10 place-items-center rounded-full border bg-card disabled:opacity-30"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={step}
          aria-valuemax={TOTAL}
        >
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${(step / TOTAL) * 100}%` }}
          />
        </div>
        <span className="w-12 text-right text-xs font-semibold text-muted-foreground">
          {step < TOTAL ? `${step + 1}/${TOTAL}` : "Done"}
        </span>
      </div>
      <div className="mt-8 flex-1">{body()}</div>
      {err && (
        <p className="mb-3 text-center text-sm font-medium text-destructive" role="alert">
          {err}
        </p>
      )}
      <div className="space-y-2 pt-4">
        {step < TOTAL ? (
          <button className={btnPrimary} onClick={next}>
            Continue
          </button>
        ) : (
          <button className={btnPrimary} onClick={finish}>
            {onboarded ? "Save profile" : "Start discovering"}
          </button>
        )}
        {(key === "work" || key === "languages" || key === "lifestyle") && step < TOTAL && (
          <button className={btnGhost} onClick={() => go(step + 1)}>
            Skip
          </button>
        )}
        {step === TOTAL && (
          <button className={btnGhost} onClick={() => go(0)}>
            Edit answers
          </button>
        )}
        {onboarded && step < TOTAL && (
          <button
            className="w-full py-2 text-sm font-semibold text-muted-foreground"
            onClick={() => {
              const e = validate();
              if (e) return setErr(e);
              go(TOTAL);
            }}
          >
            Jump to preview
          </button>
        )}
      </div>
    </Phone>
  );
}

function Q({ t, d, children }: { t: string; d: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-3xl font-semibold leading-tight">{t}</h1>
      <p className="mb-6 mt-2 text-muted-foreground">{d}</p>
      {children}
    </div>
  );
}
