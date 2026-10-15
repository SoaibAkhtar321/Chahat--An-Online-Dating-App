import {
  getGoogleProduct,
  googleRevocationState,
  isEntitledGoogleState,
  isTrustedPubSubClaims,
  parseGooglePlayNotification,
  verifyGooglePubSubJwt,
} from "../supabase/functions/verify-purchase/policy";

describe("Google Play server verification policy", () => {
  it("maps only the approved product identifiers to server-owned plans and durations", () => {
    expect(getGoogleProduct("chahat_premium_3m")).toEqual({
      tier: "premium",
      durationMonths: 3,
    });
    expect(getGoogleProduct("chahat_plus_1m")).toEqual({ tier: "plus", durationMonths: 1 });
    expect(getGoogleProduct("unknown_product")).toBeNull();
    expect(getGoogleProduct("manual_grant")).toBeNull();
  });

  it("does not entitle pending, expired, or unsupported states", () => {
    const now = 1_800_000_000_000;
    expect(isEntitledGoogleState("SUBSCRIPTION_STATE_ACTIVE", now + 1000, now)).toBe(true);
    expect(isEntitledGoogleState("SUBSCRIPTION_STATE_CANCELED", now + 1000, now)).toBe(true);
    expect(isEntitledGoogleState("SUBSCRIPTION_STATE_PENDING", now + 1000, now)).toBe(false);
    expect(isEntitledGoogleState("SUBSCRIPTION_STATE_ACTIVE", now, now)).toBe(false);
    expect(isEntitledGoogleState("SUBSCRIPTION_STATE_ACTIVE", Number.NaN, now)).toBe(false);
  });

  it("classifies inactive provider states for reconciliation", () => {
    expect(googleRevocationState("SUBSCRIPTION_STATE_EXPIRED")).toBe("EXPIRED");
    expect(googleRevocationState("SUBSCRIPTION_STATE_ON_HOLD")).toBe("ON_HOLD");
    expect(googleRevocationState("SUBSCRIPTION_STATE_PAUSED")).toBe("PAUSED");
    expect(googleRevocationState("SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED")).toBe("PENDING");
    expect(googleRevocationState("SUBSCRIPTION_STATE_CANCELED")).toBeNull();
  });

  it("parses only correctly-shaped Chahat RTDN subscription messages", () => {
    const data = btoa(
      JSON.stringify({
        packageName: "com.milo.dating",
        subscriptionNotification: {
          purchaseToken: "long-google-purchase-token",
          subscriptionId: "chahat_premium_1m",
          notificationType: 2,
        },
      }),
    );
    expect(parseGooglePlayNotification(data)).toMatchObject({
      packageName: "com.milo.dating",
      subscriptionId: "chahat_premium_1m",
      notificationType: 2,
    });
    expect(
      parseGooglePlayNotification(btoa(JSON.stringify({ packageName: "other.package" }))),
    ).toBeNull();
    expect(parseGooglePlayNotification("not-base64-json")).toBeNull();
  });

  it("requires trusted Google Pub/Sub OIDC claims with a matching audience and service account", () => {
    const now = 1_800_000_000;
    const claims = {
      iss: "https://accounts.google.com",
      aud: "https://project.functions.supabase.co/google-play-notifications",
      email: "push@example.iam.gserviceaccount.com",
      email_verified: true,
      exp: now + 300,
      iat: now - 30,
    };
    expect(
      isTrustedPubSubClaims(
        claims,
        "https://project.functions.supabase.co/google-play-notifications",
        "push@example.iam.gserviceaccount.com",
        now,
      ),
    ).toBe(true);
    expect(
      isTrustedPubSubClaims(claims, "wrong-audience", "push@example.iam.gserviceaccount.com", now),
    ).toBe(false);
    expect(
      isTrustedPubSubClaims({ ...claims, email_verified: false }, claims.aud, claims.email, now),
    ).toBe(false);
  });

  it("verifies the Pub/Sub OIDC signature against the Google JWKS key", async () => {
    const audience = "https://project.functions.supabase.co/google-play-notifications";
    const email = "push@example.iam.gserviceaccount.com";
    const now = 1_800_000_000;
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const publicJwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey & {
      kid: string;
    };
    publicJwk.kid = "google-key-1";
    const encode = (value: string | ArrayBuffer) => {
      const bytes =
        typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    };
    const header = encode(JSON.stringify({ alg: "RS256", kid: publicJwk.kid, typ: "JWT" }));
    const claims = encode(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: audience,
        email,
        email_verified: true,
        exp: now + 300,
        iat: now - 30,
      }),
    );
    const unsigned = `${header}.${claims}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keyPair.privateKey,
      new TextEncoder().encode(unsigned),
    );
    const token = `${unsigned}.${encode(signature)}`;
    const signatureStart = token.lastIndexOf(".") + 1;
    const signaturePrefix = token[signatureStart] === "A" ? "B" : "A";
    const tamperedToken = `${token.slice(0, signatureStart)}${signaturePrefix}${token.slice(signatureStart + 1)}`;
    const fetcher = jest.fn(async () => ({
      ok: true,
      json: async () => ({ keys: [publicJwk] }),
    })) as unknown as typeof fetch;

    await expect(
      verifyGooglePubSubJwt(`Bearer ${token}`, audience, email, fetcher, now),
    ).resolves.toBe(true);
    await expect(
      verifyGooglePubSubJwt(`Bearer ${tamperedToken}`, audience, email, fetcher, now),
    ).resolves.toBe(false);
    await expect(
      verifyGooglePubSubJwt(`Bearer ${token}`, "wrong-audience", email, fetcher, now),
    ).resolves.toBe(false);
  });
});
