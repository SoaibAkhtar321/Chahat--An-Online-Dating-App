import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Heart, MessageCircle, Phone as PhoneIcon, Crown, ShieldCheck, Sparkles, Bell } from "lucide-react";
import { Phone, Header } from "@/components/milo/Phone";
import { setState, useMilo, type Notice } from "@/lib/milo-store";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/notifications")({
  head: () => meta("Notifications", "Your Milo activity: matches, messages and more."),
  component: Notifications,
});

const ICON = { match: Sparkles, message: MessageCircle, like: Heart, call: PhoneIcon, subscription: Crown, safety: ShieldCheck, announcement: Bell };

function Notifications() {
  const nav = useNavigate();
  const notices = useMilo((s) => s.notices);
  const open = (n: Notice) => {
    setState((s) => ({ notices: s.notices.map((x) => (x.id === n.id ? { ...x, read: true } : x)) }));
    const chat = n.link?.match(/^\/chat\/(.+)$/);
    if (chat?.[1]) nav({ to: "/chat/$id", params: { id: chat[1] } });
    else if (n.link === "/likes") nav({ to: "/likes" });
    else if (n.link === "/safety") nav({ to: "/safety" });
    else if (n.link === "/me") nav({ to: "/me" });
  };
  return (
    <Phone auth>
      <Header title="Notifications" back="/discover" right={notices.some((n) => !n.read) ? <button className="text-sm font-semibold text-primary" onClick={() => setState((s) => ({ notices: s.notices.map((n) => ({ ...n, read: true })) }))}>Mark all read</button> : undefined} />
      {notices.length === 0 ? (
        <div className="py-24 text-center text-muted-foreground"><Bell className="mx-auto size-10" /><p className="mt-3">You're all caught up.</p><p className="mx-auto mt-1 max-w-xs text-xs">Only real events in this demo create notices. Push and email delivery aren't connected yet.</p></div>
      ) : notices.map((n) => { const I = ICON[n.kind]; return (
        <button key={n.id} onClick={() => open(n)} className={`flex w-full items-center gap-3 border-b px-5 py-4 text-left ${n.read ? "" : "bg-secondary/60"}`}>
          <span className="grid size-10 place-items-center rounded-full bg-card text-primary shadow-sm"><I className="size-5" /></span>
          <span className="flex-1"><span className={`block ${n.read ? "" : "font-semibold"}`}>{n.text}</span><span className="text-xs text-muted-foreground">{new Date(n.at).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></span>
          {!n.read && <span className="size-2.5 rounded-full bg-primary" />}
        </button>); })}
    </Phone>
  );
}
