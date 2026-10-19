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
import { pushNotificationToInbox } from "./notifications";
import { generateUUID, isValidUUID } from "../utils/validation";
import { mapMessageRow } from "../utils/messageState";

/**
 * Unread = messages from the other person that are not read and not deleted for everyone.
 * Rows the user deleted for themselves are already excluded by the `members read messages` policy.
 */
async function countUnreadMessages(matchId: string, currentUserId: string): Promise<number> {
  const base = () =>
    supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("match_id", matchId)
      .neq("sender", currentUserId)
      .is("read_at", null);

  const filtered = await base().is("deleted_at", null);
  if (!filtered.error) return filtered.count || 0;

  // `deleted_at` does not exist until the Phase 3A migration is applied; keep the old count rather than showing 0.
  const legacy = await base();
  return legacy.count || 0;
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

    const items: MatchItem[] = [];

    for (const m of matches) {
      const otherId = m.user_a === currentUserId ? m.user_b : m.user_a;

      // Get other user's profile from database
      let otherProfile: Profile | undefined;
      const { data: profRows } = await supabase.rpc("get_public_profile", { _id: otherId });
      const prof = Array.isArray(profRows) ? (profRows[0] as any) : profRows;

      if (prof) {
        const signed = await getSignedUrls(
          "photos",
          Array.isArray(prof.photos) ? prof.photos.map((p: any) => p.path) : [],
        );
        const photos: string[] = Array.isArray(prof.photos)
          ? prof.photos.map((p: any) => (p.path ? signed[p.path] || "" : "")).filter(Boolean)
          : [];

        otherProfile = {
          id: prof.id,
          name: prof.name || "Member",
          age: prof.age || 0,
          city: prof.city || "",
          distanceKm: null,
          bio: prof.bio || "",
          photos,
          interests: prof.interests || [],
          intent: prof.intents?.[0] || "",
        };
      }

      if (otherProfile) {
        // Fetch last message
        const { data: lastMsgs } = await supabase
          .from("messages")
          .select("*")
          .eq("match_id", m.id)
          .order("created_at", { ascending: false })
          .limit(1);

        const last = lastMsgs?.[0];
        let lastMessage: Message | undefined;

        if (last?.deleted_at) {
          // Deleted for everyone: a content-free tombstone, never a media URL.
          lastMessage = mapMessageRow(last, currentUserId);
        } else if (last) {
          lastMessage = {
            id: last.id,
            matchId: m.id,
            sender: last.sender,
            from: last.sender === currentUserId ? "me" : "them",
            text:
              last.message_type === "voice" || last.audio_path
                ? `Voice note ${last.audio_duration_sec ? `(${last.audio_duration_sec}s)` : "🎤"}`
                : last.body,
            at: new Date(last.created_at).getTime(),
            status: last.read_at ? "read" : "sent",
            image: last.image_path ? await getSignedUrl("chat", last.image_path) : undefined,
            audio: last.audio_path ? await getSignedUrl("chat", last.audio_path) : undefined,
            audioDurationSec: last.audio_duration_sec,
            messageType:
              last.message_type || (last.audio_path ? "voice" : last.image_path ? "image" : "text"),
          };
        }

        const unreadCount = await countUnreadMessages(m.id, currentUserId);

        items.push({
          id: m.id,
          otherUser: otherProfile,
          createdAt: m.created_at,
          lastMessage,
          unreadCount,
        });
      }
    }

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

    if (!rpcErr && Array.isArray(rpcData)) {
      rows = rpcData;
    } else {
      // Fallback to table select if RPC is not yet applied
      const { data: tableData, error: tableErr } = await supabase
        .from("messages")
        .select("*")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true });
      if (tableErr || !tableData) return [];
      rows = tableData;
    }

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
    return rows.map((m: any) => mapMessageRow(m, currentUserId, signed));
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
      const { blob, mimeType } = await sanitizeAndPrepareImageUpload(imageUri);
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
    });

    if (error) {
      return { success: false, error: error.message };
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
    });

    if (insertErr) {
      // Clean up orphaned upload on database insert failure
      try {
        await supabase.storage.from("chat").remove([audioPath]);
      } catch {
        // Log non-fatal cleanup error
      }
      return { success: false, error: insertErr.message };
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
    };

    return { success: true, message: newMsg };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to send voice message" };
  }
}

export async function markChatRead(matchId: string, currentUserId: string): Promise<void> {
  try {
    if (!matchId || !isValidUUID(matchId)) return;
    await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("match_id", matchId)
      .neq("sender", currentUserId)
      .is("read_at", null);
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
        if (currentUserId && msg.sender !== currentUserId) {
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
        if (!row?.id || !row.deleted_at) return;
        handlers?.onMessageDeleted?.({ id: row.id, deletedAt: row.deleted_at });
      },
    )
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      if (hasSubscribed) handlers?.onResync?.();
      hasSubscribed = true;
    });
}
