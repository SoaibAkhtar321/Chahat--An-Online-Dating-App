const mockRpc = jest.fn();
const mockFrom = jest.fn();
let mockConfigured = true;

jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => mockConfigured,
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: (...a: unknown[]) => mockFrom(...a),
  },
}));
jest.mock("../mobile/src/config/appConfig", () => ({ isServiceConfigured: () => false }));

import {
  coinsToRupees,
  fetchCoinTransactions,
  fetchWalletSummary,
  parseCoinTransactions,
  parseWalletSummary,
} from "../mobile/src/services/coins";
import { CoinPurchaseError, getCoinPurchaseAvailability, purchaseCoins } from "../mobile/src/services/coinPurchase";
import { CallError } from "../mobile/src/services/callMedia";
import { requestCallToken } from "../mobile/src/services/callToken";

const wallet = { balance: 12, coin_value_paise: 50, free_call_seconds: 60, video_coins_per_minute: 10 };

beforeEach(() => {
  jest.clearAllMocks();
  mockConfigured = true;
});

describe("wallet parsing", () => {
  it("accepts the server shape", () => {
    expect(parseWalletSummary(wallet)).toEqual({ balance: 12, coinValuePaise: 50, freeCallSeconds: 60, videoCoinsPerMinute: 10 });
  });
  it("rejects anything unexpected instead of guessing", () => {
    for (const bad of [null, "x", {}, { ...wallet, balance: -1 }, { ...wallet, balance: "12" }, { ...wallet, balance: 1.5 }, { ...wallet, video_coins_per_minute: undefined }]) {
      expect(parseWalletSummary(bad)).toBeNull();
    }
  });
  it("converts coins to rupees for display only", () => {
    expect(coinsToRupees(10, 50)).toBe(5);
    expect(coinsToRupees(3, 50)).toBe(1.5);
  });
});

describe("wallet service", () => {
  it("loads the balance through the read-only RPC", async () => {
    mockRpc.mockResolvedValue({ data: wallet, error: null });
    await expect(fetchWalletSummary()).resolves.toMatchObject({ balance: 12 });
    expect(mockRpc).toHaveBeenCalledWith("get_my_wallet");
  });
  it("fails without a backend, on errors and on malformed data", async () => {
    mockConfigured = false;
    await expect(fetchWalletSummary()).rejects.toThrow();
    mockConfigured = true;
    mockRpc.mockResolvedValue({ data: null, error: { message: "internal detail" } });
    await expect(fetchWalletSummary()).rejects.toThrow("Could not load your coin balance.");
    mockRpc.mockResolvedValue({ data: { balance: -5 }, error: null });
    await expect(fetchWalletSummary()).rejects.toThrow("Could not load your coin balance.");
  });
  it("reads only the client-visible ledger columns, bounded", async () => {
    const limit = jest.fn().mockResolvedValue({ data: [], error: null });
    const order = jest.fn(() => ({ limit }));
    const select = jest.fn(() => ({ order }));
    mockFrom.mockReturnValue({ select });
    await fetchCoinTransactions(10_000);
    expect(mockFrom).toHaveBeenCalledWith("coin_transactions");
    expect(select.mock.calls[0][0]).not.toMatch(/idempotency|metadata|\*/);
    expect(limit).toHaveBeenCalledWith(100);
  });
  it("parses ledger rows strictly", () => {
    const row = { id: "a", kind: "call_charge", amount: -10, balance_after: 2, call_id: "c", created_at: "2026-10-16T00:00:00Z" };
    expect(parseCoinTransactions([row])).toEqual([{ id: "a", kind: "call_charge", amount: -10, balanceAfter: 2, callId: "c", createdAt: "2026-10-16T00:00:00Z" }]);
    expect(parseCoinTransactions([{ ...row, kind: "bonus" }])).toBeNull();
    expect(parseCoinTransactions([{ ...row, balance_after: -1 }])).toBeNull();
    expect(parseCoinTransactions("x")).toBeNull();
  });
});

describe("coin purchase client", () => {
  it("is unavailable and never simulates a purchase", async () => {
    expect(getCoinPurchaseAvailability()).toEqual({ available: false, reason: "not_configured" });
    expect(getCoinPurchaseAvailability(true, false).available).toBe(false);
    expect(getCoinPurchaseAvailability(false, true).available).toBe(false);
    await expect(purchaseCoins()).rejects.toBeInstanceOf(CoinPurchaseError);
  });
});

describe("insufficient coins during a call", () => {
  it("maps the server code to a clear client error", async () => {
    const error = { context: { json: async () => ({ code: "insufficient_coins" }) } };
    await expect(requestCallToken("call-1", async () => ({ data: null, error }), true)).rejects.toMatchObject({ code: "insufficient_coins" });
    expect(new CallError("insufficient_coins").message).toMatch(/coins/);
  });
});
