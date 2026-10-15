# Auth settings checklist (project `milo-dev`)

Status: **repo side codified; hosted-project values NOT verified.** `supabase/config.toml` now has an
`[auth]` block that mirrors the app's own rules and drives the local stack. It does not change the hosted
project. Do not run `supabase config push` until the Dashboard values below have been compared.

## 1. What the repository expects

| Setting                 | Expected                                | Why                                                                                                               |
| ----------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| E-mail confirmation     | ON                                      | `signInUser` has an unconfirmed-address path; the app tells people to verify first                                |
| Minimum password length | 8                                       | `validatePassword` requires 8 to 64 characters                                                                    |
| Password requirement    | letters and digits                      | `validatePassword` requires a letter and a number                                                                 |
| Anonymous sign-ins      | OFF                                     | Every feature assumes a real account (profile, onboarding, age check)                                             |
| Sign-ups enabled        | ON                                      | New people must be able to register                                                                               |
| Redirect URL / Site URL | include `chahat://` and `chahat://callback` | Expo scheme and the in-app confirmation/password-recovery callback |
| JWT expiry              | 3600 s                                  | Supabase default; the Edge Function relies on a valid, unexpired token                                            |
| Refresh-token rotation  | ON                                      | Supabase default                                                                                                  |

## 2. Dashboard checks (you do these; paste only what you see, never keys)

Open Authentication in the Dashboard of `milo-dev` and tick off each row of section 1. Then note:

1. Providers: only Email enabled? (Phone needs an SMS provider and India DLT registration; decision D6.)
2. Rate limits page: sign-ins and sign-ups, e-mails sent, token refreshes, OTP. Record the numbers.
3. Custom SMTP: configured, or the built-in sender with its low hourly cap?
4. Leaked-password protection: shown only on some plans; record whether it is available and on.
5. Email templates: do any contain a link that does not use an address you control?
6. Redirect allowlist: include the exact `chahat://callback` URL for signup confirmation and password recovery.

## 3. Web admin target (issue O8)

The web admin reads `VITE_SUPABASE_URL` (see `src/integrations/supabase/client.ts`). Check which project it
points at without printing keys. From the repository root in PowerShell:

```powershell
$line = Select-String -Path .env -Pattern '^VITE_SUPABASE_URL=' -ErrorAction SilentlyContinue
if ($line) { ($line.Line -split '=',2)[1] -replace 'https://([^.]+)\..*','project ref: $1' } else { "no .env or no VITE_SUPABASE_URL" }
```

The result should be `project ref: tuptdzbdowqtmbyhazet`. If it differs, or there is no `.env`, the admin
dashboard cannot moderate real mobile users. Do not paste the key lines.

## 4. Client session storage (verified in code)

`mobile/src/services/supabase.ts` stores the session with `expo-secure-store` on Android and iOS. AsyncStorage
is used only when `Platform.OS === "web"`. Known caveat: every storage call swallows its errors, so a
SecureStore failure (for example a value above the platform's size limit) would silently lose the session
instead of showing an error. Not changed in this phase.

## 5. Applying config to the hosted project later

Only after sections 1 and 2 agree: review `supabase config push --dry-run` output (if your CLI version supports
it) or change the settings in the Dashboard by hand. Never do both at once.
