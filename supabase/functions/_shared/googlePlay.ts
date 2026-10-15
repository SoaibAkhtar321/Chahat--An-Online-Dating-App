export type GoogleServiceAccount = {
  client_email?: string;
  private_key?: string;
  token_uri?: string;
};

export type GoogleSubscription = {
  subscriptionState?: string;
  acknowledgementState?: string;
  startTime?: string;
  latestOrderId?: string;
  pendingPurchase?: { purchaseState?: string };
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: Array<{
    productId?: string;
    expiryTime?: string;
    latestSuccessfulOrderId?: string;
    autoRenewingPlan?: { autoRenewEnabled?: boolean };
  }>;
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlText(value: string): string {
  return base64Url(new TextEncoder().encode(value));
}

function fromPem(pem: string): Uint8Array {
  const base64 = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", toArrayBuffer(new TextEncoder().encode(value))),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getGoogleAccessToken(credentials: GoogleServiceAccount): Promise<string> {
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google Play service account is incomplete.");
  }
  const tokenUri = "https://oauth2.googleapis.com/token";
  if (credentials.token_uri && credentials.token_uri !== tokenUri) {
    throw new Error("Google Play service account token URI is unsupported.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlText(
    JSON.stringify({
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/androidpublisher",
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(fromPem(credentials.private_key)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      toArrayBuffer(new TextEncoder().encode(unsigned)),
    ),
  );
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(signature)}`,
    }),
  });
  if (!response.ok) throw new Error("Could not authenticate with Google Play.");
  const tokenResult = await response.json();
  if (typeof tokenResult.access_token !== "string")
    throw new Error("Google Play returned no access token.");
  return tokenResult.access_token;
}

export async function getGoogleSubscription(
  accessToken: string,
  packageName: string,
  purchaseToken: string,
): Promise<{ response: Response; subscription?: GoogleSubscription }> {
  const url =
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}` +
    `/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return { response };
  return { response, subscription: (await response.json()) as GoogleSubscription };
}
