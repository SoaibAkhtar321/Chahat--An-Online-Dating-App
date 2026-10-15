// Dynamic Expo config. Reads app.json and adds the Firebase (FCM) file ONLY when it exists, so
// builds work with or without push credentials. See docs/PUSH_SETUP.md.
const fs = require("fs");
const path = require("path");

// Priority: EAS file variable GOOGLE_SERVICES_JSON (CI/EAS), then ./google-services.json (local).
function resolveGoogleServicesFile({ envPath, projectDir, exists = fs.existsSync }) {
  if (envPath && exists(envPath)) return envPath;
  if (exists(path.join(projectDir, "google-services.json"))) return "./google-services.json";
  return null;
}

module.exports = ({ config }) => {
  const googleServicesFile = resolveGoogleServicesFile({
    envPath: process.env.GOOGLE_SERVICES_JSON,
    projectDir: __dirname,
  });
  if (!googleServicesFile) return config;
  return { ...config, android: { ...config.android, googleServicesFile } };
};
module.exports.resolveGoogleServicesFile = resolveGoogleServicesFile;
