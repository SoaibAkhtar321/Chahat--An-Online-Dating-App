// Runs before every EAS build (npm script "eas-build-pre-install").
// Fails a PRODUCTION build if the Supabase client variables are missing or still placeholders,
// so a release can never ship pointing at the placeholder backend. Other profiles are not blocked.
const profile = process.env.EAS_BUILD_PROFILE || "";
if (profile !== "production") {
  process.exit(0);
}

const required = ["EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
const markers = ["placeholder", "your-project", "your-supabase", "changeme"];
const bad = required.filter((key) => {
  const value = (process.env[key] || "").trim();
  return !value || markers.some((m) => value.toLowerCase().includes(m));
});

// Calls on in production need the public Agora App ID (32 hex characters). The App Certificate is a server secret.
if ((process.env.EXPO_PUBLIC_FEATURE_CALLS || "").trim() === "true"
    && !/^[0-9a-f]{32}$/i.test((process.env.EXPO_PUBLIC_AGORA_APP_ID || "").trim())) {
  bad.push("EXPO_PUBLIC_AGORA_APP_ID (required when EXPO_PUBLIC_FEATURE_CALLS=true)");
}

// A privileged key must never be bundled into the app.
const publishable = (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "").trim();
if (/^sb_secret_/i.test(publishable) || /service_role/i.test(decodeJwtPayload(publishable))) {
  bad.push("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (this is a secret/service-role key, not a publishable key)");
}

function decodeJwtPayload(token) {
  const part = token.split(".")[1];
  if (!part) return "";
  try {
    return require("buffer").Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

if (bad.length > 0) {
  console.error("Production build blocked. Missing or placeholder EAS environment variables:");
  for (const key of bad) console.error("  - " + key);
  console.error("Set them in the EAS 'production' environment (see docs/SECRETS_CHECKLIST.md).");
  process.exit(1);
}
console.log("Release environment check passed.");
