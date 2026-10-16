import {
  NotConfiguredCoinPurchaseAdapter,
  REGISTERED_COIN_PURCHASE_ADAPTERS,
  creditVerifiedCoinPurchase,
  resolveCoinPurchaseAdapter,
  type CoinPurchaseAdapter,
} from "../supabase/functions/_shared/coinPurchase";

const INPUT = { userId: "u-1", productId: "any", purchaseToken: "tok" };
const good = (value = { orderRef: "GPA.1234-5678", coins: 100 }): CoinPurchaseAdapter => ({
  name: "fake",
  configured: true,
  verifyPurchase: jest.fn(async () => ({ ok: true as const, value })),
});

describe("coin purchase adapter", () => {
  it("ships with no registered adapter and defines no coin packs", () => {
    expect(Object.keys(REGISTERED_COIN_PURCHASE_ADAPTERS)).toEqual([]);
  });

  it("is not configured by default or when the selection is unknown or incomplete", async () => {
    for (const env of [{}, { COIN_PURCHASE_ADAPTER: "" }, { COIN_PURCHASE_ADAPTER: "nope" }, { COIN_PURCHASE_ADAPTER: "__proto__" }]) {
      const a = resolveCoinPurchaseAdapter(env);
      expect(a.configured).toBe(false);
      await expect(a.verifyPurchase()).resolves.toMatchObject({ ok: false, code: "not_configured" });
    }
    const registry = { x: () => null, y: () => { throw new Error("boom"); }, z: () => ({ ...good(), configured: false }) };
    for (const name of ["x", "y", "z"]) expect(resolveCoinPurchaseAdapter({ COIN_PURCHASE_ADAPTER: name }, registry).configured).toBe(false);
    expect(resolveCoinPurchaseAdapter({ COIN_PURCHASE_ADAPTER: "W" }, { w: () => good() }).configured).toBe(true);
  });

  it("never credits with the not-configured adapter", async () => {
    const credit = jest.fn();
    const r = await creditVerifiedCoinPurchase(new NotConfiguredCoinPurchaseAdapter(), { credit }, INPUT);
    expect(r).toMatchObject({ ok: false, code: "not_configured" });
    expect(credit).not.toHaveBeenCalled();
  });

  it("credits exactly what the adapter verified, keyed by the order reference", async () => {
    const credit = jest.fn(async () => ({ ok: true, applied: true, balance: 100 }));
    const r = await creditVerifiedCoinPurchase(good(), { credit }, INPUT);
    expect(r).toEqual({ ok: true, applied: true, balance: 100 });
    expect(credit).toHaveBeenCalledWith("u-1", 100, "GPA.1234-5678");
  });

  it("reports a replay as success without applying twice", async () => {
    const credit = jest.fn(async () => ({ ok: true, applied: false, replayed: true, balance: 100 }));
    expect(await creditVerifiedCoinPurchase(good(), { credit }, INPUT)).toEqual({ ok: true, applied: false, balance: 100 });
  });

  it("rejects an unverified or malformed verification before touching the wallet", async () => {
    const credit = jest.fn();
    const failing: CoinPurchaseAdapter = { name: "f", configured: true, verifyPurchase: async () => ({ ok: false, code: "invalid_purchase", message: "no" }) };
    expect(await creditVerifiedCoinPurchase(failing, { credit }, INPUT)).toMatchObject({ ok: false, code: "invalid_purchase" });
    const throwing: CoinPurchaseAdapter = { name: "t", configured: true, verifyPurchase: async () => { throw new Error("secret"); } };
    const t = await creditVerifiedCoinPurchase(throwing, { credit }, INPUT);
    expect(t).toMatchObject({ ok: false, code: "provider_error" });
    expect(JSON.stringify(t)).not.toContain("secret");
    for (const value of [
      { orderRef: "short", coins: 10 },
      { orderRef: "GPA.1234-5678", coins: 0 },
      { orderRef: "GPA.1234-5678", coins: -5 },
      { orderRef: "GPA.1234-5678", coins: 1.5 },
      { orderRef: "GPA.1234-5678", coins: 100_000_001 },
      { orderRef: "bad ref with spaces!", coins: 10 },
    ]) {
      expect(await creditVerifiedCoinPurchase(good(value), { credit }, INPUT)).toMatchObject({ ok: false, code: "invalid_purchase" });
    }
    expect(credit).not.toHaveBeenCalled();
  });

  it("fails closed when the database credit errors or answers nonsense", async () => {
    for (const credit of [jest.fn(async () => { throw new Error("db"); }), jest.fn(async () => null), jest.fn(async () => ({ ok: false })), jest.fn(async () => ({ ok: true, applied: true }))]) {
      expect(await creditVerifiedCoinPurchase(good(), { credit }, INPUT)).toMatchObject({ ok: false, code: "credit_failed" });
    }
  });
});
