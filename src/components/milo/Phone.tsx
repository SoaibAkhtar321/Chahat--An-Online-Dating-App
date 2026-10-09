import { Link, useNavigate } from "@tanstack/react-router";
import { Compass, Heart, MessageCircle, User, ArrowLeft } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { hydrateStore, totalUnread, useMilo } from "@/lib/milo-store";
import { initCloud } from "@/lib/milo-cloud";
import { cn } from "@/lib/utils";

/** Phone-sized frame. `auth` redirects signed-out visitors to the welcome screen once the sign-in check has finished. */
export function Phone({ children, tabs = false, auth = false, className }: { children: ReactNode; tabs?: boolean; auth?: boolean; className?: string }) {
  const nav = useNavigate();
  const hydrated = useMilo((s) => s._hydrated && s.sessionReady);
  const loggedIn = useMilo((s) => s.loggedIn);
  useEffect(() => { hydrateStore(); initCloud(); }, []);
  useEffect(() => { if (auth && hydrated && !loggedIn) nav({ to: "/" }); }, [auth, hydrated, loggedIn, nav]);
  return (
    <div className="flex min-h-screen items-center justify-center sm:p-6">
      <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background sm:h-[860px] sm:max-w-[400px] sm:rounded-[2.5rem] sm:border-8 sm:border-ink sm:shadow-card">
        <div className="pointer-events-none absolute left-1/2 top-1.5 z-50 -translate-x-1/2 rounded-full bg-ink/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-foreground">
          Prototype
        </div>
        <main className={cn("relative flex-1 overflow-y-auto no-scrollbar", className)}>
          {auth && !(hydrated && loggedIn) ? <Loading /> : children}
        </main>
        {tabs && <TabBar />}
      </div>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="grid h-full place-items-center p-10" role="status">
      <div className="text-center">
        <div className="mx-auto size-10 animate-spin rounded-full border-4 border-muted border-t-primary" />
        <p className="mt-3 text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function TabBar() {
  const unread = useMilo(totalUnread);
  const items = [
    { to: "/discover", icon: Compass, label: "Discover", badge: 0 },
    { to: "/likes", icon: Heart, label: "Likes", badge: 0 },
    { to: "/chats", icon: MessageCircle, label: "Chats", badge: unread },
    { to: "/me", icon: User, label: "Profile", badge: 0 },
  ] as const;
  return (
    <nav className="grid grid-cols-4 border-t bg-card px-2 pb-3 pt-2" aria-label="Main">
      {items.map(({ to, icon: Icon, label, badge }) => (
        <Link key={to} to={to} className="relative flex flex-col items-center gap-1 py-1 text-xs font-semibold text-muted-foreground"
          activeProps={{ className: "!text-primary" }}>
          <Icon className="size-6" strokeWidth={2.2} />
          {label}
          {badge > 0 && <span className="absolute right-[22%] top-0 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{badge}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Header({ title, back, right }: { title: string; back: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/95 px-4 pb-3 pt-6 backdrop-blur">
      <Link to={back} aria-label="Back" className="grid size-10 place-items-center rounded-full border bg-card"><ArrowLeft className="size-5" /></Link>
      <h1 className="flex-1 text-xl font-semibold">{title}</h1>
      {right}
    </header>
  );
}

export function Logo({ className }: { className?: string }) {
  return <span className={cn("font-display text-3xl font-semibold italic tracking-tight", className)}>mi<span className="text-primary">l</span>o</span>;
}

export function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" aria-pressed={!!active} onClick={onClick}
      className={cn("min-h-9 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:border-primary/50")}>
      {children}
    </button>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string | undefined }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 border-b px-4 py-3.5 last:border-0">
      <span className="flex-1"><span className="block font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn("relative h-7 w-12 rounded-full transition-colors", checked ? "bg-primary" : "bg-muted-foreground/30")}>
        <span className={cn("absolute top-1 size-5 rounded-full bg-card shadow transition-all", checked ? "left-6" : "left-1")} />
      </button>
    </label>
  );
}

export function Field({ label, error, children }: { label: string; error?: string | undefined; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {error && <span className="block text-xs text-destructive" role="alert">{error}</span>}
    </label>
  );
}

export const inputCls = "h-12 w-full rounded-xl border bg-card px-4 text-base outline-none focus:border-primary focus:ring-2 focus:ring-ring/20";
export const btnPrimary = "inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-3.5 font-bold text-primary-foreground shadow-glow transition active:scale-[0.98] disabled:opacity-50 disabled:shadow-none";
export const btnGhost = "inline-flex w-full items-center justify-center rounded-full border bg-card px-6 py-3.5 font-semibold transition active:scale-[0.98] disabled:opacity-50";
export const btnDanger = "inline-flex w-full items-center justify-center rounded-full bg-destructive px-6 py-3.5 font-bold text-destructive-foreground transition active:scale-[0.98] disabled:opacity-50";
export const cardCls = "overflow-hidden rounded-2xl bg-card shadow-sm";
