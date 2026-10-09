import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Phone, Logo, btnGhost } from "@/components/milo/Phone";
import { mainThumb, profileById, useMilo } from "@/lib/milo-store";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/match/$id")({
  head: () => meta("It's a match", "You and someone new liked each other on Milo."),
  component: MatchPage,
});

function MatchPage() {
  const { id } = Route.useParams();
  useMilo((s) => s.people); // re-render once real members finish loading
  const p = profileById(id)!;
  const myPhoto = useMilo((s) => mainThumb(s.me));
  return (
    <Phone auth className="flex flex-col items-center bg-brand px-6 py-10 text-center text-primary-foreground">
      <Logo className="text-4xl" />
      <motion.h1 initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring" }} className="mt-10 text-5xl font-semibold italic">It's a match!</motion.h1>
      <p className="mt-2 opacity-90">You and {p.name} liked each other.</p>
      <div className="relative mt-12 h-56 w-72">
        <motion.img initial={{ x: -60, rotate: -20, opacity: 0 }} animate={{ x: 0, rotate: -8, opacity: 1 }} src={myPhoto} alt="You" className="absolute left-0 top-0 h-52 w-40 rounded-3xl border-4 border-primary-foreground object-cover shadow-card" />
        <motion.img initial={{ x: 60, rotate: 20, opacity: 0 }} animate={{ x: 0, rotate: 8, opacity: 1 }} src={p.photos[0]} alt={p.name} className="absolute right-0 top-4 h-52 w-40 rounded-3xl border-4 border-primary-foreground object-cover shadow-card" />
      </div>
      <div className="mt-auto w-full space-y-3">
        <Link to="/chat/$id" params={{ id }} className="inline-flex w-full items-center justify-center rounded-full bg-card px-6 py-3.5 font-bold text-primary">Say hello</Link>
        <Link to="/discover" className={`${btnGhost} border-primary-foreground/40 bg-transparent text-primary-foreground`}>Keep discovering</Link>
      </div>
    </Phone>
  );
}
