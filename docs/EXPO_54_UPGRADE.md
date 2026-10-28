# Expo SDK 54 upgrade (branch `expo-sdk-54`) — status 2026-10-28

Goal: target Android 16 (API 36), required by Google Play for new apps and updates since 31 Aug 2026
(extension possible until 1 Nov 2026).

## Done and verified here

| Item | Result |
|---|---|
| Expo 52 → **54.0.38**, React Native 0.76 → **0.81.5**, React 18 → **19.1**, expo-router 4 → **6** | installed (`npm install --legacy-peer-deps`, see note) |
| All Expo modules aligned to SDK 54 (`npx expo install --check`, offline map) | OK |
| Generated Android project (`npx expo prebuild -p android` in a scratch copy) | **targetSdk 36, compileSdk 36**, AGP 8.11, Gradle 8.14.3, New Architecture on, Hermes, `edgeToEdgeEnabled=true`; the Play-store flavour and Agora library-trimming config plugins applied |
| TypeScript | 0 errors after 2 fixes: `expo-notifications` 0.32 replaced `shouldShowAlert` with `shouldShowBanner`/`shouldShowList`; `expo-image` no longer accepts `{ uri: undefined }` |
| Lint | 0 errors |
| Jest | 111 suites, 1135/1135 |
| Android JS bundle (`expo export -p android`) | OK, 3,126 modules |
| Safe areas | all 31 screens already use `react-native-safe-area-context` (the RN `SafeAreaView` that breaks edge-to-edge is not used) |
| Unused `react-native-reanimated` in the root test manifest | removed (SDK 54's babel preset would otherwise require `react-native-worklets`) |

`.npmrc` (root and `mobile/`) sets `legacy-peer-deps=true`: react-native-iap 12 and a few older packages declare
peer ranges npm cannot reconcile with React 19. Verified: `npm ci` succeeds in both folders with it (fails without).

## Not verified (no Android SDK / Maven access here)

* **Gradle release build**: run `eas build -p android --profile preview` on this branch first.
* Native modules on RN 0.81 / New Architecture: react-native-agora 4.6.4 (declares namespace, supports new arch),
  react-native-iap 12.16.4 (legacy module, relies on the interop layer; Java 1.8 settings), expo-av 16
  (deprecated; removed in SDK 55 — migrate to expo-audio/expo-video before SDK 55).
* Edge-to-edge can no longer be turned off on Android 16: check every screen for content under the status bar,
  the gesture bar, and the keyboard.

## Blocker found: Google Play Billing Library 7

react-native-iap **12.x and 13.x** bundle Play Billing Library **7.0.0**. Google: "Version 7: last date to
release new apps or updates **Aug 31, 2026**" (extension request until Nov 1, 2026). Billing Library 8 requires
react-native-iap **14+**, which is a rewrite (Nitro modules, new purchase API). The app's purchase code
(`mobile/src/services/subscription.ts`: catalogue load, `requestSubscription` with offer tokens, listeners,
`finishTransaction`, restore) must be ported and then tested with real Play purchases. Overriding the billing
version under react-native-iap 12 is not an option: Billing Library 8 removed APIs it calls.

**Decision needed:** approve the react-native-iap 14 migration (on top of this branch). It cannot be validated
without an EAS build and license-tester purchases.
