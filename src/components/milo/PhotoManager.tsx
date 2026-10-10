import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Camera, Loader2, Star, X, AlertCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { PHOTO_CONFIG, PhotoError, fileSig, processPhoto, validateFile } from "@/lib/photo";
import { uid, type MePhoto } from "@/lib/milo-store";

type Job = {
  key: string;
  name: string;
  preview: string;
  state: "waiting" | "processing" | "error";
  msg?: string;
};

/** Pick, compress, preview, reorder, set main and remove profile photos. */
export function PhotoManager({
  photos,
  onChange,
}: {
  photos: MePhoto[];
  onChange: (p: MePhoto[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const cancelled = useRef(false);
  const latest = useRef(photos);
  latest.current = photos;
  const busy = jobs.some((j) => j.state !== "error");

  // Revoke any temporary preview URLs on unmount.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  useEffect(() => () => jobsRef.current.forEach((j) => URL.revokeObjectURL(j.preview)), []);

  const dropJob = (key: string) =>
    setJobs((js) => {
      const j = js.find((x) => x.key === key);
      if (j) URL.revokeObjectURL(j.preview);
      return js.filter((x) => x.key !== key);
    });

  const onFiles = async (list: FileList | null) => {
    if (!list || busy) return;
    cancelled.current = false;
    const existing = new Set(latest.current.map((p) => p.sig));
    const room = PHOTO_CONFIG.maxPhotos - latest.current.length;
    const files: File[] = [];
    for (const f of Array.from(list)) {
      const bad = validateFile(f);
      if (bad) {
        toast.error(`${f.name}: ${bad}`);
        continue;
      }
      if (existing.has(fileSig(f)) || files.some((x) => fileSig(x) === fileSig(f))) {
        toast(`${f.name} is already added`);
        continue;
      }
      files.push(f);
    }
    if (files.length > room)
      toast(
        `Only ${room} more photo${room === 1 ? "" : "s"} allowed (max ${PHOTO_CONFIG.maxPhotos})`,
      );
    const todo = files.slice(0, Math.max(0, room)).map((f) => ({
      f,
      job: {
        key: uid(),
        name: f.name,
        preview: URL.createObjectURL(f),
        state: "waiting" as Job["state"],
      },
    }));
    if (!todo.length) return;
    setJobs((js) => [...js, ...todo.map((t) => t.job)]);
    let added = 0;
    for (const { f, job } of todo) {
      if (cancelled.current) {
        dropJob(job.key);
        continue;
      }
      setJobs((js) => js.map((j) => (j.key === job.key ? { ...j, state: "processing" } : j)));
      try {
        const r = await processPhoto(f);
        if (cancelled.current) {
          dropJob(job.key);
          continue;
        }
        onChange(
          [
            ...latest.current,
            {
              id: uid(),
              src: r.src,
              thumb: r.thumb,
              w: r.w,
              h: r.h,
              kb: r.kb,
              sig: r.sig,
              status: "pending" as const,
            },
          ].slice(0, PHOTO_CONFIG.maxPhotos),
        );
        dropJob(job.key);
        added++;
        toast.success(`${f.name}: ${r.originalKb} KB → ${r.kb} KB (${r.w}×${r.h})`);
      } catch (e) {
        const msg = e instanceof PhotoError ? e.message : "Couldn't process this photo";
        setJobs((js) => js.map((j) => (j.key === job.key ? { ...j, state: "error", msg } : j)));
      }
    }
    if (added)
      toast(
        `${added} photo${added > 1 ? "s" : ""} saved on this device · waiting for review (demo)`,
      );
  };

  const move = (k: number, d: -1 | 1) => {
    const a = [...photos];
    const j = k + d;
    if (j < 0 || j >= a.length) return;
    [a[k], a[j]] = [a[j]!, a[k]!];
    onChange(a);
  };
  const done = jobs.filter((j) => j.state !== "error").length;

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p, k) => (
          <div key={p.id} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-muted">
            <img src={p.thumb} alt={`Photo ${k + 1}`} className="size-full object-cover" />
            {p.status !== "approved" && (
              <span
                className={`absolute left-1 top-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${p.status === "rejected" ? "bg-destructive text-destructive-foreground" : "bg-card/90 text-foreground"}`}
              >
                {p.status === "rejected" ? (
                  <AlertCircle className="size-3" />
                ) : (
                  <Clock className="size-3" />
                )}
                {p.status === "rejected" ? "Rejected" : "In review"}
              </span>
            )}
            <button
              aria-label="Remove photo"
              onClick={() => onChange(photos.filter((x) => x.id !== p.id))}
              className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-ink/70 text-ink-foreground"
            >
              <X className="size-4" />
            </button>
            <div className="absolute inset-x-1 bottom-1 flex justify-between">
              <button
                aria-label="Set as main photo"
                onClick={() => onChange([p, ...photos.filter((x) => x.id !== p.id)])}
                className={`grid size-7 place-items-center rounded-full ${k === 0 ? "bg-accent text-accent-foreground" : "bg-ink/70 text-ink-foreground"}`}
              >
                <Star className="size-4" />
              </button>
              <span className="flex gap-1">
                <button
                  aria-label="Move earlier"
                  disabled={k === 0}
                  onClick={() => move(k, -1)}
                  className="grid size-7 place-items-center rounded-full bg-ink/70 text-ink-foreground disabled:opacity-30"
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  aria-label="Move later"
                  disabled={k === photos.length - 1}
                  onClick={() => move(k, 1)}
                  className="grid size-7 place-items-center rounded-full bg-ink/70 text-ink-foreground disabled:opacity-30"
                >
                  <ArrowDown className="size-4" />
                </button>
              </span>
            </div>
          </div>
        ))}
        {jobs.map((j) => (
          <div key={j.key} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-muted">
            <img src={j.preview} alt="" className="size-full object-cover opacity-50" />
            <div className="absolute inset-0 grid place-items-center p-2 text-center text-xs font-semibold">
              {j.state === "error" ? (
                <div className="rounded-lg bg-card/95 p-2 text-destructive">
                  <AlertCircle className="mx-auto size-4" />
                  {j.msg}
                  <button
                    className="mt-1 block w-full text-foreground underline"
                    onClick={() => dropJob(j.key)}
                  >
                    Dismiss
                  </button>
                </div>
              ) : (
                <div className="rounded-lg bg-card/90 p-2">
                  <Loader2 className="mx-auto size-5 animate-spin text-primary" />
                  {j.state === "processing" ? "Optimising…" : "Waiting"}
                </div>
              )}
            </div>
          </div>
        ))}
        {photos.length + done < PHOTO_CONFIG.maxPhotos && (
          <button
            aria-label="Add photos"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="grid aspect-[3/4] place-items-center rounded-xl border-2 border-dashed text-muted-foreground disabled:opacity-40"
          >
            <Camera />
          </button>
        )}
      </div>
      {busy && (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-secondary px-3 py-2 text-sm">
          <span>
            Optimising {done} photo{done > 1 ? "s" : ""}…
          </span>
          <button
            className="font-semibold text-primary"
            onClick={() => {
              cancelled.current = true;
              toast("Remaining photos cancelled");
            }}
          >
            Cancel
          </button>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        JPG, PNG or WEBP, up to 15 MB, at least {PHOTO_CONFIG.minShortSide}px. Photos are resized to{" "}
        {PHOTO_CONFIG.maxDim}px and compressed on your device, with a small copy for cards. Demo:
        they're kept in this browser only, not uploaded.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept={PHOTO_CONFIG.types.join(",")}
        multiple
        hidden
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
