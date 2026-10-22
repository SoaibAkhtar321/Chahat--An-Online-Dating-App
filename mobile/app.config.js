
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

// Agora's "full" SDK ships ~20 optional native feature libraries per CPU architecture (virtual background, face
// detection, lip sync, AI noise suppression, screen capture, ...). Chahat only uses plain 1:1 voice/video calls, so
// leaving them out cuts tens of MB from the APK. The SDK loads each of these only when its feature is enabled.
const UNUSED_AGORA_NATIVE_LIBS = [
  "libagora_ai_echo_cancellation_extension.so",
  "libagora_ai_echo_cancellation_ll_extension.so",
  "libagora_ai_noise_suppression_extension.so",
  "libagora_ai_noise_suppression_ll_extension.so",
  "libagora_audio_beauty_extension.so",
  "libagora_clear_vision_extension.so",
  "libagora_content_inspect_extension.so",
  "libagora_face_capture_extension.so",
  "libagora_face_detection_extension.so",
  "libagora_lip_sync_extension.so",
  "libagora_pvc_extension.so",
  "libagora_screen_capture_extension.so",
  "libagora_segmentation_extension.so",
  "libagora_spatial_audio_extension.so",
  "libagora_super_resolution_extension.so",
  "libagora_udrm3_extension.so",
  "libagora_drm_loader_extension.so",
  "libagora_video_av1_decoder_extension.so",
  "libagora_video_av1_encoder_extension.so",
  "libagora_video_quality_analyzer_extension.so",
];

const withSlimAgoraNativeLibs = (config) => {
  const { withAppBuildGradle } = require("@expo/config-plugins");

  return withAppBuildGradle(config, (config) => {
    const marker = "// chahat: exclude unused Agora native libraries";
    if (config.modResults.contents.includes(marker)) return config;

    const excludes = UNUSED_AGORA_NATIVE_LIBS.map((lib) => `'**/${lib}'`).join(", ");
    config.modResults.contents +=
      `\n${marker}\nandroid {\n    packagingOptions {\n        jniLibs {\n            excludes += [${excludes}]\n        }\n    }\n}\n`;
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

  return withSlimAgoraNativeLibs(withGooglePlayIapFlavor(config));
};

module.exports.resolveGoogleServicesFile = resolveGoogleServicesFile;
module.exports.UNUSED_AGORA_NATIVE_LIBS = UNUSED_AGORA_NATIVE_LIBS;
