import { runAccountDeletion, isDeletionConfirmed } from "../mobile/src/utils/deletionFlow";

function setup(deleteAccount: () => Promise<any>, text = "DELETE") {
  const inFlight = { current: false };
  const cb = {
    onUnconfirmed: jest.fn(),
    onStart: jest.fn(),
    onSettled: jest.fn(),
    onSuccess: jest.fn(),
    onFailure: jest.fn(),
  };
  const run = () => runAccountDeletion({ confirmationText: text, inFlight, deleteAccount, ...cb });
  return { inFlight, cb, run };
}

describe("isDeletionConfirmed", () => {
  it("requires exactly DELETE (trimmed)", () => {
    expect(isDeletionConfirmed("DELETE")).toBe(true);
    expect(isDeletionConfirmed("  DELETE ")).toBe(true);
    expect(isDeletionConfirmed("delete")).toBe(false);
    expect(isDeletionConfirmed("")).toBe(false);
  });
});

describe("runAccountDeletion", () => {
  it("does not start deletion without explicit confirmation", async () => {
    const deleteAccount = jest.fn();
    const { cb, run } = setup(deleteAccount, "nope");
    await expect(run()).resolves.toBe("unconfirmed");
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(cb.onUnconfirmed).toHaveBeenCalled();
    expect(cb.onStart).not.toHaveBeenCalled();
  });

  it("prevents duplicate submission while a request is in progress", async () => {
    let resolve!: (v: any) => void;
    const deleteAccount = jest.fn(() => new Promise((r) => (resolve = r)));
    const { cb, run, inFlight } = setup(deleteAccount);
    const first = run();
    const second = await run();
    expect(second).toBe("ignored");
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(inFlight.current).toBe(true);
    resolve({ success: true });
    await expect(first).resolves.toBe("success");
    expect(inFlight.current).toBe(false);
    expect(cb.onSuccess).toHaveBeenCalledTimes(1);
  });

  it("on success runs cleanup/navigation callback and settles", async () => {
    const { cb, run } = setup(async () => ({ success: true }));
    await expect(run()).resolves.toBe("success");
    expect(cb.onSuccess).toHaveBeenCalledTimes(1);
    expect(cb.onFailure).not.toHaveBeenCalled();
    expect(cb.onSettled).toHaveBeenCalledTimes(1);
  });

  it("on failure reports the error and does not run success cleanup", async () => {
    const { cb, run, inFlight } = setup(async () => ({ success: false, error: "denied" }));
    await expect(run()).resolves.toBe("failed");
    expect(cb.onFailure).toHaveBeenCalledWith("denied", { success: false, error: "denied" });
    expect(cb.onSuccess).not.toHaveBeenCalled();
    expect(inFlight.current).toBe(false);
  });

  it("allows a retry after a failure", async () => {
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ success: false, error: "x" })
      .mockResolvedValueOnce({ success: true });
    const { run } = setup(fn);
    await expect(run()).resolves.toBe("failed");
    await expect(run()).resolves.toBe("success");
  });

  it("treats a thrown error as a failure", async () => {
    const { cb, run } = setup(async () => {
      throw new Error("boom");
    });
    await expect(run()).resolves.toBe("failed");
    expect(cb.onFailure).toHaveBeenCalledWith("boom");
    expect(cb.onSuccess).not.toHaveBeenCalled();
  });

  it("treats an unexpected (non-success, malformed) result as a failure with a default message", async () => {
    const { cb, run } = setup(async () => undefined as any);
    await expect(run()).resolves.toBe("failed");
    expect(cb.onFailure).toHaveBeenCalledWith("Could not delete account right now.", undefined);
    expect(cb.onSuccess).not.toHaveBeenCalled();
  });

  it("does not treat a truthy non-true success value as success", async () => {
    const { cb, run } = setup(async () => ({ success: "yes" }) as any);
    await expect(run()).resolves.toBe("failed");
    expect(cb.onSuccess).not.toHaveBeenCalled();
  });
});