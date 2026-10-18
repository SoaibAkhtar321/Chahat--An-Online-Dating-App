jest.mock(
  "@react-native-async-storage/async-storage",
  () => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);

jest.mock(
  "expo-secure-store",
  () => ({
    getItemAsync: jest.fn().mockResolvedValue(null),
    setItemAsync: jest.fn().mockResolvedValue(undefined),
    deleteItemAsync: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);
jest.mock(
  "expo-constants",
  () => {
    const AppOwnership = {
      Standalone: "standalone",
      Expo: "expo",
      Guest: "guest",
    };
    const ExecutionEnvironment = {
      Bare: "bare",
      Standalone: "standalone",
      StoreClient: "storeClient",
    };
    const config = {
      newArchEnabled: true,
      android: { newArchEnabled: true },
      ios: { newArchEnabled: true },
      extra: { eas: { projectId: "test-id" } },
    };
    return {
      __esModule: true,
      AppOwnership,
      ExecutionEnvironment,
      default: {
        appOwnership: AppOwnership.Standalone,
        executionEnvironment: ExecutionEnvironment.Standalone,
        expoConfig: config,
        manifest: config,
      },
      expoConfig: config,
    };
  },
  { virtual: true },
);

import fs from "fs";
import path from "path";
import {
  GOOGLE_PLAY_PRODUCTS,
  getGoogleProduct,
  googleRevocationState,
  isEntitledGoogleState,
  isTrustedPubSubClaims,
  parseGooglePlayNotification,
  resolveGoogleSubscription,
  validatePurchaseRequest,
  type GoogleSubscriptionPurchase,
} from "../supabase/functions/verify-purchase/policy";
import { PLAY_PRODUCT_IDS, PLANS, PREMIUM_BILLING_DURATIONS } from "../mobile/src/services/subscription";
import { supabase } from "../mobile/src/services/supabase";

const root = path.resolve(__dirname, "..");
const TEST_ACCOUNT_ID = "sha256-hash-of-user-id";
const TEST_FUTURE_EXPIRY = "2027-01-01T00:00:00.000Z";

function makePurchase(overrides: Partial<GoogleSubscriptionPurchase> = {}): GoogleSubscriptionPurchase {
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    externalAccountIdentifiers: { obfuscatedExternalAccountId: TEST_ACCOUNT_ID },
    lineItems: [
      {
        productId: "chahat_premium_1m",
        expiryTime: TEST_FUTURE_EXPIRY,
        latestSuccessfulOrderId: "GPA.1234-5678-9012-34567",
        autoRenewingPlan: { autoRenewEnabled: true },
      },
    ],
    ...overrides,
  };
}

describe("Phase 6: Google Play Billing and Subscriptions", () => {
  afterAll(() => {
    supabase.auth.stopAutoRefresh();
  });
  describe("1. Centrally Configured Play Product IDs and Catalog Consistency", () => {
    test("mobile product IDs match server policy catalog exactly", () => {
      const serverProductIds = Object.keys(GOOGLE_PLAY_PRODUCTS).sort();
      const clientProductIds = [
        ...Object.values(PLAY_PRODUCT_IDS.premium),
        ...Object.values(PLAY_PRODUCT_IDS.plus),
        ...Object.values(PLAY_PRODUCT_IDS.vip),
      ].sort();

      expect(clientProductIds).toEqual(serverProductIds);
      expect(serverProductIds).toEqual([
        "chahat_pkg_149_7d",
        "chahat_pkg_299_15d",
        "chahat_pkg_499_1m",
        "chahat_plus_1m",
        "chahat_premium_12m",
        "chahat_premium_1m",
        "chahat_premium_3m",
        "chahat_premium_6m",
        "chahat_vip_1m",
      ]);
    });

    test("product tiers, durations, and Indian Rupee prices are strictly defined", () => {
      expect(GOOGLE_PLAY_PRODUCTS.chahat_pkg_149_7d).toEqual({
        tier: "premium",
        durationMonths: 0.25,
        durationDays: 7,
        amountInr: 149,
      });
      expect(GOOGLE_PLAY_PRODUCTS.chahat_pkg_299_15d).toEqual({
        tier: "plus",
        durationMonths: 0.5,
        durationDays: 15,
        amountInr: 299,
      });
      expect(GOOGLE_PLAY_PRODUCTS.chahat_pkg_499_1m).toEqual({
        tier: "vip",
        durationMonths: 1,
        durationDays: 30,
        amountInr: 499,
      });
      expect(GOOGLE_PLAY_PRODUCTS.chahat_premium_1m).toEqual({
        tier: "premium",
        durationMonths: 1,
        amountInr: 99,
      });
      expect(GOOGLE_PLAY_PRODUCTS.chahat_premium_3m).toEqual({
        tier: "premium",
        durationMonths: 3,
        amountInr: 249,
      });
      expect(GOOGLE_PLAY_PRODUCTS.chahat_premium_6m).toEqual({
        tier: "premium",
        durationMonths: 6,
        amountInr: 449,
      });
      expect(GOOGLE_PLAY_PRODUCTS.chahat_premium_12m).toEqual({
        tier: "premium",
        durationMonths: 12,
        amountInr: 799,
      });
      expect(GOOGLE_PLAY_PRODUCTS.chahat_plus_1m).toEqual({
        tier: "plus",
        durationMonths: 1,
        amountInr: 199,
      });
      expect(GOOGLE_PLAY_PRODUCTS.chahat_vip_1m).toEqual({
        tier: "vip",
        durationMonths: 1,
        amountInr: 399,
      });
    });

    test("client multi-month packages align with approved pricing", () => {
      expect(PREMIUM_BILLING_DURATIONS).toHaveLength(4);
      expect(PREMIUM_BILLING_DURATIONS.map((d) => ({ months: d.months, price: d.totalPrice }))).toEqual([
        { months: 1, price: 99 },
        { months: 3, price: 249 },
        { months: 6, price: 449 },
        { months: 12, price: 799 },
      ]);
    });

    test("rejects unconfigured, invented, or prototype product IDs", () => {
      expect(getGoogleProduct("invented_id")).toBeNull();
      expect(getGoogleProduct("chahat_free")).toBeNull();
      expect(getGoogleProduct("chahat_vip_12m")).toBeNull();
      expect(getGoogleProduct("")).toBeNull();
    });
  });

  describe("2. Server-Side Token Verification & Security Controls", () => {
    test("rejects non-Google Play store requests", () => {
      const res = validatePurchaseRequest({
        store: "apple_app_store",
        purchaseToken: "valid-token-length-greater-than-sixteen",
      });
      expect(res.valid).toBe(false);
      expect((res as any).error).toMatch(/unsupported purchase store/i);
    });

    test("rejects short, empty, or oversized purchase tokens", () => {
      expect(validatePurchaseRequest({ store: "google_play", purchaseToken: "" }).valid).toBe(false);
      expect(validatePurchaseRequest({ store: "google_play", purchaseToken: "short-token" }).valid).toBe(false);
      expect(
        validatePurchaseRequest({ store: "google_play", purchaseToken: "a".repeat(4097) }).valid,
      ).toBe(false);

      const validToken = "valid-purchase-token-from-google-play";
      const validRes = validatePurchaseRequest({ store: "google_play", purchaseToken: validToken });
      expect(validRes.valid).toBe(true);
      if (validRes.valid) {
        expect(validRes.purchaseToken).toBe(validToken);
      }
    });

    test("rejects account binding mismatch to protect against cross-account token theft", () => {
      const stolenPurchase = makePurchase({
        externalAccountIdentifiers: { obfuscatedExternalAccountId: "attacker-account-hash" },
      });
      const decision = resolveGoogleSubscription(stolenPurchase, TEST_ACCOUNT_ID);
      expect(decision.valid).toBe(false);
      expect((decision as any).error).toMatch(/not linked to this account/i);
    });

    test("fails closed on pending purchase states (no entitlement granted or acknowledged)", () => {
      const pendingSub = makePurchase({
        subscriptionState: "SUBSCRIPTION_STATE_PENDING",
      });
      expect(resolveGoogleSubscription(pendingSub, TEST_ACCOUNT_ID).valid).toBe(false);

      const pendingPayment = makePurchase({
        pendingPurchase: { purchaseState: "PENDING" },
      });
      expect(resolveGoogleSubscription(pendingPayment, TEST_ACCOUNT_ID).valid).toBe(false);
    });

    test("entitles active, grace period, and canceled-with-future-expiry subscriptions", () => {
      const now = Date.parse("2026-10-15T00:00:00Z");

      const active = makePurchase({ subscriptionState: "SUBSCRIPTION_STATE_ACTIVE" });
      expect(resolveGoogleSubscription(active, TEST_ACCOUNT_ID, now).valid).toBe(true);

      const grace = makePurchase({ subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" });
      expect(resolveGoogleSubscription(grace, TEST_ACCOUNT_ID, now).valid).toBe(true);

      const canceled = makePurchase({ subscriptionState: "SUBSCRIPTION_STATE_CANCELED" });
      expect(resolveGoogleSubscription(canceled, TEST_ACCOUNT_ID, now).valid).toBe(true);
    });

    test("revokes and classifies inactive provider states", () => {
      expect(googleRevocationState("SUBSCRIPTION_STATE_EXPIRED")).toBe("EXPIRED");
      expect(googleRevocationState("SUBSCRIPTION_STATE_ON_HOLD")).toBe("ON_HOLD");
      expect(googleRevocationState("SUBSCRIPTION_STATE_PAUSED")).toBe("PAUSED");
      expect(googleRevocationState("SUBSCRIPTION_STATE_PENDING")).toBe("PENDING");
      expect(googleRevocationState("SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED")).toBe("PENDING");
      expect(googleRevocationState("SUBSCRIPTION_STATE_ACTIVE")).toBeNull();
      expect(googleRevocationState("SUBSCRIPTION_STATE_CANCELED")).toBeNull();
    });

    test("requires transaction acknowledgement only after successful persistence", () => {
      const unack = makePurchase({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" });
      const decision = resolveGoogleSubscription(unack, TEST_ACCOUNT_ID);
      expect(decision.valid).toBe(true);
      if (decision.valid) {
        expect(decision.needsAcknowledgement).toBe(true);
      }
    });
  });

  describe("3. RTDN Real-Time Developer Notifications", () => {
    test("parses legitimate Google Play RTDN notifications", () => {
      const raw = JSON.stringify({
        packageName: "com.chahat.dating",
        subscriptionNotification: {
          purchaseToken: "valid-google-rtdn-purchase-token",
          subscriptionId: "chahat_plus_1m",
          notificationType: 2, // SUBSCRIPTION_RENEWED
        },
      });
      const parsed = parseGooglePlayNotification(btoa(raw));
      expect(parsed).toEqual({
        packageName: "com.chahat.dating",
        purchaseToken: "valid-google-rtdn-purchase-token",
        subscriptionId: "chahat_plus_1m",
        notificationType: 2,
      });
    });

    test("respects configurable package name in RTDN parsing", () => {
      const customPkg = "com.chahat.dating.staging";
      const raw = JSON.stringify({
        packageName: customPkg,
        subscriptionNotification: {
          purchaseToken: "valid-google-rtdn-purchase-token",
          subscriptionId: "chahat_vip_1m",
          notificationType: 1,
        },
      });
      expect(parseGooglePlayNotification(btoa(raw), customPkg)).toEqual({
        packageName: customPkg,
        purchaseToken: "valid-google-rtdn-purchase-token",
        subscriptionId: "chahat_vip_1m",
        notificationType: 1,
      });
      expect(parseGooglePlayNotification(btoa(raw), "com.other.app")).toBeNull();
    });

    test("rejects malformed, unconfigured, or foreign package notifications", () => {
      expect(parseGooglePlayNotification("invalid-base64-string")).toBeNull();

      const foreignPkg = JSON.stringify({
        packageName: "com.foreign.dating",
        subscriptionNotification: {
          purchaseToken: "valid-google-rtdn-purchase-token",
          subscriptionId: "chahat_plus_1m",
          notificationType: 2,
        },
      });
      expect(parseGooglePlayNotification(btoa(foreignPkg))).toBeNull();

      const invalidProduct = JSON.stringify({
        packageName: "com.chahat.dating",
        subscriptionNotification: {
          purchaseToken: "valid-google-rtdn-purchase-token",
          subscriptionId: "unrecognized_product_id",
          notificationType: 2,
        },
      });
      expect(parseGooglePlayNotification(btoa(invalidProduct))).toBeNull();
    });

    test("validates Google Pub/Sub OIDC token claims strictly", () => {
      const now = 1_800_000_000;
      const validClaims = {
        iss: "https://accounts.google.com",
        aud: "https://example.supabase.co/functions/v1/google-play-notifications",
        email: "pubsub-invoker@gserviceaccount.com",
        email_verified: true,
        exp: now + 300,
        iat: now - 10,
      };

      expect(
        isTrustedPubSubClaims(
          validClaims,
          "https://example.supabase.co/functions/v1/google-play-notifications",
          "pubsub-invoker@gserviceaccount.com",
          now,
        ),
      ).toBe(true);

      // Wrong audience
      expect(
        isTrustedPubSubClaims(validClaims, "https://wrong.endpoint", "pubsub-invoker@gserviceaccount.com", now),
      ).toBe(false);

      // Expired token
      expect(
        isTrustedPubSubClaims({ ...validClaims, exp: now - 1 }, validClaims.aud, validClaims.email, now),
      ).toBe(false);

      // Unverified email
      expect(
        isTrustedPubSubClaims({ ...validClaims, email_verified: false }, validClaims.aud, validClaims.email, now),
      ).toBe(false);
    });
  });

  describe("4. Database Replay & Downgrade Protection Verification", () => {
    test("migration 15 creates subscription_orders table with unique token hash", () => {
      const sql15 = fs.readFileSync(
        path.join(root, "supabase/migrations/20260101001500_subscription_orders_and_replay_protection.sql"),
        "utf8",
      );
      expect(sql15).toMatch(/CREATE TABLE IF NOT EXISTS public\.subscription_orders/);
      expect(sql15).toMatch(/token_hash text NOT NULL/);
      expect(sql15).toMatch(/UNIQUE \(store, token_hash\)/);
    });

    test("migration 16 enforces advisory lock and idempotent replay", () => {
      const sql16 = fs.readFileSync(
        path.join(root, "supabase/migrations/20260101001600_google_play_verified_purchase_expiry.sql"),
        "utf8",
      );
      expect(sql16).toMatch(/pg_advisory_xact_lock/);
      expect(sql16).toMatch(/'idempotent', true/);
    });

    test("migration 16 prevents stale downgrades and account transfers", () => {
      const sql = fs.readFileSync(
        path.join(root, "supabase/migrations/20260101001600_google_play_verified_purchase_expiry.sql"),
        "utf8",
      );
      expect(sql).toMatch(/Stale purchase cannot replace a newer active subscription/);
      expect(sql).toMatch(/Purchase cannot downgrade a newer active subscription/);
      expect(sql).toMatch(/_existing\.user_id <> _uid/);
    });
  });

  describe("5. Integration with Call Metering & Read Receipts", () => {
    test("migration 24 exempts paid subscription tiers from call coin billing", () => {
      const sql = fs.readFileSync(
        path.join(root, "supabase/migrations/20260101002400_coin_wallet_and_call_billing.sql"),
        "utf8",
      );
      expect(sql).toMatch(/_exempt := public\.get_active_subscription_tier\(_call\.caller_id::text\) <> 'free';/);
      expect(sql).toMatch(/billing_exempt = _exempt/);
      expect(sql).toMatch(/free_call_until = CASE WHEN _exempt THEN NULL/);
    });

    test("migration 25 returns read receipts only to Plus and VIP members", () => {
      const sql = fs.readFileSync(
        path.join(root, "supabase/migrations/20260101002500_voice_messages_and_chat_storage.sql"),
        "utf8",
      );
      expect(sql).toMatch(/WHEN m\.sender = _my_id AND _tier NOT IN \('plus', 'vip'\) THEN NULL/);
      expect(sql).toMatch(/ELSE m\.read_at/);
    });
  });
});
