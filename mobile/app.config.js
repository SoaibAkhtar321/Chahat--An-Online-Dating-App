
const fs = require("fs");
const path = require("path");

function resolveGoogleServicesFile({
  envPath,
  projectDir,
  exists = fs.existsSync,
}) {
  if (envPath && exists(envPath)) return envPath;

  if (exists(path.join(projectDir, "google-services.json"))) {
    return "./google-services.json";
  }

  return null;
}

const withGooglePlayIapFlavor = (config) => {
  const { withAppBuildGradle } = require("@expo/config-plugins");

  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    const strategy = "missingDimensionStrategy 'store', 'play'";

    if (contents.includes(strategy)) {
      return config;
    }

    const defaultConfigMatch = contents.match(
      /(^\s*defaultConfig\s*\{)/m
    );

    if (!defaultConfigMatch) {
      throw new Error(
        "Could not find defaultConfig in generated android/app/build.gradle"
      );
    }

    const insertionPoint =
      defaultConfigMatch.index + defaultConfigMatch[0].length;

    contents =
      contents.slice(0, insertionPoint) +
      `\n        ${strategy}` +
      contents.slice(insertionPoint);

    config.modResults.contents = contents;
    return config;
  });
};

module.exports = (context) => {
  let config = context.config;

  const googleServicesFile = resolveGoogleServicesFile({
    envPath: process.env.GOOGLE_SERVICES_JSON,
    projectDir: __dirname,
  });

  if (googleServicesFile) {
    config = {
      ...config,
      android: {
        ...config.android,
        googleServicesFile,
      },
    };
  }

  return withGooglePlayIapFlavor(config);
};

module.exports.resolveGoogleServicesFile = resolveGoogleServicesFile;
