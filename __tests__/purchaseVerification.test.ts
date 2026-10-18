import fs from "fs";
import path from "path";
import {
  GOOGLE_PLAY_PRODUCTS,
  resolveGoogleSubscription,
  validatePurchaseRequest,
  type GoogleSubscriptionPurchase,
} from "../supabase/functions/verify-purchase/policy";

const ACCOUNT_ID = "sha256-of-auth-user-id";
const FUTURE_EXPIRY = "2027-01-01T00:00:00.000Z";
const root = path.resolve(__dirname, "..");

function purchase(overrides: Partial<GoogleSubscriptionPurchase> = {}): GoogleSubscriptionPurchase {
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    externalAccountIdentifiers: { obfuscatedExternalAccountId: ACCOUNT_ID },
    lineItems: [
      {
        productId: "chahat_premium_1m",
        expiryTime: FUTURE_EXPIRY,
        latestSuccessfulOrderId: "GPA.1234-5678-9012-34567",
        autoRenewingPlan: { autoRenewEnabled: true },
      },
    ],
    ...overrides,
  };
}

describe("Google Play purchase verification policy", () => {
  test("accepts only Google Play purchase tokens and ignores client entitlement claims", () => {
    expect(
      validatePurchaseRequest({
        store: "google_play",
        purchaseToken: "a-valid-purchase-token-123",
        tier: "vip",
        productId: "client-selected-product",
        amountInr: 1,
        durationMonths: 99,
      }),
    ).toEqual({ valid: true, purchaseToken: "a-valid-purchase-token-123" });
    expect(
      validatePurchaseRequest({
        store: "manual_grant",
        purchaseToken: "a-valid-purchase-token-123",
      }).valid,
    ).toBe(false);
    expect(
      validatePurchaseRequest({ store: "stripe", purchaseToken: "a-valid-purchase-token-123" })
        .valid,
    ).toBe(false);
    expect(validatePurchaseRequest({ store: "google_play", purchaseToken: "short" }).valid).toBe(
      false,
    );
  });

  test("uses only the server-owned product catalog", () => {
    expect(GOOGLE_PLAY_PRODUCTS).toEqual({
      chahat_pkg_149_7d: { tier: "premium", durationMonths: 0.25, durationDays: 7, amountInr: 149 },
      chahat_pkg_299_15d: { tier: "plus", durationMonths: 0.5, durationDays: 15, amountInr: 299 },
      chahat_pkg_499_1m: { tier: "vip", durationMonths: 1, durationDays: 30, amountInr: 499 },
      chahat_premium_1m: { tier: "premium", durationMonths: 1, amountInr: 99 },
      chahat_premium_3m: { tier: "premium", durationMonths: 3, amountInr: 249 },
      chahat_premium_6m: { tier: "premium", durationMonths: 6, amountInr: 449 },
      chahat_premium_12m: { tier: "premium", durationMonths: 12, amountInr: 799 },
      chahat_plus_1m: { tier: "plus", durationMonths: 1, amountInr: 199 },
      chahat_vip_1m: { tier: "vip", durationMonths: 1, amountInr: 399 },
    });
  });

  test("derives tier, price and duration from a verified active line item", () => {
    expect(
      resolveGoogleSubscription(purchase(), ACCOUNT_ID, Date.parse("2026-10-15T00:00:00Z")),
    ).toEqual({
      valid: true,
      productId: "chahat_premium_1m",
      tier: "premium",
      durationMonths: 1,
      amountInr: 99,
      expiresAt: FUTURE_EXPIRY,
      orderId: "GPA.1234-5678-9012-34567",
      autoRenew: true,
      needsAcknowledgement: false,
    });
  });

  test.each(["SUBSCRIPTION_STATE_CANCELED", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"])(
    "preserves entitlement through provider state %s while expiry is future",
    (state) => {
      expect(
        resolveGoogleSubscription(
          purchase({
            subscriptionState: state,
            lineItems: [
              {
                productId: "chahat_premium_1m",
                expiryTime: FUTURE_EXPIRY,
                latestSuccessfulOrderId: "GPA.order",
                autoRenewingPlan: { autoRenewEnabled: false },
              },
            ],
          }),
          ACCOUNT_ID,
          Date.parse("2026-10-15T00:00:00Z"),
        ),
      ).toMatchObject({ valid: true, autoRenew: false });
    },
  );

  test.each([
    ["expired or inactive purchase", purchase({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" })],
    ["pending purchase state", purchase({ subscriptionState: "SUBSCRIPTION_STATE_PENDING" })],
    ["pending payment", purchase({ pendingPurchase: { purchaseState: "PENDING" } })],
    [
      "account binding mismatch",
      purchase({
        externalAccountIdentifiers: { obfuscatedExternalAccountId: "another-account" },
      }),
    ],
    ["missing account binding", purchase({ externalAccountIdentifiers: undefined })],
    [
      "unknown product",
      purchase({
        lineItems: [
          {
            productId: "client_supplied_vip",
            expiryTime: FUTURE_EXPIRY,
            latestSuccessfulOrderId: "GPA.order",
          },
        ],
      }),
    ],
    [
      "expired line item",
      purchase({
        lineItems: [
          {
            productId: "chahat_premium_1m",
            expiryTime: "2026-01-01T00:00:00.000Z",
            latestSuccessfulOrderId: "GPA.order",
          },
        ],
      }),
    ],
    [
      "missing order ID",
      purchase({
        lineItems: [
          {
            productId: "chahat_premium_1m",
            expiryTime: FUTURE_EXPIRY,
          },
        ],
      }),
    ],
    [
      "invalid acknowledgement state",
      purchase({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_UNSPECIFIED" }),
    ],
  ])("rejects %s", (_case, providerPurchase) => {
    expect(
      resolveGoogleSubscription(providerPurchase, ACCOUNT_ID, Date.parse("2026-10-15T00:00:00Z"))
        .valid,
    ).toBe(false);
  });

  test("marks a valid completed purchase for acknowledgement after persistence", () => {
    const result = resolveGoogleSubscription(
      purchase({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" }),
      ACCOUNT_ID,
      Date.parse("2026-10-15T00:00:00Z"),
    );
    expect(result).toMatchObject({ valid: true, needsAcknowledgement: true });
  });

  test("does not produce an acknowledgement request for pending purchases", () => {
    expect(
      resolveGoogleSubscription(
        purchase({
          subscriptionState: "SUBSCRIPTION_STATE_PENDING",
          acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING",
          pendingPurchase: { purchaseState: "PENDING" },
        }),
        ACCOUNT_ID,
        Date.parse("2026-10-15T00:00:00Z"),
      ),
    ).toEqual({ valid: false, error: "Google Play purchase is pending and is not entitled." });
  });

  test("uses the final database RPC and acknowledges only after the persisted success response", () => {
    const verifier = fs.readFileSync(
      path.join(root, "supabase/functions/verify-purchase/index.ts"),
      "utf8",
    );
    const client = fs.readFileSync(
      path.join(root, "mobile/src/services/subscription.ts"),
      "utf8",
    );
    expect(verifier).toContain('admin.rpc("record_verified_google_purchase"');
    expect(verifier).not.toContain(":acknowledge");
    const verificationPosition = client.indexOf("verifyAndCreditPurchase({");
    const verificationSuccessPosition = client.indexOf("if (!result.success", verificationPosition);
    const acknowledgementPosition = client.indexOf("iap.finishTransaction", verificationSuccessPosition);
    expect(verificationPosition).toBeGreaterThanOrEqual(0);
    expect(verificationSuccessPosition).toBeGreaterThan(verificationPosition);
    expect(acknowledgementPosition).toBeGreaterThan(verificationSuccessPosition);
  });

  test("database RPC supports safe replay while rejecting account transfer and stale downgrades", () => {
    const migration = fs.readFileSync(
      path.join(
        root,
        "supabase/migrations/20260101001600_google_play_verified_purchase_expiry.sql",
      ),
      "utf8",
    );
    expect(migration).toMatch(/_existing\.user_id <> _uid/);
    expect(migration).toMatch(/'idempotent', true/);
    expect(migration).toMatch(/Stale purchase cannot replace a newer active subscription/);
    expect(migration).toMatch(/Purchase cannot downgrade a newer active subscription/);
    expect(migration).toMatch(/pg_advisory_xact_lock/);
  });
});
