import { supabase, isSupabaseConfigured } from "./supabase";
import type { Message, MatchItem, Profile } from "../types";
import { getStoragePublicUrl } from "./profile";
import { DEMO_PROFILES } from "./discovery";
import { calculateAge } from "../utils/validation";

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

      // Get other user's profile
      let otherProfile = DEMO_PROFILES.find((p) => p.id === otherId);

      if (!otherProfile) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("id, name, dob, city, bio, photos, interests, intents, work, education")
          .eq("id", otherId)
          .maybeSingle();

        if (prof) {
          const photos = Array.isArray(prof.photos)
            ? prof.photos.map((p: any) =>
                p.path ? getStoragePublicUrl("photos", p.path) : p.src || "",
              )
            : [];

          otherProfile = {
            id: prof.id,
            name: prof.name || "Member",
            age: prof.dob ? calculateAge(prof.dob) : 0,
            city: prof.city || "",
            distanceKm: 0,
            bio: prof.bio || "",
            photos: photos.length > 0 ? photos : [DEMO_PROFILES[0]!.photos[0]!],
            interests: prof.interests || [],
            intent: prof.intents?.[0] || "",
          };
        }
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
            image: last.image_path ? getStoragePublicUrl("chat", last.image_path) : undefined,
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
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true });

    if (error || !data) {
      return [];
    }

    return data.map((m) => ({
      id: m.id,
      matchId: m.match_id,
      sender: m.sender,
      from: m.sender === currentUserId ? "me" : "them",
      text: m.body,
      at: new Date(m.created_at).getTime(),
      status: m.read_at ? "read" : "sent",
      image: m.image_path ? getStoragePublicUrl("chat", m.image_path) : undefined,
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
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    let imagePath: string | null = null;

    if (imageUri) {
      const response = await fetch(imageUri);
      const blob = await response.blob();
      const ext = "jpg";
      imagePath = `${matchId}/${messageId}.${ext}`;

      const { error: uploadErr } = await supabase.storage.from("chat").upload(imagePath, blob, {
        contentType: "image/jpeg",
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
      image: imagePath ? getStoragePublicUrl("chat", imagePath) : imageUri,
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

export function subscribeToMatchMessages(matchId: string, onMessageReceived: (msg: any) => void) {
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
        onMessageReceived(payload.new);
      },
    )
    .subscribe();
}
