import {
  executeAccountDeletion,
  handleDeleteAccount,
  removeFolder,
  type AdminLike,
  type HandlerDeps,
} from "../supabase/functions/delete-account/deletion";

const UID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

type Calls = string[];

/** In-memory fake of the admin client; `fail` makes the named step return an error. */
function fakeAdmin(opts: {
  fail?: string;
  matches?: string[];
  storage?: Record<string, Array<{ id: string | null; name: string }>>;
  authError?: string;
} = {}) {
  const calls: Calls = [];
  const storage = opts.storage ?? {};
  const admin: AdminLike = {
    rpc: async (name) => {
      calls.push(`rpc:${name}`);
      return { error: opts.fail === name ? { message: `${name} boom` } : null };
    },
    storage: {
      from: (bucket) => ({
        list: async (folder) => {
          calls.push(`list:${bucket}/${folder}`);
          const entries = storage[`${bucket}/${folder}`] ?? [];
          return { data: entries.slice(0, 100), error: null };
        },
        remove: async (paths) => {
          calls.push(`remove:${bucket}:${paths.join(",")}`);
          if (opts.fail === "remove") return { error: { message: "remove boom" } };
          for (const key of Object.keys(storage)) {
            storage[key] = storage[key].filter((e) => !paths.includes(`${key.split("/").slice(1).join("/")}/${e.name}`));
          }
          // Like real Storage, a folder entry disappears once it has no objects left.
          for (const key of Object.keys(storage)) {
            storage[key] = storage[key].filter((e) => e.id !== null || (storage[`${key}/${e.name}`] ?? []).length > 0);
          }
          return { error: null };
        },
      }),
    },
    from: (table: string) => {
      const builder: any = {
        select: () => builder,
        or: (filter: string) => {
          calls.push(`matches.or:${filter}`);
          return Promise.resolve({ data: (opts.matches ?? []).map((id) => ({ id })), error: null });
        },
        eq: () => builder,
        not: () => builder,
        range: () => Promise.resolve({ data: [], error: null }),
      };
      return builder;
    },
    auth: {
      admin: {
        deleteUser: async (id) => {
          calls.push(`auth.deleteUser:${id}`);
          return { error: opts.authError ? { message: opts.authError } : null };
        },
      },
    },
  };
  return { admin, calls };
}

function deps(over: Partial<HandlerDeps> & { userId?: string | null; admin?: AdminLike } = {}): HandlerDeps & {
  adminCalls: Calls;
} {
  const { admin, calls } = over.admin ? { admin: over.admin, calls: [] as Calls } : fakeAdmin();
  return {
    env: over.env ?? { url: "http://x", anon: "anon", serviceKey: "service" },
    makeUserClient: over.makeUserClient ??
      (() => ({
        auth: {
          getUser: async () =>
            over.userId === null
              ? { data: { user: null }, error: { message: "bad jwt" } }
              : { data: { user: { id: over.userId ?? UID } }, error: null },
        },
      })),
    makeAdminClient: over.makeAdminClient ?? (() => admin),
    adminCalls: calls,
  };
}

const post = (body: unknown, headers: Record<string, string> = { Authorization: "Bearer jwt" }) =>
  new Request("http://localhost/delete-account", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("delete-account: authentication and authorization", () => {
  it("rejects non-POST methods", async () => {
    const res = await handleDeleteAccount(new Request("http://x", { method: "GET" }), deps());
    expect(res.status).toBe(405);
  });

  it("rejects a request with no bearer token and touches nothing", async () => {
    const { admin, calls } = fakeAdmin();
    const res = await handleDeleteAccount(post({ confirm: true }, {}), deps({ admin }));
    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
    expect(calls).toEqual([]);
  });

  it("rejects an invalid JWT with the invalid_session code and touches nothing", async () => {
    const { admin, calls } = fakeAdmin();
    const res = await handleDeleteAccount(post({ confirm: true }), deps({ admin, userId: null }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("invalid_session");
    expect(calls).toEqual([]);
  });

  it("requires explicit confirmation", async () => {
    const { admin, calls } = fakeAdmin();
    for (const body of [{}, { confirm: "true" }, { confirm: false }, "not json"]) {
      const res = await handleDeleteAccount(post(body), deps({ admin }));
      expect(res.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it("fails closed when server secrets are missing", async () => {
    const res = await handleDeleteAccount(post({ confirm: true }), deps({ env: { url: "u", anon: "a" } }));
    expect(res.status).toBe(500);
  });

  it("deletes only the JWT's user and ignores any user id in the body (cross-user protection)", async () => {
    const { admin, calls } = fakeAdmin();
    const res = await handleDeleteAccount(post({ confirm: true, uid: OTHER, user_id: OTHER, _uid: OTHER }), deps({ admin }));
    expect(res.status).toBe(200);
    expect(calls.join("\n")).not.toContain(OTHER);
    expect(calls).toContain(`auth.deleteUser:${UID}`);
  });
});

describe("delete-account: ordering, idempotency and partial failure", () => {
  it("runs steps in order with the Auth user last", async () => {
    const { admin, calls } = fakeAdmin({ matches: ["m1"] });
    expect(await executeAccountDeletion(admin, UID)).toEqual({ ok: true });
    const idx = (s: string) => calls.findIndex((c) => c.startsWith(s));
    expect(idx("rpc:begin_account_deletion")).toBeLessThan(idx("rpc:clear_profile_photos_for_deletion"));
    expect(idx("rpc:clear_profile_photos_for_deletion")).toBeLessThan(idx("list:photos/"));
    expect(idx("list:photos/")).toBeLessThan(idx("list:chat/m1"));
    expect(idx("list:chat/m1")).toBeLessThan(idx("rpc:purge_user_data"));
    expect(idx("rpc:purge_user_data")).toBeLessThan(idx("auth.deleteUser"));
  });

  it.each(["begin_account_deletion", "clear_profile_photos_for_deletion", "purge_user_data"])(
    "does not delete the Auth user or report success when %s fails",
    async (failing) => {
      const { admin, calls } = fakeAdmin({ fail: failing });
      const result = await executeAccountDeletion(admin, UID);
      expect(result.ok).toBe(false);
      expect(calls.some((c) => c.startsWith("auth.deleteUser"))).toBe(false);
    },
  );

  it("returns 500 retryable with the failed step, never success, when the database purge fails", async () => {
    const { admin } = fakeAdmin({ fail: "purge_user_data" });
    const res = await handleDeleteAccount(post({ confirm: true }), deps({ admin }));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ success: false, retryable: true, code: "deletion_incomplete", failedStep: "database" });
  });

  it("is idempotent: a repeat run after full success still succeeds when the Auth user is already gone", async () => {
    const { admin } = fakeAdmin({ authError: "User not found" });
    expect(await executeAccountDeletion(admin, UID)).toEqual({ ok: true });
    expect(await executeAccountDeletion(admin, UID)).toEqual({ ok: true });
  });

  it("fails (and keeps the account retryable) on a real Auth deletion error", async () => {
    const { admin } = fakeAdmin({ authError: "database error deleting user" });
    const result = await executeAccountDeletion(admin, UID);
    expect(result).toMatchObject({ ok: false, step: "auth" });
  });

  it("refuses a malformed user id before any database or storage call", async () => {
    const { admin, calls } = fakeAdmin();
    const result = await executeAccountDeletion(admin, `${UID},user_b.neq.x`);
    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("delete-account: storage cleanup", () => {
  it("removes nested folders such as photos/<uid>/verification/ and the files inside", async () => {
    const { admin, calls } = fakeAdmin({
      storage: {
        [`photos/${UID}`]: [
          { id: "f1", name: "p1.jpg" },
          { id: null, name: "verification" },
        ],
        [`photos/${UID}/verification`]: [{ id: "f2", name: "selfie-1.jpg" }],
      },
    });
    await removeFolder(admin, "photos", UID);
    expect(calls).toContain(`remove:photos:${UID}/verification/selfie-1.jpg`);
    expect(calls).toContain(`remove:photos:${UID}/p1.jpg`);
  });

  it("throws instead of silently leaving objects when a storage removal fails", async () => {
    const { admin } = fakeAdmin({
      fail: "remove",
      storage: { [`photos/${UID}`]: [{ id: "f1", name: "p1.jpg" }] },
    });
    await expect(removeFolder(admin, "photos", UID)).rejects.toThrow(/remove photos/);
  });

  it("removes the chat folder of every match the user belongs to", async () => {
    const { admin, calls } = fakeAdmin({
      matches: ["m1", "m2"],
      storage: { "chat/m1": [{ id: "a", name: "v.m4a" }], "chat/m2": [{ id: "b", name: "i.jpg" }] },
    });
    await executeAccountDeletion(admin, UID);
    expect(calls).toContain("remove:chat:m1/v.m4a");
    expect(calls).toContain("remove:chat:m2/i.jpg");
  });
});
