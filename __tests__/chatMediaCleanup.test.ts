import { isSafeChatPath, runChatMediaCleanup, type CleanupAdminLike } from "../supabase/functions/cleanup-chat-media/cleanup";

const MATCH = "f6c60000-0000-4000-8000-000000000001";

function makeAdmin(opts: {
  batches: Array<Array<{ id: string; bucket: string; object_path: string }>>;
  removeError?: (path: string) => string | null;
  claimError?: string;
  completeError?: string;
}) {
  const calls: Array<{ name: string; args: any }> = [];
  const removed: string[] = [];
  let claimIndex = 0;
  const admin: CleanupAdminLike = {
    rpc: (name, args) => {
      calls.push({ name, args });
      if (name === "claim_chat_media_cleanup") {
        if (opts.claimError) return Promise.resolve({ data: null, error: { message: opts.claimError } });
        return Promise.resolve({ data: opts.batches[claimIndex++] ?? [], error: null });
      }
      if (name === "complete_chat_media_cleanup") {
        return Promise.resolve({ data: null, error: opts.completeError ? { message: opts.completeError } : null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from: (bucket) => ({
        remove: (paths) => {
          expect(bucket).toBe("chat");
          removed.push(...paths);
          const message = opts.removeError?.(paths[0]) ?? null;
          return Promise.resolve({ error: message ? { message } : null });
        },
      }),
    },
  };
  return { admin, calls, removed };
}

describe("isSafeChatPath", () => {
  it("accepts only <match uuid>/<single safe file name>", () => {
    expect(isSafeChatPath(`${MATCH}/img-1.jpg`)).toBe(true);
    expect(isSafeChatPath(`${MATCH}/a/b.jpg`)).toBe(false);
    expect(isSafeChatPath(`/${MATCH}/img.jpg`)).toBe(false);
    expect(isSafeChatPath(`${MATCH}/../x.jpg`)).toBe(false);
    expect(isSafeChatPath(`${MATCH}/a..b.jpg`)).toBe(false);
    expect(isSafeChatPath("not-a-uuid/img.jpg")).toBe(false);
    expect(isSafeChatPath(null)).toBe(false);
  });
});

describe("runChatMediaCleanup", () => {
  it("removes claimed objects and completes them in one call", async () => {
    const { admin, calls, removed } = makeAdmin({
      batches: [[
        { id: "1", bucket: "chat", object_path: `${MATCH}/a.jpg` },
        { id: "2", bucket: "chat", object_path: `${MATCH}/b.m4a` },
      ]],
    });
    const summary = await runChatMediaCleanup(admin, { batchSize: 25 });
    expect(summary).toEqual({ claimed: 2, removed: 2, failed: 0, batches: 1 });
    expect(removed).toEqual([`${MATCH}/a.jpg`, `${MATCH}/b.m4a`]);
    expect(calls.filter((c) => c.name === "complete_chat_media_cleanup")[0].args).toEqual({ _ids: ["1", "2"] });
  });

  it("reports a failed removal for retry and still completes the others", async () => {
    const { admin, calls } = makeAdmin({
      batches: [[
        { id: "1", bucket: "chat", object_path: `${MATCH}/a.jpg` },
        { id: "2", bucket: "chat", object_path: `${MATCH}/b.jpg` },
      ]],
      removeError: (p) => (p.endsWith("a.jpg") ? `503 for ${p}` : null),
    });
    const summary = await runChatMediaCleanup(admin);
    expect(summary).toMatchObject({ claimed: 2, removed: 1, failed: 1 });
    const fail = calls.find((c) => c.name === "fail_chat_media_cleanup")!;
    expect(fail.args._id).toBe("1");
    expect(fail.args._error).not.toContain(MATCH); // object path / uuid is redacted
    expect(calls.find((c) => c.name === "complete_chat_media_cleanup")!.args).toEqual({ _ids: ["2"] });
  });

  it("never calls Storage for an unsafe path or foreign bucket", async () => {
    const { admin, removed, calls } = makeAdmin({
      batches: [[
        { id: "1", bucket: "chat", object_path: `${MATCH}/../photos/x.jpg` },
        { id: "2", bucket: "photos", object_path: `${MATCH}/ok.jpg` },
      ]],
    });
    const summary = await runChatMediaCleanup(admin);
    expect(removed).toEqual([]);
    expect(summary.failed).toBe(2);
    expect(calls.filter((c) => c.name === "fail_chat_media_cleanup")).toHaveLength(2);
    expect(calls.some((c) => c.name === "complete_chat_media_cleanup")).toBe(false);
  });

  it("keeps draining until a short batch and stops at maxBatches", async () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `${n}-${i}`, bucket: "chat", object_path: `${MATCH}/f${n}-${i}.jpg` }));
    const { admin } = makeAdmin({ batches: [mk(2), mk(2), mk(1)] });
    expect(await runChatMediaCleanup(admin, { batchSize: 2, maxBatches: 8 })).toMatchObject({ claimed: 5, removed: 5, batches: 3 });
    const capped = makeAdmin({ batches: [mk(2), mk(2), mk(2)] });
    expect(await runChatMediaCleanup(capped.admin, { batchSize: 2, maxBatches: 2 })).toMatchObject({ claimed: 4, batches: 2 });
  });

  it("does nothing when the queue is empty", async () => {
    const { admin, removed } = makeAdmin({ batches: [] });
    expect(await runChatMediaCleanup(admin)).toEqual({ claimed: 0, removed: 0, failed: 0, batches: 0 });
    expect(removed).toEqual([]);
  });

  it("throws (work stays retryable) when claim or complete fails, without leaking raw ids", async () => {
    await expect(runChatMediaCleanup(makeAdmin({ batches: [], claimError: `boom ${MATCH}` }).admin)).rejects.toThrow(/claim failed/);
    const bad = makeAdmin({ batches: [[{ id: "1", bucket: "chat", object_path: `${MATCH}/a.jpg` }]], completeError: "db down" });
    await expect(runChatMediaCleanup(bad.admin)).rejects.toThrow(/complete failed/);
    await expect(runChatMediaCleanup(makeAdmin({ batches: [], claimError: `boom ${MATCH}` }).admin)).rejects.not.toThrow(MATCH);
  });

  it("treats a throwing Storage client as a retryable failure", async () => {
    const { admin, calls } = makeAdmin({ batches: [[{ id: "1", bucket: "chat", object_path: `${MATCH}/a.jpg` }]] });
    (admin.storage as any).from = () => ({ remove: () => { throw new Error("network down"); } });
    const summary = await runChatMediaCleanup(admin);
    expect(summary).toMatchObject({ failed: 1, removed: 0 });
    expect(calls.some((c) => c.name === "fail_chat_media_cleanup")).toBe(true);
  });
});
