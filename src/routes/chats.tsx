import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, PhoneCall } from "lucide-react";
import { Phone, btnPrimary } from "@/components/milo/Phone";
import { isHidden, profileById, useMilo } from "@/lib/milo-store";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/chats")({
  head: () => meta("Chats", "Your matches and conversations on Milo."),
  component: Chats,
});

function Chats() {
  const st = useMilo((s) => s);
  const matches = st.matches.filter((m) => !isHidden(st, m));
  const messages = useMilo((s) => s.messages);
  const unread = useMilo((s) => s.unread);
  const fresh = matches.filter((m) => !messages[m]?.length);
  const convos = matches
    .filter((m) => messages[m]?.length)
    .sort((a, b) => (messages[b]?.at(-1)?.at ?? 0) - (messages[a]?.at(-1)?.at ?? 0));

  return (
    <Phone auth tabs className="px-5 pt-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold">Chats</h1>
        <Link to="/calls" className="flex items-center gap-1 text-sm font-semibold text-primary">
          <PhoneCall className="size-4" /> Calls
        </Link>
      </div>
      {matches.length === 0 ? (
        <div className="mt-24 text-center">
          <MessageCircle className="mx-auto size-12 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">No matches yet</h2>
          <p className="mt-1 text-muted-foreground">
            When you and someone like each other, you can chat here.
          </p>
          <Link to="/discover" className={`${btnPrimary} mt-6`}>
            Start discovering
          </Link>
        </div>
      ) : (
        <>
          <section className="mt-5">
            <h2 className="mb-3 font-sans text-sm font-bold uppercase tracking-wider text-muted-foreground">
              New matches
            </h2>
            {fresh.length === 0 ? (
              <p className="text-sm text-muted-foreground">No new matches. Keep swiping!</p>
            ) : (
              <div className="flex gap-4 overflow-x-auto no-scrollbar">
                {fresh.map((id) => {
                  const p = profileById(id)!;
                  return (
                    <Link key={id} to="/chat/$id" params={{ id }} className="shrink-0 text-center">
                      <img
                        src={p.photos[0]}
                        alt={p.name}
                        className="size-18 rounded-full border-2 border-primary object-cover p-0.5"
                      />
                      <span className="mt-1 block text-sm font-semibold">{p.name}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
          <section className="mt-6">
            <h2 className="mb-1 font-sans text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Messages
            </h2>
            {convos.length === 0 && (
              <p className="py-6 text-sm text-muted-foreground">
                Say hi to a new match to start a conversation.
              </p>
            )}
            {convos.map((id) => {
              const p = profileById(id)!;
              const last = messages[id]!.at(-1)!;
              const u = unread[id] ?? 0;
              return (
                <Link
                  key={id}
                  to="/chat/$id"
                  params={{ id }}
                  className="flex items-center gap-3 border-b py-3"
                >
                  <img src={p.photos[0]} alt="" className="size-14 rounded-full object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between">
                      <b>{p.name}</b>
                      <span
                        className={`text-xs ${u ? "font-bold text-primary" : "text-muted-foreground"}`}
                      >
                        {new Date(last.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <p
                        className={`flex-1 truncate text-sm ${u ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                      >
                        {last.from === "me" ? "You: " : ""}
                        {last.text}
                      </p>
                      {u > 0 && (
                        <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
                          {u}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </section>
        </>
      )}
    </Phone>
  );
}
