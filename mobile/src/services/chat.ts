import { supabase, isSupabaseConfigured } from "./supabase";
import type { Message, MatchItem, Profile } from "../types";
import { getSignedUrls, getSignedUrl, imageFileExtension, sanitizeAndPrepareImageUpload } from "./storage";
import { DEMO_PROFILES } from "./discovery";
import { pushNotificationToInbox } from "./notifications";
import { generateUUID, isValidUUID } from "../utils/validation";

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
            distanceKm: 0,
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

        if (last) {
          lastMessage = {
            id: last.id,
            matchId: m.id,
            sender: last.sender,
            from: last.sender === currentUserId ? "me" : "them",
            text: last.body,
            at: new Date(last.created_at).getTime(),
            status: last.read_at ? "read" : "sent",
            image: last.image_path ? await getSignedUrl("chat", last.image_path) : undefined,
          };
        }

        // Count unread
        const { count } = await supabase
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("match_id", m.id)
          .neq("sender", currentUserId)
          .is("read_at", null);

        items.push({
          id: m.id,
          otherUser: otherProfile,
          createdAt: m.created_at,
          lastMessage,
          unreadCount: count || 0,
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

    const signed = await getSignedUrls(
      "chat",
      rows.map((m: any) => m.image_path).filter(Boolean) as string[],
    );
    return rows.map((m: any) => ({
      id: m.id,
      matchId: m.match_id,
      sender: m.sender,
      from: m.sender === currentUserId ? "me" : "them",
      text: m.body,
      at: new Date(m.created_at).getTime(),
      status: m.read_at ? "read" : "sent",
      image: m.image_path ? signed[m.image_path] : undefined,
    }));
  } catch {
    return [];
  }
}

export async function sendChatMessage(
  matchId: string,
  senderId: string,
  text: string,
  imageUri?: string,
): Promise<{ success: boolean; message?: Message; error?: string }> {
  try {
    if (!matchId || !senderId) {
      return { success: false, error: "Missing matchId or senderId." };
    }

    // Validate that matchId is a valid UUID for database integrity
    if (!isValidUUID(matchId)) {
      // In demo/test preview mode where match is a non-UUID demo string:
      if (!isSupabaseConfigured() || matchId.startsWith("demo_")) {
        const demoMsg: Message = {
          id: generateUUID(),
          matchId,
          sender: senderId,
          from: "me",
          text,
          image: imageUri,
          at: Date.now(),
          status: "sent",
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
      image: imagePath ? (await getSignedUrl("chat", imagePath)) ?? imageUri : imageUri,
      at: Date.now(),
      status: "sent",
    };

    return { success: true, message: newMsg };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to send message" };
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

export function subscribeToMatchMessages(
  matchId: string,
  onMessageReceived: (msg: any) => void,
  currentUserId?: string,
) {
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
        onMessageReceived(msg);

        // If the incoming message is from the other user, dispatch to in-app notifications
        if (currentUserId && msg && msg.sender !== currentUserId) {
          pushNotificationToInbox({
            kind: "message",
            title: "New Message",
            text: msg.body ? (msg.body.length > 50 ? `${msg.body.slice(0, 50)}...` : msg.body) : "Sent a photo",
            data: {
              matchId,
              senderId: msg.sender,
            },
          }).catch(() => {});
        }
      },
    )
    .subscribe();
}
