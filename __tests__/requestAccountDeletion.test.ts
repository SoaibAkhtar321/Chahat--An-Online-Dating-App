import { handleRequestAccountDeletion, submitDeletionRequest } from "../supabase/functions/request-account-deletion/requests";
import * as deletion from "../supabase/functions/delete-account/deletion";

const UID = "11111111-1111-4111-8111-111111111111";

type Row = { id: string; user_id: string; status: string; attempts: number; last_error?: string | null };

function fakeAdmin(rows: Row[]) {
  let n = 0;
  const OPEN = ["pending", "processing", "failed"];
  const from = (table: string) => {
    if (table !== "account_deletion_requests") throw new Error("unexpected table " + table);
    const f: { uid?: string; id?: string; statuses?: string[]; patch?: any; insert?: any; or?: boolean } = {};
    const b: any = {
      select: () => b,
      eq: (c: string, v: string) => { if (c === "user_id") f.uid = v; if (c === "id") f.id = v; return b; },
      in: (_c: string, v: string[]) => { f.statuses = v; return b; },
      or: () => { f.or = true; return b; },
      update: (p: any) => { f.patch = p; return b; },
      insert: (r: any) => { f.insert = r; return b; },
      maybeSingle: async () => ({ data: rows.find((r) => r.user_id === f.uid && OPEN.includes(r.status)) ?? null, error: null }),
      single: async () => {
        if (rows.some((r) => r.user_id === f.insert.user_id && OPEN.includes(r.status))) return { data: null, error: { code: "23505", message: "dup" } };
        const row: Row = { id: `r${++n}`, user_id: f.insert.user_id, status: "pending", attempts: 0 };
        rows.push(row);
        return { data: { ...row }, error: null };
      },
      then: (resolve: any) => {
        const hit = rows.filter((r) => r.id === f.id && (!f.or || ["pending", "failed"].includes(r.status)));
        if (f.patch) hit.forEach((r) => Object.assign(r, f.patch));
        resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
      },
    };
    return b;
  };
  return { from } as any;
}

describe("website account deletion request", () => {
  afterEach(() => jest.restoreAllMocks());

  it("records one request, runs the deletion and marks it completed", async () => {
    const rows: Row[] = [];
    const spy = jest.spyOn(deletion, "executeAccountDeletion").mockResolvedValue({ ok: true });
    const out = await submitDeletionRequest(fakeAdmin(rows), UID);
    expect(out).toEqual({ status: "completed", duplicate: false });
    expect(spy).toHaveBeenCalledWith(expect.anything(), UID);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("completed");
  });

  it("keeps the request queued (failed) when deletion fails, and retries on a duplicate submit", async () => {
    const rows: Row[] = [];
    const spy = jest.spyOn(deletion, "executeAccountDeletion").mockResolvedValueOnce({ ok: false, step: "storage:photos", message: "boom" });
    const first = await submitDeletionRequest(fakeAdmin(rows), UID);
    expect(first).toEqual({ status: "queued", duplicate: false });
    expect(rows[0]).toMatchObject({ status: "failed", attempts: 1 });
    spy.mockResolvedValueOnce({ ok: true });
    const second = await submitDeletionRequest(fakeAdmin(rows), UID);
    expect(second).toEqual({ status: "completed", duplicate: true });
    expect(rows).toHaveLength(1);
  });

  it("does not run a request that another worker is already processing", async () => {
    const rows: Row[] = [{ id: "x", user_id: UID, status: "processing", attempts: 0 }];
    const spy = jest.spyOn(deletion, "executeAccountDeletion");
    const out = await submitDeletionRequest(fakeAdmin(rows), UID);
    expect(spy).not.toHaveBeenCalled();
    expect(out.duplicate).toBe(true);
  });

  const deps = (user: { id: string } | null) => ({
    env: { url: "u", anon: "a", serviceKey: "s" },
    makeUserClient: () => ({ auth: { getUser: async () => ({ data: { user }, error: user ? null : {} }) } }) as any,
    makeAdminClient: () => fakeAdmin([]),
  });
  const post = (headers: Record<string, string>, body: unknown) =>
    new Request("http://x", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("rejects missing auth, missing confirmation and invalid sessions", async () => {
    expect((await handleRequestAccountDeletion(post({}, { confirm: true }), deps({ id: UID }))).status).toBe(401);
    expect((await handleRequestAccountDeletion(post({ Authorization: "Bearer t" }, {}), deps({ id: UID }))).status).toBe(400);
    expect((await handleRequestAccountDeletion(post({ Authorization: "Bearer t" }, { confirm: true }), deps(null))).status).toBe(401);
  });

  it("uses only the verified JWT user, ignoring any user id in the body", async () => {
    const spy = jest.spyOn(deletion, "executeAccountDeletion").mockResolvedValue({ ok: true });
    const res = await handleRequestAccountDeletion(post({ Authorization: "Bearer t" }, { confirm: true, user_id: "evil" }), deps({ id: UID }));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledWith(expect.anything(), UID);
  });
});
