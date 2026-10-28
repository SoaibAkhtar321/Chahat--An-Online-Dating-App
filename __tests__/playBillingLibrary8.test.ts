// Google Play Billing Library 8 (2026-10-29): the app now uses expo-iap (OpenIAP, Billing 8.3) instead of
// react-native-iap 12 (Billing 7, which Google Play no longer accepts). These tests drive the real purchase code in
// subscription.ts against a fake expo-iap module and a fake server.
import fs from "fs";
import path from "path";

type Listener = (value: any) => void;
const iapState: {
  products: any[];
  available: any[];
  onPurchase?: Listener;
  onError?: Listener;
  requests: any[];
  finished: any[];
} = { products: [], available: [], requests: [], finished: [] };

jest.mock("expo-iap", () => ({
  initConnection: jest.fn(async () => true),
  fetchProducts: jest.fn(async () => iapState.products),
  getAvailablePurchases: jest.fn(async () => iapState.available),
  requestPurchase: jest.fn(async (args: any) => {
    iapState.requests.push(args);
    return null;
  }),
  finishTransaction: jest.fn(async (args: any) => {
    iapState.finished.push(args);
  }),
  purchaseUpdatedListener: jest.fn((l: Listener) => {
    iapState.onPurchase = l;
    return { remove: jest.fn() };
  }),
  purchaseErrorListener: jest.fn((l: Listener) => {
    iapState.onError = l;
    return { remove: jest.fn() };
  }),
}));

const server: { verify: (body: any) => any; calls: any[]; tier: string } = {
  verify: () => ({ success: true, tier: "premium" }),
  calls: [],
  tier: "premium",
};

jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    functions: {
      invoke: async (_name: string, { body }: any) => {
        server.calls.push(body);
        return { data: server.verify(body), error: null };
      },
    },
    rpc: async (name: string) =>
      name === "get_my_subscription"
        ? {
            data: { tier: server.tier, status: "active", starts_at: new Date().toISOString(), expires_at: null },
            error: null,
          }
        : { data: null, error: null },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async () => "hashed-account-id",
}));

let sub: typeof import("../mobile/src/services/subscription");

beforeAll(() => {
  process.env.EXPO_PUBLIC_FEATURE_BILLING = "true";
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RN = require("react-native");
  RN.Platform.OS = "android";
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  sub = require("../mobile/src/services/subscription");
});

beforeEach(() => {
  iapState.requests = [];
  iapState.finished = [];
  iapState.available = [];
  server.calls = [];
  server.verify = () => ({ success: true, tier: "premium" });
  iapState.products = [
    {
      platform: "android",
      type: "subs",
      id: "chahat_premium_1m",
      subscriptionOfferDetailsAndroid: [
        {
          basePlanId: "promo",
          offerId: "launch-offer",
          offerToken: "promo-token",
          offerTags: [],
          pricingPhases: { pricingPhaseList: [{ formattedPrice: "₹1", priceCurrencyCode: "INR", recurrenceMode: 3 }] },
        },
        {
          basePlanId: "prepaid-1m",
          offerId: null,
          offerToken: "base-token",
          offerTags: [],
          pricingPhases: { pricingPhaseList: [{ formattedPrice: "₹499", priceCurrencyCode: "INR", recurrenceMode: 3 }] },
        },
      ],
    },
  ];
});

const TOKEN = "purchase-token-abcdefghijklmnop";

describe("Billing Library 8 dependency", () => {
  it("react-native-iap (Billing 7) is gone; expo-iap is pinned in both package.json files and app.json", () => {
    for (const p of ["package.json", "mobile/package.json"]) {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", p), "utf8"));
      expect(pkg.dependencies["react-native-iap"]).toBeUndefined();
      expect(pkg.dependencies["expo-iap"]).toBe("3.4.13");
    }
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, "../mobile/app.json"), "utf8"));
    expect(app.expo.plugins).toContain("expo-iap");
    const src = fs.readFileSync(path.join(__dirname, "../mobile/src/services/subscription.ts"), "utf8");
    expect(src).not.toMatch(/react-native-iap/);
  });
});

describe("catalog", () => {
  it("shows Google's price for the base plan, never a promotional offer", async () => {
    const catalog = await sub.loadPlayBillingCatalog();
    expect(catalog).toEqual([
      { productId: "chahat_premium_1m", localizedPrice: "₹499", currencyCode: "INR", offerToken: "base-token" },
    ]);
  });
});

describe("purchase flow", () => {
  it("refuses a product that is missing in Play (nothing is charged)", async () => {
    iapState.products = [];
    const res = await sub.purchaseSubscription("premium", "1w");
    expect(res.status).toBe("failed");
    expect(iapState.requests).toHaveLength(0);
  });

  it("starts a subscription purchase with the base-plan offer and a hashed account id", async () => {
    const res = await sub.purchaseSubscription("premium", "1m");
    expect(res.status).toBe("pending");
    expect(iapState.requests).toEqual([
      {
        type: "subs",
        request: {
          android: {
            skus: ["chahat_premium_1m"],
            subscriptionOffers: [{ sku: "chahat_premium_1m", offerToken: "base-token" }],
            obfuscatedAccountId: "hashed-account-id",
          },
        },
      },
    ]);
  });

  it("completed purchase: server verifies first, then the transaction is acknowledged", async () => {
    const events: any[] = [];
    const stop = await sub.listenForPurchaseUpdates((e) => events.push(e));
    const purchase = {
      platform: "android",
      productId: "chahat_premium_1m",
      purchaseState: "purchased",
      purchaseToken: TOKEN,
      transactionId: "GPA.1234",
    };
    iapState.onPurchase!(purchase);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(server.calls).toEqual([
      { store: "google_play", productId: "chahat_premium_1m", purchaseToken: TOKEN, orderId: "GPA.1234" },
    ]);
    expect(iapState.finished).toEqual([{ purchase, isConsumable: false }]);
    expect(events).toEqual([{ status: "completed", tier: "premium", warning: undefined }]);
    stop();
  });

  it("server rejection: no acknowledgement, so Google refunds automatically", async () => {
    server.verify = () => ({ success: false, error: "Purchase token verification failed." });
    const events: any[] = [];
    await sub.listenForPurchaseUpdates((e) => events.push(e));
    iapState.onPurchase!({ platform: "android", productId: "chahat_plus_1m", purchaseState: "purchased", purchaseToken: TOKEN });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(iapState.finished).toHaveLength(0);
    expect(events[0].status).toBe("failed");
  });

  it("pending payment grants nothing", async () => {
    const events: any[] = [];
    await sub.listenForPurchaseUpdates((e) => events.push(e));
    iapState.onPurchase!({ platform: "android", productId: "chahat_premium_1m", purchaseState: "pending", purchaseToken: TOKEN });
    await new Promise((r) => setTimeout(r, 0));
    expect(server.calls).toHaveLength(0);
    expect(events).toEqual([{ status: "pending", message: expect.stringMatching(/pending/i) }]);
  });

  it("user cancelling in the Play sheet is reported as cancelled", async () => {
    const events: any[] = [];
    await sub.listenForPurchaseUpdates((e) => events.push(e));
    iapState.onError!({ code: "user-cancelled", message: "cancelled" });
    iapState.onError!({ code: "service-error", message: "Play is down" });
    expect(events).toEqual([{ status: "cancelled" }, { status: "failed", error: "Play is down" }]);
  });
});

describe("restore", () => {
  it("re-verifies owned purchases on the server and skips pending ones", async () => {
    iapState.available = [
      { platform: "android", productId: "chahat_premium_1m", purchaseState: "purchased", purchaseToken: TOKEN },
      { platform: "android", productId: "chahat_vip_1m", purchaseState: "pending", purchaseToken: TOKEN + "x" },
    ];
    await sub.restorePurchases();
    expect(server.calls.map((c) => c.productId)).toEqual(["chahat_premium_1m"]);
    expect(iapState.finished).toHaveLength(1);
  });
});
