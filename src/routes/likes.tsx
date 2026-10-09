import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Lock, Heart } from "lucide-react";
import { toast } from "sonner";
import { Phone, btnPrimary } from "@/components/milo/Phone";
import { allPeople, can, isHidden, swipe, useMilo } from "@/lib/milo-store";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/likes")({
  head: () => meta("Likes", "See who liked you on Milo."),
  component: Likes,
});

function Likes() {
  const nav = useNavigate();
  const swiped = useMilo((s) => s.swiped);
  const st = useMilo((s) => s);
  const premium = useMilo((s) => can(s, "likesList"));
  const likers = allPeople(st).filter((p) => p.likesYou && !swiped[p.id] && !isHidden(st, p.id));
  const likeBack = (id: string) => { const r = swipe(id, "like"); if (r === "match") nav({ to: "/match/$id", params: { id } }); else if (r === "limit") toast("Out of likes for today"); };

  return (
    <Phone auth tabs className="px-5 pt-8">
      <h1 className="text-3xl font-semibold">Likes</h1>
      <p className="mt-1 text-muted-foreground">{likers.length ? `${likers.length} ${likers.length === 1 ? "person" : "people"} liked you` : "No new likes right now. Keep your profile fresh!"}</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        {likers.map((p) => (
          <div key={p.id} className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-muted">
            {premium ? (
              <>
                <Link to="/profile/$id" params={{ id: p.id }}><img src={p.photos[0]} alt={p.name} className="size-full object-cover" /></Link>
                <div className="pointer-events-none absolute inset-0 bg-photo-fade" />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-3 text-ink-foreground">
                  <b>{p.name}, {p.age}</b>
                  <button aria-label={`Like ${p.name} back`} onClick={() => likeBack(p.id)} className="grid size-10 place-items-center rounded-full bg-brand"><Heart className="size-5" fill="currentColor" /></button>
                </div>
              </>
            ) : (
              <>
                <div aria-label="Hidden profile" className="grid size-full place-items-center bg-secondary"><Lock className="size-8 text-muted-foreground" /></div>
              </>
            )}
          </div>
        ))}
      </div>
      {likers.length > 0 && !premium && (
        <div className="my-6 rounded-3xl bg-secondary p-5 text-center">
          <h2 className="text-xl font-semibold">See who likes you</h2>
          <p className="mt-1 text-sm text-muted-foreground">The full list is a Premium feature. Matching and chat stay free: keep swiping and if you Like them back, it's a match.</p>
          <Link to="/premium" className={`${btnPrimary} mt-4`}>Explore Premium</Link>
        </div>
      )}
    </Phone>
  );
}
