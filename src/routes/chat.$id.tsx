import { ICEBREAKERS, journeySuggestions } from "@/lib/compat";
import { processPhoto, validateFile } from "@/lib/photo";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Send,
  Video,
  Phone as PhoneIcon,
  MoreVertical,
  CheckCheck,
  Check,
  AlertCircle,
  ImagePlus,
  Lightbulb,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Phone } from "@/components/milo/Phone";
import { ReportDialog, ConfirmDialog } from "@/components/milo/SafetyDialogs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  block,
  isHidden,
  lastSeen,
  markRead,
  profileById,
  retryMessage,
  sendMessage,
  unmatch,
  useMilo,
} from "@/lib/milo-store";
import { meta } from "@/lib/meta";

export const Route = createFileRoute("/chat/$id")({
  head: () => meta("Conversation", "Chat with your match on Milo."),
  component: ChatPage,
});

const fmtDay = (t: number) =>
  new Date(t).toDateString() === new Date().toDateString()
    ? "Today"
    : new Date(t).toLocaleDateString([], { day: "numeric", month: "short" });

function ChatPage() {
  const { id } = Route.useParams();
  useMilo((s) => s.people); // re-render once real members finish loading
  const p = profileById(id)!;
  const nav = useNavigate();
  const isMatch = useMilo((s) => s.matches.includes(id) && !isHidden(s, id));
  const seen = useMilo((s) => lastSeen(s, p));
  const me = useMilo((s) => s.me);
  const [img, setImg] = useState<{ src: string; kb: number } | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [ideas, setIdeas] = useState(false);
  const msgs = useMilo((s) => s.messages[id]) ?? [];
  const readReceipts = useMilo((s) => s.settings.privacy["Read receipts"]);
  const [text, setText] = useState("");
  const [offline, setOffline] = useState(false);
  const [dlg, setDlg] = useState<"" | "report" | "block" | "unmatch">("");
  const end = useRef<HTMLDivElement>(null);
  const typing = !!p.demo && msgs.at(-1)?.from === "me" && msgs.at(-1)?.status === "sent";
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
    markRead(id);
  }, [msgs.length, id]);

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t && !img) return;
    sendMessage(id, t, offline, img?.src);
    setText("");
    setImg(null);
  };
  const attach = async (f: File | undefined) => {
    if (!f) return;
    const bad = validateFile(f);
    if (bad) {
      toast.error(bad);
      return;
    }
    setImgBusy(true);
    try {
      const r = await processPhoto(f);
      setImg({ src: r.thumb, kb: Math.round((r.thumb.length * 3) / 4 / 1024) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't use that image");
    } finally {
      setImgBusy(false);
    }
  };
  const sug = journeySuggestions(me, p);
  const call = (mode: "video" | "audio") =>
    nav({ to: "/call/$id", params: { id }, search: { mode, incoming: false } });

  return (
    <Phone auth className="flex flex-col">
      <header className="flex items-center gap-2 border-b bg-card px-3 pb-3 pt-7">
        <Link to="/chats" aria-label="Back" className="grid size-10 place-items-center">
          <ArrowLeft className="size-6" />
        </Link>
        <Link to="/profile/$id" params={{ id }} className="flex min-w-0 flex-1 items-center gap-3">
          <img src={p.photos[0]} alt="" className="size-10 rounded-full object-cover" />
          <div className="min-w-0">
            <b className="block truncate">{p.name}</b>
            <p className="text-xs text-muted-foreground">
              {typing ? "typing…" : (seen ?? "View profile")}
            </p>
          </div>
        </Link>
        {isMatch && (
          <>
            <button
              aria-label="Voice call"
              onClick={() => call("audio")}
              className="grid size-10 place-items-center rounded-full text-primary"
            >
              <PhoneIcon className="size-5" />
            </button>
            <button
              aria-label="Video call"
              onClick={() => call("video")}
              className="grid size-10 place-items-center rounded-full text-primary"
            >
              <Video className="size-6" />
            </button>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More options"
            className="grid size-10 place-items-center"
          >
            <MoreVertical className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() =>
                nav({ to: "/call/$id", params: { id }, search: { mode: "video", incoming: true } })
              }
            >
              Simulate incoming call
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setOffline(!offline)}>
              {offline ? "Go back online" : "Simulate offline"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDlg("report")}>Report</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDlg("block")}>Block</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => setDlg("unmatch")}>
              Unmatch
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {offline && (
        <div className="bg-destructive px-4 py-1.5 text-center text-xs font-semibold text-destructive-foreground">
          You're offline. Messages won't send (demo).
        </div>
      )}
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4 no-scrollbar">
        {!isMatch ? (
          <p className="mt-20 text-center text-muted-foreground">
            You can only message people you've matched with.
          </p>
        ) : (
          msgs.length === 0 && (
            <div className="mt-16 text-center">
              <img src={p.photos[0]} alt="" className="mx-auto size-24 rounded-full object-cover" />
              <p className="mt-3 font-display text-xl">You matched with {p.name}</p>
              <p className="text-sm text-muted-foreground">
                Say hi when you're ready. Try a suggestion below; nothing is sent until you tap
                Send.
              </p>
              <button
                onClick={() => setIdeas(true)}
                className="mt-3 inline-flex items-center gap-1 rounded-full border bg-card px-4 py-2 text-sm font-semibold text-primary"
              >
                <Lightbulb className="size-4" /> Conversation ideas
              </button>
            </div>
          )
        )}
        {msgs.map((m, k) => (
          <div key={m.id}>
            {(k === 0 || fmtDay(msgs[k - 1]!.at) !== fmtDay(m.at)) && (
              <p className="my-3 text-center text-xs font-semibold text-muted-foreground">
                {fmtDay(m.at)}
              </p>
            )}
            <div className={`flex ${m.from === "me" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[78%] rounded-2xl px-4 py-2.5 ${m.from === "me" ? (m.status === "failed" ? "rounded-br-sm border border-destructive bg-card" : "rounded-br-sm bg-primary text-primary-foreground") : "rounded-bl-sm bg-card shadow-sm"}`}
              >
                {m.image && (
                  <>
                    <img
                      src={m.image}
                      alt="Shared image"
                      className="mb-1 max-h-60 rounded-xl object-cover"
                    />
                    <span className="block text-[10px] opacity-70">
                      Shared privately with your match
                    </span>
                  </>
                )}
                {m.text && <p>{m.text}</p>}
                <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] opacity-70">
                  {new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  {m.from === "me" &&
                    m.status !== "failed" &&
                    (m.status === "read" && readReceipts ? (
                      <CheckCheck className="size-3" />
                    ) : (
                      <Check className="size-3" />
                    ))}
                </p>
              </div>
            </div>
            {m.status === "failed" && (
              <button
                onClick={() => {
                  if (offline) {
                    toast.error("Still offline");
                    return;
                  }
                  retryMessage(id, m.id);
                }}
                className="ml-auto mt-1 flex items-center gap-1 text-xs font-semibold text-destructive"
              >
                <AlertCircle className="size-3" /> Not sent · Tap to retry
              </button>
            )}
          </div>
        ))}
        {typing && (
          <div
            className="w-14 rounded-2xl bg-card px-3 py-2 text-center text-muted-foreground shadow-sm"
            aria-label={`${p.name} is typing`}
          >
            •••
          </div>
        )}
        <div ref={end} />
      </div>
      {isMatch && (
        <div
          className="flex gap-2 overflow-x-auto border-t bg-background px-3 py-2 no-scrollbar"
          aria-label="Icebreakers"
        >
          <button
            type="button"
            onClick={() => setIdeas(true)}
            className="flex shrink-0 items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-secondary-foreground"
          >
            <Lightbulb className="size-3" /> Ideas
          </button>
          <span className="shrink-0 self-center text-xs font-semibold text-muted-foreground">
            Icebreakers:
          </span>
          {ICEBREAKERS.map((ib) => (
            <button
              key={ib.text}
              type="button"
              onClick={() => setText(ib.text)}
              className="shrink-0 rounded-full border bg-card px-3 py-1 text-xs"
              title={ib.lang}
            >
              <span className="mr-1 font-semibold text-muted-foreground">{ib.lang}</span>
              {ib.text}
            </button>
          ))}
        </div>
      )}
      {isMatch && (
        <>
          {img && (
            <div className="flex items-center gap-3 border-t bg-card px-3 pt-3">
              <img src={img.src} alt="Image to send" className="size-14 rounded-lg object-cover" />
              <p className="flex-1 text-xs text-muted-foreground">
                Compressed preview · ~{img.kb} KB. Only you and your match can see it.
              </p>
              <button type="button" aria-label="Remove image" onClick={() => setImg(null)}>
                <X className="size-5" />
              </button>
            </div>
          )}
          <form onSubmit={send} className="flex gap-2 border-t bg-card p-3">
            <label
              aria-label="Attach image"
              className={`grid size-12 shrink-0 cursor-pointer place-items-center rounded-full bg-muted text-primary ${imgBusy ? "opacity-50" : ""}`}
            >
              <ImagePlus className="size-5" />
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={imgBusy}
                onChange={(e) => {
                  attach(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <input
              aria-label="Message"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message"
              maxLength={1000}
              className="h-12 flex-1 rounded-full bg-muted px-4 outline-none"
            />
            <button
              aria-label="Send"
              disabled={!text.trim() && !img}
              className="grid size-12 place-items-center rounded-full bg-brand text-primary-foreground disabled:opacity-40"
            >
              <Send className="size-5" />
            </button>
          </form>
        </>
      )}
      <ReportDialog
        open={dlg === "report"}
        onOpenChange={(o) => !o && setDlg("")}
        targetId={id}
        name={p.name}
        source="chat"
        onDone={() => nav({ to: "/chats" })}
      />
      <Sheet open={ideas} onOpenChange={setIdeas}>
        <SheetContent
          side="bottom"
          className="mx-auto max-h-[80vh] max-w-[400px] overflow-y-auto rounded-t-3xl"
        >
          <SheetHeader>
            <SheetTitle className="font-display text-2xl">Connection Journey</SheetTitle>
          </SheetHeader>
          <p className="px-4 text-xs text-muted-foreground">
            Optional suggestions based on both profiles. Tapping one puts it in the message box so
            you can edit it. Nothing is sent automatically.
          </p>
          {(
            [
              ["First message", sug.first],
              ["Keep it going", sug.starters],
            ] as const
          ).map(([h, list]) => (
            <div key={h} className="px-4 pt-4">
              <p className="mb-2 text-sm font-semibold">{h}</p>
              <div className="space-y-2">
                {list.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setText(t);
                      setIdeas(false);
                    }}
                    className="w-full rounded-xl border bg-card px-3 py-2 text-left text-sm"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="px-4 pb-6 pt-4">
            <p className="mb-2 text-sm font-semibold">First-date ideas</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {sug.dates.map((t) => (
                <li key={t}>• {t}</li>
              ))}
            </ul>
          </div>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={dlg === "block"}
        onOpenChange={(o) => !o && setDlg("")}
        danger
        title={`Block ${p.name}?`}
        body="You won't see each other again. This chat will be deleted."
        confirm="Block"
        onConfirm={() => {
          block(id);
          toast(`${p.name} is blocked`);
          nav({ to: "/chats" });
        }}
      />
      <ConfirmDialog
        open={dlg === "unmatch"}
        onOpenChange={(o) => !o && setDlg("")}
        danger
        title={`Unmatch ${p.name}?`}
        body="This removes the match and deletes the conversation for both of you."
        confirm="Unmatch"
        onConfirm={() => {
          unmatch(id);
          toast(`Unmatched with ${p.name}`);
          nav({ to: "/chats" });
        }}
      />
    </Phone>
  );
}
