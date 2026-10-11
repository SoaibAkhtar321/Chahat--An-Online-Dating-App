# Milo Dating App — Native Android (React Native + Expo)

Milo is a genuine native Android dating application built with **React Native**, **Expo (SDK 52)**, **TypeScript**, and **Supabase (Auth, PostgreSQL, Row Level Security, Storage, Realtime)**.

The app faithfully preserves the original design identity: warm off-white canvas (`#FAF7F5`), terracotta brand identity (`#C84630`), dark plum ink (`#301F29`), custom typography, curved card aesthetics, and natural interactive flows.

---

## 1. Project Architecture

```
/mobile
├── app.json                    # Expo project configuration (package: com.milo.dating)
├── package.json                # React Native + Expo dependencies
├── tsconfig.json               # TypeScript configuration with @/ alias
├── .env.example                # Environment variables template
├── __tests__/                  # Unit and integration test suites
│   ├── age.test.ts             # Date of birth & age calculation validation
│   ├── compatibility.test.ts   # Compatibility matching algorithms
│   ├── quota.test.ts           # IST midnight daily like quota resets
│   └── validation.test.ts      # Password complexity and custom interest rules
├── app/                        # Expo Router screen tree
│   ├── _layout.tsx             # Root layout (AuthProvider, MiloProvider, SafeArea)
│   ├── index.tsx               # Auth & onboarding gatekeeper
│   ├── (auth)/
│   │   ├── welcome.tsx         # Welcome splash with hero photo card
│   │   ├── login.tsx           # Email/password login with forgot password
│   │   ├── signup.tsx          # 18+ registration & password strength check
│   │   ├── verify.tsx          # Email verification pending & resend
│   │   └── reset-password.tsx  # Password reset flow
│   ├── onboarding/
│   │   └── index.tsx           # 12-step onboarding wizard
│   ├── (tabs)/
│   │   ├── _layout.tsx         # Native bottom navigation bar with unread badges
│   │   ├── discover.tsx        # Card deck, gestures, like/pass, IST quotas, filters
│   │   ├── likes.tsx           # Incoming likes grid with blurred previews
│   │   ├── chats.tsx           # New matches row & active message threads
│   │   └── me.tsx              # Profile completeness ring & account actions
│   ├── chat/[id].tsx           # Realtime messaging, photo sending, report/block/unmatch
│   ├── profile/[id].tsx        # Photo carousel, compatibility %, bio, prompts
│   ├── match/[id].tsx          # Celebration modal ("It's a Match!")
│   ├── settings/index.tsx      # Account, notification toggles, privacy, DELETE flow
│   ├── safety/index.tsx        # Safety guidelines & Indian emergency helplines
│   ├── verification/index.tsx  # Camera selfie capture & review submission
│   ├── notifications/index.tsx # In-app notification center
│   ├── premium/index.tsx       # Free vs Plus vs Pro transparency disclosure
│   ├── calls/index.tsx         # Audio/video calls rules & log
│   ├── call/[id].tsx           # Live call interface with mute/camera toggles
│   ├── explore/index.tsx       # Passions & interest categories
│   └── legal/
│       ├── terms.tsx           # Terms of Service (DPDP Act aligned)
│       └── privacy.tsx         # Privacy Policy
└── src/
    ├── constants/theme.ts      # Colors, typography, radii, shadows
    ├── types/index.ts          # Strongly typed TypeScript interfaces
    ├── utils/validation.ts     # Pure validation logic (age, dob, quotas)
    ├── services/
    │   ├── supabase.ts         # Supabase client with Expo SecureStore
    │   ├── auth.ts             # Managed auth operations
    │   ├── profile.ts          # Profile CRUD & photo uploads
    │   ├── discovery.ts        # City-only discovery & IST quota swipe RPC
    │   ├── chat.ts             # Realtime messaging & storage
    │   └── moderation.ts       # Blocking, reporting, unmatching
    └── context/
        ├── AuthContext.tsx     # Session management & user profile state
        └── MiloContext.tsx     # Discovery deck, quota counters, match listeners
```

---

## 2. Setup & Running in Windows PowerShell

### Prerequisites

- **Node.js**: v20 or v22 LTS ([nodejs.org](https://nodejs.org))
- **Git**: Installed and in PATH
- **Expo Go App**: Installed on your Android phone from Google Play Store (for wireless testing)
- **Android Studio** (optional, for local Android Emulator): with Android SDK Platform 34+ and Android Virtual Device (AVD)

### Step-by-Step PowerShell Commands

1. Open **Windows PowerShell** and navigate to the mobile folder:

```powershell
cd mobile
```

2. Configure your environment variables:

```powershell
Copy-Item .env.example .env
```

Edit `.env` to include your Supabase URL and Publishable key:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

3. Install project dependencies:

```powershell
npm install
```

4. Run the automated test suite:

```powershell
npm test
```

5. Launch the Expo Development Server:

```powershell
npx expo start
```

---

## 3. Launching on an Android Device

### Option A: Testing Wirelessly via Expo Go (Fastest)

1. Ensure your Android phone and computer are on the same Wi-Fi network.
2. Run in PowerShell:
   ```powershell
   npx expo start
   ```
3. Open the **Expo Go** app on your Android device.
4. Tap **Scan QR code** and scan the QR code displayed in your terminal or browser window.
5. The Metro bundler will build the JavaScript bundle and the app will load immediately on your phone.

### Option B: Running on an Android Virtual Device (Emulator)

1. Start your Android Emulator in Android Studio Device Manager.
2. Run in PowerShell:
   ```powershell
   npx expo start --android
   ```
3. Expo will automatically detect the running emulator, install the Expo client if needed, and launch Milo.

---

## 4. Building an Installable APK and Play Store App Bundle (AAB)

Milo uses **EAS (Expo Application Services) Build** to produce production-grade Android binaries.

### Step 1: Install EAS CLI and Log In

```powershell
npm install -g eas-cli
eas login
```

### Step 2: Configure EAS Build

```powershell
eas build:configure
```

This generates an `eas.json` file. Ensure the following profiles are present:

```json
{
  "cli": { "version": ">= 12.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "app-bundle"
      }
    }
  }
}
```

### Step 3: Build an Installable Android APK (Internal Testing / Sideloading)

To build a standalone `.apk` file that can be downloaded and installed directly on any Android device without Expo Go:

```powershell
eas build -p android --profile preview
```

When the build completes, EAS will provide a direct download link and QR code to download the `.apk` directly to your phone.

### Step 4: Build a Google Play Store App Bundle (.aab)

To build a release Android App Bundle for submission to the Google Play Console:

```powershell
eas build -p android --profile production
```

The resulting `.aab` is optimized with Google Play dynamic delivery and ready for upload to your Google Play Console release track.

---

## 5. Backend Migrations & Security Hardening

The database migrations are located in:

- `supabase/migrations/0000_migration.sql` (Core tables: profiles, swipes, matches, messages, reports, RLS)
- `supabase/migrations/0001_migration.sql` (Storage buckets & folder security policies)
- `supabase/migrations/0002_admin_moderation.sql` (Moderation audit logging & suspension enforcement)
- `supabase/migrations/0003_mobile_security_hardening.sql` (Hardened security rules for Android release)

### Security Guarantees Enforced:

1. **DOB Immutability**: The `profiles_guard()` trigger prevents modifying `dob` once initially set. Corrections require support assistance. Full DOB is never returned to other users—only calculated age.
2. **IST Midnight Quota Reset**: The `record_swipe` RPC enforces daily limits according to India Standard Time (`Asia/Kolkata` calendar date).
3. **Server-Enforced Matches**: The client cannot manufacture matches. Matches are created exclusively inside the database transaction trigger `on_swipe` or `record_swipe`.
4. **City-Only Discovery**: The server query filters profiles by city, automatically excluding blocked members and inactive accounts.
5. **Secure Account Deletion**: the `delete-account` Edge Function (committed, not yet deployed) removes the user's Storage files, calls the service-role-only `purge_user_data()`, and then deletes the Auth user, while retaining an audit record. See `docs/ACCOUNT_DELETION.md`.
