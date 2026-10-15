import { useEffect, useRef } from "react";
import { Alert } from "../../utils/alert";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../services/supabase";
import { resolveNotificationDestination } from "../../services/notificationPolicy";

export function NotificationResponseHandler() {
  const router = useRouter();
  const { user } = useAuth();
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!user) return;
    let active = true;

    const openDestination = async (response: Notifications.NotificationResponse) => {
      const identifier = response.notification.request.identifier;
      if (handled.current.has(identifier)) return;
      handled.current.add(identifier);

      const data = response.notification.request.content.data;
      if (!data || typeof data !== "object") return;
      const category = data.category;
      const matchId = data.matchId;
      const initialDestination = resolveNotificationDestination(category, matchId, user.id);
      if (initialDestination?.kind === "likes") {
        router.push("/(tabs)/likes");
        return;
      }
      if (initialDestination?.kind === "chat" && typeof matchId === "string") {
        const { data: match, error } = await supabase
          .from("matches")
          .select("id, user_a, user_b")
          .eq("id", matchId)
          .maybeSingle();
        if (!active) return;
        if (error) {
          console.warn("Could not validate notification destination:", error.message);
          Alert.alert("Conversation unavailable", "Please try opening this conversation again.");
          return;
        }
        const destination = resolveNotificationDestination(category, matchId, user.id, match);
        if (destination?.kind === "chat") {
          router.push({ pathname: "/chat/[id]", params: { id: destination.matchId } });
        } else {
          Alert.alert("Conversation unavailable", "This conversation is no longer available.");
        }
      }
    };

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void openDestination(response);
    });
    Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        if (active && response) await openDestination(response);
        await Notifications.clearLastNotificationResponseAsync();
      })
      .catch((error) => console.warn("Could not read notification launch response:", error));

    return () => {
      active = false;
      subscription.remove();
    };
  }, [router, user]);

  return null;
}
