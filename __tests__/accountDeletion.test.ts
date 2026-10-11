const mockInvoke = jest.fn();
const mockSignOut = jest.fn();
const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock("../mobile/src/services/supabase", () => ({
  supabase: {
    functions: { invoke: (...a: any[]) => mockInvoke(...a) },
    rpc: (...a: any[]) => mockRpc(...a),
    from: (...a: any[]) => mockFrom(...a),
    auth: { signOut: (...a: any[]) => mockSignOut(...a) },
  },
  isSupabaseConfigured: () => true,
  getConfigStatus: () => ({ configured: true, missing: [] }),
}));

import { deleteUserAccount } from "../mobile/src/services/auth";

/** Mimics supabase-js FunctionsHttpError: the Response is on `error.context`. */
function httpError(status: number, body?: unknown) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context: {
      status,
      json: async () => {
        if (body === undefined) throw new Error("no JSON body");
        return body;
      },
    },
  };
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockSignOut.mockReset();
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockSignOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  // The retired RPC and client-side table deletes must never be used as a fallback.
  expect(mockRpc).not.toHaveBeenCalled();
  expect(mockFrom).not.toHaveBeenCalled();
});

describe("deleteUserAccount (delete-account Edge Function)", () => {
  it("invokes the function with the confirm flag, then signs out locally", async () => {
    const order: string[] = [];
    mockInvoke.mockImplementation(async () => {
      order.push("invoke");
      return { data: { success: true }, error: null };
    });
    mockSignOut.mockImplementation(async () => {
      order.push("signOut");
      return { error: null };
    });
    const res = await deleteUserAccount();
    expect(res).toEqual({ success: true });
    expect(mockInvoke).toHaveBeenCalledWith("delete-account", { body: { confirm: true } });
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(order).toEqual(["invoke", "signOut"]);
  });

  it("flags an expired session (401) without signing out", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(401, { success: false, error: "Invalid or expired session" }),
    });
    const res = await deleteUserAccount();
    expect(res.success).toBe(false);
    expect(res.sessionExpired).toBe(true);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("reports the function as unavailable when it is not deployed (404)", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(404, { message: "Requested function was not found" }),
    });
    const res = await deleteUserAccount();
    expect(res.success).toBe(false);
    expect(res.unavailable).toBe(true);
    expect(res.error).toMatch(/isn't available/i);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("surfaces the function's own message and retryable flag on a partial failure (500)", async () => {
    const message =
      "Account deletion did not finish (storage:chat). Please try again; nothing is lost by retrying.";
    mockInvoke.mockResolvedValue({
      data: null,
      error: httpError(500, { success: false, retryable: true, error: message }),
    });
    const res = await deleteUserAccount();
    expect(res.success).toBe(false);
    expect(res.error).toBe(message);
    expect(res.retryable).toBe(true);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("falls back to a default message when the error body is not JSON", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: httpError(500) });
    const res = await deleteUserAccount();
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/try again/i);
    expect(res.retryable).toBeFalsy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("reports a connectivity problem when the request could not be sent", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" },
    });
    const res = await deleteUserAccount();
    expect(res.success).toBe(false);
    expect(res.retryable).toBe(true);
    expect(res.error).toMatch(/connection/i);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("treats an explicit success:false payload as a failure", async () => {
    mockInvoke.mockResolvedValue({ data: { success: false, error: "not allowed" }, error: null });
    const res = await deleteUserAccount();
    expect(res).toMatchObject({ success: false, error: "not allowed" });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("treats a missing or non-true success value as a failure", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: null });
    const a = await deleteUserAccount();
    expect(a.success).toBe(false);
    mockInvoke.mockResolvedValue({ data: { success: "yes" }, error: null });
    const b = await deleteUserAccount();
    expect(b.success).toBe(false);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("returns failure (no sign-out) if the invoke call throws", async () => {
    mockInvoke.mockRejectedValue(new Error("offline"));
    const res = await deleteUserAccount();
    expect(res).toMatchObject({ success: false, error: "offline" });
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("still reports success with a warning if local sign-out fails after the server succeeded", async () => {
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
    mockSignOut.mockResolvedValue({ error: { message: "storage error" } });
    const res = await deleteUserAccount();
    expect(res.success).toBe(true);
    expect(res.warning).toBeTruthy();
  });

  it("still reports success with a warning if local sign-out throws", async () => {
    mockInvoke.mockResolvedValue({ data: { success: true }, error: null });
    mockSignOut.mockRejectedValue(new Error("x"));
    const res = await deleteUserAccount();
    expect(res.success).toBe(true);
    expect(res.warning).toBeTruthy();
  });
});