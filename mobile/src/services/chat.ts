import { previewForSystemBody } from "../utils/callEvents";
import { supabase, isSupabaseConfigured } from "./supabase";
import type { Message, MatchItem, Profile } from "../types";
import {
  getSignedUrls,
  getSignedUrl,
  imageFileExtension,
  sanitizeAndPrepareImageUpload,
  prepareVoiceUpload,
} from "./storage";
import { DEMO_PROFILES } from "./discovery";
import { compressChatImage } from "../utils/compressImage";
import { pushNotificationToInbox } from "./notifications";
import { generateUUID, isValidUUID } from "../utils/validation";
import { mapMessageRow } from "../utils/messageState";
import { mapReactionRow, type ReactionRow } from "../utils/reactions";
import { fillReplyPreviews, REPLY_TARGET_UNAVAILABLE } from "../utils/replies";

function isReplyTargetError(message: string | undefined): boolean {
  return !!message && message.includes(REPLY_TARGET_UNAVAILABLE);
}

/**
 * Message columns the app may read directly. `read_at` is deliberately absent: members cannot SELECT it
 * (20260101005900); read state comes only from get_match_messages / get_chat_list_state, which apply the
 * Plus/VIP read-receipt rule on the server.
 */
export const MESSAGE_COLUMNS =
  "id, match_id, sender, body, image_path, audio_path, audio_duration_sec, message_type, is_view_once, viewed_at, created_at, deleted_at, delivered_at, reply_to_id";

export interface ChatListState {
  unreadCount: number;
  lastMessageId: string | null;
  /** true/false only when the server says this user may know it; null = unknown / not entitled. */
  lastMessageRead: boolean | null;
}

/** Unread counts (messages from the other person I have not read) and the masked last-message receipt per chat. */
export async function fetchChatListState(matchIds: string[]): Promise<Record<string, ChatListState>> {
  const out: Record<string, ChatListState> = {};
  const ids = matchIds.filter(isValidUUID);
  if (ids.length === 0) return out;
  try {
    const { data, error } = await supabase.rpc("get_chat_list_state", { _match_ids: ids });
    if (error || !Array.isArray(data)) return out;
    for (const row of data as any[]) {
      if (!row?.match_id) continue;
      out[row.match_id] = {
        unreadCount: Number.isFinite(Number(row.unread_count)) ? Math.max(0, Number(row.unread_count)) : 0,
        lastMessageId: row.last_message_id ?? null,
        lastMessageRead: typeof row.last_message_read === "boolean" ? row.last_message_read : null,
      };
    }
  } catch {
    // Badges are best effort.
  }
  return out;
}

export async function fetchUserMatches(currentUserId: string): Promise<MatchItem[]> {
  try {
    const { data: matches, error } = await supabase
      .from("matches")
      .select("id, user_a, user_b, created_at")
      .or(`user_a.eq.${currentUserId},user_b.eq.${currentUserId}`)
      .order("created_at", { ascending: false });

    if (!isSupabaseConfigured()) {
      // Local preview only: backend not configured
      return [
        {
          id: "demo_match_ananya",
          otherUser: DEMO_PROFILES[0]!,
          createdAt: new Date().toISOString(),
          unreadCount: 0,
        },
      ];
    }

    if (error || !matches) {
      console.warn("Matches query failed:", error?.message);
      return [];
    }

    // The app has these matches' messages now: let senders see the delivered tick (fire and forget).
    void markMessagesDelivered();

    // Scale: everything below runs in parallel and photo URLs are signed in ONE batch. Before, each chat was
    // loaded one after another (profile, photo URLs, last message, plus signed URLs for the last message's photo or
    // voice note that the list never shows), so a member with 50 chats waited on ~200 sequential requests every
    // time the list refreshed.
    const otherIdOf = (m: { user_a: string; user_b: string }) => (m.user_a === currentUserId ? m.user_b : m.user_a);
    const [listState, profileRows, lastRows] = await Promise.all([
      fetchChatListState(matches.map((m) => m.id)),
      Promise.all(
        matches.map(async (m) => {
          const { data } = await supabase.rpc("get_public_profile", { _id: otherIdOf(m) });
          return (Array.isArray(data) ? data[0] : data) as any;
        }),
      ),
      Promise.all(
        matches.map(async (m) => {
          const { data } = await supabase
            .from("messages")
            .select(MESSAGE_COLUMNS)
            .eq("match_id", m.id)
            .order("created_at", { ascending: false })
            .limit(1);
          return (data?.[0] as any) ?? null;
        }),
      ),
    ]);

    const photoPaths: string[] = [];
    for (const prof of profileRows) {
      if (prof && Array.isArray(prof.photos)) for (const ph of prof.photos) if (ph?.path) photoPaths.push(ph.path);
    }
    const signed = await getSignedUrls("photos", photoPaths);

    const items: MatchItem[] = [];
    matches.forEach((m, i) => {
      const prof = profileRows[i];
      if (!prof) return;
      const otherProfile: Profile = {
        id: prof.id,
        name: prof.name || "Member",
        age: prof.age || 0,
        city: prof.city || "",
        distanceKm: null,
        bio: prof.bio || "",
        photos: Array.isArray(prof.photos)
          ? prof.photos.map((ph: any) => (ph?.path ? signed[ph.path] || "" : "")).filter(Boolean)
          : [],
        interests: prof.interests || [],
        intent: prof.intents?.[0] || "",
      };

      const last = lastRows[i];
      let lastMessage: Message | undefined;
      if (last?.deleted_at) {
        // Deleted for everyone: a content-free tombstone, never a media URL.
        lastMessage = mapMessageRow(last, currentUserId);
      } else if (last) {
        const kind = last.message_type || (last.audio_path ? "voice" : last.image_path ? "image" : "text");
        lastMessage = {
          id: last.id,
          matchId: m.id,
          sender: last.sender,
          from: last.sender === currentUserId ? "me" : "them",
          text:
            kind === "voice"
              ? `Voice note ${last.audio_duration_sec ? `(${last.audio_duration_sec}s)` : "🎤"}`
              : kind === "system"
                ? previewForSystemBody(last.body, last.sender === currentUserId)
                : kind === "image" && !last.body
                  ? "📷 Photo"
                  : last.body,
          at: new Date(last.created_at).getTime(),
          // "read" only when the server confirms it for this user (Plus/VIP for my own messages).
          status:
            listState[m.id]?.lastMessageId === last.id && listState[m.id]?.lastMessageRead === true
              ? "read"
              : last.delivered_at
                ? "delivered"
                : "sent",
          audioDurationSec: last.audio_duration_sec,
          messageType: kind,
        };
      }

      items.push({
        id: m.id,
        otherUser: otherProfile,
        createdAt: m.created_at,
        lastMessage,
        unreadCount: listState[m.id]?.unreadCount ?? 0,
      });
    });

    return items;
  } catch {
    return [];
  }
}

export async function fetchMessagesForMatch(
  matchId: string,
  currentUserId: string,
): Promise<Message[]> {
  try {
    if (!matchId || !isValidUUID(matchId)) {
      return [];
    }

    // Call server-side RPC get_match_messages (which masks read_at for non-Plus/VIP users)
    let rows: any[] = [];
    const { data: rpcData, error: rpcErr } = await supabase.rpc("get_match_messages", {
      _match_id: matchId,
    });

    // No table fallback: a direct read cannot apply the read-receipt rule (and read_at is not selectable).
    if (rpcErr || !Array.isArray(rpcData)) return [];
    rows = rpcData;

    if (rows.length === 0) return [];

    // Deleted-for-everyone rows are never signed: they have no media, and a stale path must not get a new URL.
    const live = rows.filter((m: any) => !m.deleted_at);
    const mediaPaths = [
      ...live.map((m: any) => m.image_path),
      ...live.map((m: any) => m.audio_path),
    ].filter(Boolean) as string[];

    const signed = await getSignedUrls(
      "chat",
      mediaPaths.filter((path) => {
        // Do not pre-sign unviewed View Once images for recipient; require explicit openViewOnceMessage
        const msg = live.find((r: any) => r.image_path === path);
        return !(msg?.is_view_once && msg?.sender !== currentUserId && !msg?.viewed_at);
      }),
    );
    // Replies whose preview columns are missing (table fallback) are quoted from originals inside this page.
    return fillReplyPreviews(rows.map((m: any) => mapMessageRow(m, currentUserId, signed)));
  } catch {
    return [];
  }
}

export async function sendChatMessage(
  matchId: string,
  senderId: string,
  text: string,
  imageUri?: string,
  isViewOnce = false,
  replyToId?: string | null,
): Promise<{ success: boolean; message?: Message; error?: string }> {
  try {
    if (!matchId || !senderId) {
      return { success: false, error: "Missing matchId or senderId." };
    }

    // Validate that matchId is a valid UUID for database integrity
    if (!isValidUUID(matchId)) {
      // In demo preview mode, only explicit demo_ prefix is supported
      if (matchId.startsWith("demo_") && !isSupabaseConfigured()) {
        const demoMsg: Message = {
          id: generateUUID(),
          matchId,
          sender: senderId,
          from: "me",
          text,
          image: imageUri,
          at: Date.now(),
          status: "sent",
          isViewOnce,
        };
        return { success: true, message: demoMsg };
      }
      return { success: false, error: "Invalid match reference. Please select a valid match." };
    }

    // Generate valid UUID for PostgreSQL messages.id column
    const messageId = generateUUID();
    let imagePath: string | null = null;

    if (imageUri) {
      // Chat accepts animated GIFs (keyboard / gallery); profile photos never do.
      // Photos are shrunk to phone-screen size first (a camera original is often 4–8 MB); GIFs stay untouched.
      let uploadUri = imageUri;
      try {
        uploadUri = await compressChatImage(imageUri);
      } catch {
        // Could not re-encode (unusual format): send the original; the size and type checks below still apply.
        uploadUri = imageUri;
      }
      const { blob, mimeType } = await sanitizeAndPrepareImageUpload(uploadUri, { allowGif: true });
      imagePath = `${matchId}/${messageId}.${imageFileExtension(mimeType)}`;

      const { error: uploadErr } = await supabase.storage.from("chat").upload(imagePath, blob, {
        contentType: mimeType,
      });
      if (uploadErr) return { success: false, error: uploadErr.message };
    }

    const { error } = await supabase.from("messages").insert({
      id: messageId,
      match_id: matchId,
      sender: senderId,
      body: text.slice(0, 1000),
      image_path: imagePath,
      message_type: imagePath ? "image" : "text",
      is_view_once: isViewOnce,
      expires_at: isViewOnce ? new Date(Date.now() + 14 * 86400 * 1000).toISOString() : null,
      created_at: new Date().toISOString(),
      ...(replyToId ? { reply_to_id: replyToId } : {}),
    });

    if (error) {
      if (imagePath) {
        // The photo was uploaded before the insert: do not leave an orphan behind.
        try {
          await supabase.storage.from("chat").remove([imagePath]);
        } catch {
          // Non-fatal cleanup error
        }
      }
      return { success: false, error: isReplyTargetError(error.message) ? REPLY_TARGET_UNAVAILABLE : error.message };
    }

    const newMsg: Message = {
      id: messageId,
      matchId,
      sender: senderId,
      from: "me",
      text,
      image: imagePath ? ((await getSignedUrl("chat", imagePath)) ?? imageUri) : imageUri,
      messageType: imagePath ? "image" : "text",
      isViewOnce,
      viewedAt: null,
      at: Date.now(),
      status: "sent",
      ...(replyToId ? { replyToId } : {}),
    };

    return { success: true, message: newMsg };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to send message" };
  }
}

/**
 * Server-authorized single-use opening of a View Once photo.
 * Enforces atomic consumption and single-view access on the backend.
 */
export async function openViewOnceMessage(
  messageId: string,
): Promise<{ success: boolean; imageUri?: string; error?: string }> {
  try {
    if (!messageId || !isValidUUID(messageId)) {
      return { success: false, error: "Invalid message reference." };
    }
    if (!isSupabaseConfigured()) {
      return { success: false, error: "Backend is not configured." };
    }

    const { data, error } = await supabase.rpc("open_view_once_message", {
      _message_id: messageId,
    });

    if (error) {
      return { success: false, error: error.message };
    }
    if (!data?.success) {
      return {
        success: false,
        error: data?.error === "already_viewed" ? "already_viewed" : data?.error || "Could not open photo",
      };
    }

    const imagePath = data.image_path as string | undefined;
    if (!imagePath) {
      return { success: false, error: "Media path not found." };
    }

    const signedUrl = await getSignedUrl("chat", imagePath);
    if (!signedUrl) {
      return { success: false, error: "Failed to generate media access." };
    }

    return { success: true, imageUri: signedUrl };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to open View Once media." };
  }
}

/**
 * Securely uploads a voice recording to the private chat bucket and inserts a message record.
 * Handles storage rollback and cleanup if database insertion fails.
 */
export async function sendVoiceMessage(
  matchId: string,
  senderId: string,
  audioUri: string,
  durationSec: number,
  declaredMimeType = "audio/m4a",
  replyToId?: string | null,
): Promise<{ success: boolean; message?: Message; error?: string }> {
  try {
    if (!matchId || !senderId || !audioUri) {
      return { success: false, error: "Missing matchId, senderId, or audioUri." };
    }

    if (!isValidUUID(matchId)) {
      if (matchId.startsWith("demo_") && !isSupabaseConfigured()) {
        const demoMsg: Message = {
          id: generateUUID(),
          matchId,
          sender: senderId,
          from: "me",
          text: "Voice message",
          audio: audioUri,
          audioDurationSec: durationSec,
          messageType: "voice",
          at: Date.now(),
          status: "sent",
        };
        return { success: true, message: demoMsg };
      }
      return { success: false, error: "Invalid match reference. Please select a valid match." };
    }

    const { blob, mimeType, extension } = await prepareVoiceUpload(
      audioUri,
      durationSec,
      declaredMimeType,
    );

    const messageId = generateUUID();
    const audioPath = `${matchId}/voice_${messageId}.${extension}`;

    // Upload voice recording to private chat storage
    const { error: uploadErr } = await supabase.storage.from("chat").upload(audioPath, blob, {
      contentType: mimeType,
    });
    if (uploadErr) {
      return { success: false, error: uploadErr.message };
    }

    // Insert message into database with rollback cleanup on error
    const { error: insertErr } = await supabase.from("messages").insert({
      id: messageId,
      match_id: matchId,
      sender: senderId,
      body: "Voice message",
      audio_path: audioPath,
      audio_duration_sec: Math.max(1, Math.min(300, Math.round(durationSec))),
      message_type: "voice",
      created_at: new Date().toISOString(),
      ...(replyToId ? { reply_to_id: replyToId } : {}),
    });

    if (insertErr) {
      // Clean up orphaned upload on database insert failure
      try {
        await supabase.storage.from("chat").remove([audioPath]);
      } catch {
        // Log non-fatal cleanup error
      }
      return {
        success: false,
        error: isReplyTargetError(insertErr.message) ? REPLY_TARGET_UNAVAILABLE : insertErr.message,
      };
    }

    const signedUrl = (await getSignedUrl("chat", audioPath)) ?? audioUri;
    const newMsg: Message = {
      id: messageId,
      matchId,
      sender: senderId,
      from: "me",
      text: "Voice message",
      audio: signedUrl,
      audioDurationSec: durationSec,
      messageType: "voice",
      at: Date.now(),
      status: "sent",
      ...(replyToId ? { replyToId } : {}),
    };

    return { success: true, message: newMsg };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to send voice message" };
  }
}

/**
 * Tells the server that this user's app has received incoming messages (sender sees the double tick).
 * Pass a match id for one chat, or nothing for every chat of this user. Never throws.
 */
export async function markMessagesDelivered(matchId?: string): Promise<void> {
  try {
    if (matchId && !isValidUUID(matchId)) return;
    await supabase.rpc("mark_messages_delivered", { _match_id: matchId ?? null });
  } catch {
    // Delivery ticks are best effort; the next refresh retries.
  }
}

/**
 * Fresh tick state for a chat, read through get_match_messages so read receipts stay masked for senders without them.
 * No table fallback on purpose (it would expose read_at), no media signing (only statuses are used). [] on any error.
 */
export async function fetchMessageReceipts(matchId: string, currentUserId: string): Promise<Message[]> {
  try {
    if (!matchId || !isValidUUID(matchId)) return [];
    const { data, error } = await supabase.rpc("get_match_messages", { _match_id: matchId });
    if (error || !Array.isArray(data)) return [];
    return data.map((row: any) => mapMessageRow(row, currentUserId));
  } catch {
    return [];
  }
}

/** Current (non-removed) reactions of a chat. RLS limits this to members and to live, visible messages. [] on error. */
export async function fetchReactionsForMatch(matchId: string): Promise<ReactionRow[]> {
  try {
    if (!matchId || !isValidUUID(matchId)) return [];
    const { data, error } = await supabase
      .from("message_reactions")
      .select("message_id, user_id, emoji")
      .eq("match_id", matchId)
      .not("emoji", "is", null)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (error || !Array.isArray(data)) return [];
    return data.map(mapReactionRow).filter((r): r is ReactionRow => !!r);
  } catch {
    return [];
  }
}

export type SetReactionResult = { success: true } | { success: false; error: string };

/** Sets (or, with null, removes) the caller's reaction on a message through the server function. Never throws. */
export async function setMessageReaction(messageId: string, emoji: string | null): Promise<SetReactionResult> {
  try {
    if (!messageId || !isValidUUID(messageId)) return { success: false, error: "message_not_found" };
    const { data, error } = await supabase.rpc("set_message_reaction", { _message_id: messageId, _emoji: emoji });
    if (error) return { success: false, error: "network" };
    if (data && (data as any).success === true) return { success: true };
    return { success: false, error: String((data as any)?.error ?? "unknown") };
  } catch {
    return { success: false, error: "network" };
  }
}

export async function markChatRead(matchId: string, _currentUserId?: string): Promise<void> {
  try {
    if (!matchId || !isValidUUID(matchId)) return;
    // Server-timed and member-checked; marks only the other person's messages.
    await supabase.rpc("mark_chat_read", { _match_id: matchId });
  } catch {
    // Ignore mark read errors
  }
}

export interface MatchMessageHandlers {
  /** A message of this match was deleted for everyone (Realtime UPDATE carrying `deleted_at`). */
  onMessageDeleted?: (event: { id: string; deletedAt: string }) => void;
  /**
   * The channel re-subscribed after a drop. Events (including deletions) may have been missed meanwhile,
   * so the caller should refetch. Not called for the first subscription.
   */
  onResync?: () => void;
  /**
   * One of MY messages got a delivered/read timestamp (Realtime UPDATE). The payload is deliberately not used for the
   * tick itself: Realtime never carries read_at (members cannot SELECT it), so the caller refetches through the RPC.
   */
  onReceiptChanged?: () => void;
  /** Someone in this chat set or removed a reaction (Realtime INSERT/UPDATE on message_reactions). */
  onReaction?: (row: ReactionRow) => void;
}

export function subscribeToMatchMessages(
  matchId: string,
  onMessageReceived: (msg: Message) => void,
  currentUserId?: string,
  handlers?: MatchMessageHandlers,
) {
  let hasSubscribed = false;

  return supabase
    .channel(`match_${matchId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `match_id=eq.${matchId}`,
      },
      (payload) => {
        const msg = payload.new;
        if (!msg) return;
        onMessageReceived(mapMessageRow(msg, currentUserId ?? ""));

        // If the incoming message is from the other user, dispatch to in-app notifications
        if (currentUserId && msg.sender !== currentUserId && msg.message_type !== "system") {
          pushNotificationToInbox(currentUserId, {
            kind: "message",
            title: "New Message",
            text: msg.body
              ? msg.body.length > 50
                ? `${msg.body.slice(0, 50)}...`
                : msg.body
              : "Sent a photo",
            data: {
              matchId,
              senderId: msg.sender,
            },
          }).catch(() => {});
        }
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "messages",
        filter: `match_id=eq.${matchId}`,
      },
      (payload) => {
        // Only tombstones are handled. read_at / viewed_at changes are deliberately ignored here:
        // read receipts are masked by get_match_messages for non-Plus users and Realtime would bypass that.
        const row: any = payload.new;
        if (!row?.id) return;
        if (row.deleted_at) {
          handlers?.onMessageDeleted?.({ id: row.id, deletedAt: row.deleted_at });
          return;
        }
        if (currentUserId && row.sender === currentUserId && (row.delivered_at || row.read_at)) {
          handlers?.onReceiptChanged?.();
        }
      },
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "message_reactions",
        filter: `match_id=eq.${matchId}`,
      },
      (payload) => {
        const row = mapReactionRow(payload.new);
        if (row) handlers?.onReaction?.(row);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "message_reactions",
        filter: `match_id=eq.${matchId}`,
      },
      (payload) => {
        const row = mapReactionRow(payload.new);
        if (row) handlers?.onReaction?.(row);
      },
    )
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      if (hasSubscribed) handlers?.onResync?.();
      hasSubscribed = true;
    });
}
