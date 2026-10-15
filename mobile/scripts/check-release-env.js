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

if (bad.length > 0) {
  console.error("Production build blocked. Missing or placeholder EAS environment variables:");
  for (const key of bad) console.error("  - " + key);
  console.error("Set them in the EAS 'production' environment (see docs/SECRETS_CHECKLIST.md).");
  process.exit(1);
}
console.log("Release environment check passed.");
