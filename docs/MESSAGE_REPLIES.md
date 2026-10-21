# Message replies (quoted preview)

Long-press a message, tap **Reply**, and the next message you send shows a quote of the original above it. Tapping a quote scrolls to the original.

## How it works

- `messages.reply_to_id` (migration `20260101004900_message_replies.sql`) points at the original. It is set on INSERT only; a client UPDATE can never change it (`messages_reply_guard`).
- `messages_reply_validate` (BEFORE INSERT) refuses a reply whose original is in another chat, does not exist, was deleted for everyone, or was deleted for the sender (`reply_target_unavailable`).
- `get_match_messages` returns the quote built on the server: `reply_sender`, `reply_body` (max 120 chars, text messages only), `reply_kind` (`text` / `image` / `voice`) and `reply_unavailable`. Photos, view-once photos and voice notes never return text or a media path in the quote.
- When the original is deleted for everyone, or deleted for me, the quote shows "Original message unavailable" and no content. A reply that is itself deleted for everyone returns no quote at all.
- Realtime inserts only carry `reply_to_id`. The app quotes it from the loaded chat; if the original is older than what is loaded it refetches once to get the server quote.

## Client map

- `mobile/src/utils/replies.ts` - pure helpers (preview building, labels, unavailable rules, merge of server previews).
- `mobile/src/components/chat/ChatBubble.tsx` - the quote block. `MessageActionSheet.tsx` - the Reply option.
- `mobile/app/chat/[id].tsx` - "Replying to ..." bar, sending, scroll to original.
- `sendChatMessage(..., replyToId)` and `sendVoiceMessage(..., replyToId)` in `mobile/src/services/chat.ts`.

## Not included

- Swipe-to-reply gesture (Reply is in the long-press menu).
- Reply notifications: the push text is the reply's own text, unchanged.
- Replying to a game answer or an icebreaker (those are sent as plain messages).
