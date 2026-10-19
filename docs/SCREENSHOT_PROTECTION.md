# Chat screenshot protection (Phase 3C)

While a conversation is on screen, Android blocks screenshots and screen recording and hides the app's
Recents thumbnail. This uses `FLAG_SECURE` on the activity window through `expo-screen-capture` (`~7.0.1`, the
SDK 52 release; it adds no permissions and no config plugin).

## How it works

- `mobile/src/services/screenProtection.ts` owns the native switch. Each screen that wants protection calls
  `acquireScreenProtection()` and gets a release function. Protection stays on until the last holder releases,
  and releasing twice is harmless, so two screens can never switch each other off.
- `mobile/src/hooks/useScreenProtection.ts` ties a screen to that service with `useFocusEffect`. The release
  runs when the screen loses focus (profile or call pushed on top), when it unmounts (back, sign-out) and when
  a render error tears it down.
- `mobile/app/chat/[id].tsx` calls `useScreenProtection()`. Any future sensitive screen can do the same.
- Native calls run one at a time and always apply the state wanted at that moment. If a native call fails
  (for example no activity attached yet), the stale key that `expo-screen-capture` keeps in JS is cleared and the
  call is retried twice (400 ms, 1.5 s) before one warning is logged. The next acquire/release starts fresh.
- When the app returns to the foreground with a chat open, the flag is applied again, in case Android recreated
  the activity (font size or language change), which would otherwise lose it. Keys are swapped, not
  allow-then-prevent, so there is no unprotected moment.

## Platform limits

- **Android only.** On iOS and web this is a deliberate no-op: expo-screen-capture can block screen recording
  on iOS but not screenshots, so enabling it would suggest protection that does not exist.
- `FLAG_SECURE` belongs to the activity window. React Native `Modal`s (message action sheet, confirm dialogs,
  couple games) open in their own windows and are not covered by it; the chat behind them is still blanked,
  and none of them shows message text.
- Not covered: the chat list's last-message previews (`app/(tabs)/chats.tsx`), notification text, another
  camera pointed at the screen, rooted or modified devices.
- Protection is applied right after the screen's first render, in a few milliseconds; message content only
  arrives after a network fetch, so it is not visible before then.
- This is a native feature: a build that does not include `expo-screen-capture` (an older development build)
  cannot protect anything. The service then logs one warning and the chat still works. Rebuild the app
  (`expo run:android` or an EAS build) to get it.

## Manual check on a device

1. Open a chat, take a screenshot: it is blocked or black, and a screen recording shows a black chat.
2. Open the app switcher: the chat thumbnail is blank.
3. From the chat open a profile or start a call, take a screenshot: allowed (no chat content showing).
4. Go back to the chat: blocked again. Leave the chat to the chat list or tabs: screenshots work again.
5. Open chat A, then chat B from a notification: still blocked throughout.
