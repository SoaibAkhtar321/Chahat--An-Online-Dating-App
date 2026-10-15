# Milo Dating — React Native & Expo Android App (Google Play Store)

Milo is an intentional dating application engineered for genuine connection, verified profiles, and seamless matching on Android.

## Android Application Architecture

- **Platform Target**: Android 14+ (API Level 34, minimum SDK 24)
- **Application Package**: `com.chahat.dating`
- **Framework**: React Native 0.76 + Expo SDK 52 + Expo Router
- **Native Android Configuration**: `/android` (Android Gradle Plugin, AndroidManifest.xml, strings, styles)
- **Build & Distribution**: EAS Build (`eas.json`) targeting Google Play Store Android App Bundle (`.aab`) and preview APK (`.apk`)

---

## Google Play Store Build & Deployment

### 1. Cloud Build via EAS (Recommended for Google Play Store)

To build a production **Android App Bundle (.aab)** signed for the Google Play Store:

```bash
# Install EAS CLI globally
npm install -g eas-cli

# Log in to your Expo account
eas login

# Build production Android App Bundle (.aab) for Google Play Store
npm run build:bundle
# Or directly:
cd mobile && eas build --platform android --profile production
```

To build a standalone **test APK** for direct installation on physical Android devices:

```bash
npm run build:apk
# Or directly:
cd mobile && eas build --platform android --profile preview
```

### 2. Local Android Studio Build

On a development machine with Android Studio, Java 17+, and Android SDK configured:

```bash
# 1. Install dependencies
npm install

# 2. Run directly on Android emulator or connected device
npm run android
```

---

## Project Structure

```text
├── android/                         # Native Android Gradle project
│   ├── app/
│   │   ├── build.gradle             # Android build config (appId: com.chahat.dating, API 34)
│   │   └── src/main/
│   │       ├── AndroidManifest.xml  # Android manifest with permissions & deep links
│   │       └── res/                 # Android strings, styles, splash theme
│   ├── build.gradle                 # Top-level Gradle configuration
│   ├── gradle.properties            # Hermes engine, AndroidX, JVM memory
│   └── settings.gradle              # Gradle modules
├── app/                             # Expo Router native screen hierarchy
│   ├── (auth)/                      # Welcome, Login, Signup, Reset Password
│   ├── (tabs)/                      # Discover, Explore, Likes, Chats, Profile (Me)
│   ├── onboarding/                  # Profile creation and setup
│   ├── chat/                        # Direct messaging and realtime chat
│   ├── profile/                     # Profile viewer and photo manager
│   ├── settings/                    # Settings, privacy, account controls
│   └── _layout.tsx                  # Root navigation stack & auth gate
├── assets/                          # Android icons, adaptive icons, splash screens
├── metro.config.js                  # React Native Metro bundler
├── babel.config.js                  # Expo & React Native Babel preset
├── jest.config.js                   # React Native Jest test runner
├── index.js                         # Native Android app entry point
└── package.json                     # milo-dating-android package metadata & scripts
```

---

## Environment Configuration

Configuration template is in `.env.example`:

- `EXPO_PUBLIC_SUPABASE_URL`: Supabase project URL
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Public anon key (never use service role)

---

## Verification & Tests

Run test suites for age calculations, swipe limits, input validation, and compatibility algorithms:

```bash
npm test
```
