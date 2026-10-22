# Auth setup: confirmation link (no localhost) + Continue with Google

## Why the confirmation e-mail opened "localhost refused to connect"
The e-mail link goes to Supabase, which then redirects to the app. If the app's address is not in Supabase's allow-list,
Supabase falls back to the project **Site URL**, which defaults to `http://localhost:3000`. On a phone that page does not exist.

Fix (Supabase Dashboard > Authentication > URL Configuration):
1. **Site URL** = `chahat://callback`
2. **Redirect URLs** (add both): `chahat://callback` and `chahat://**`
3. Save, then request a NEW confirmation e-mail (old links keep the old address).

With this, tapping the link on the phone opens the Chahat app and signs the person in. If they open the link on another
device, the "I've confirmed my email" button on the app's confirm screen signs them in.

## Optional: no confirmation e-mail at all
Authentication > Providers > Email > **Confirm email = OFF**. Sign-up then logs the person in immediately and sends no
e-mail (this also avoids Supabase's hourly e-mail rate limit, the real cause of "too many sign-up attempts").
The app supports both settings.

## Continue with Google
1. Google Cloud Console > APIs & Services > Credentials > Create OAuth client ID > **Web application**; add the redirect
   URI shown in Supabase (Authentication > Providers > Google).
2. Paste the Client ID and secret into Supabase > Providers > **Google** and enable it.
3. Make sure `chahat://callback` is in Redirect URLs (above). Rebuild the app (new dependency `expo-web-browser`).
