import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { isServiceConfigured } from "../../config/appConfig";
import { promptForPushOnce, registerPushNotificationToken } from "../../services/notifications";

/**
 * Renders nothing. Mounted once the member is inside the app (after sign-in, legal acceptance and onboarding):
 * - asks once for notification consent + the system permission (see promptForPushOnce),
 * - re-registers the device whenever the app returns to the foreground, so notifications start working right after
 *   the person turns the permission on in their phone settings, and a refreshed token is always stored.
 */
export function PushSetup() {
  const { user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!userId || !isServiceConfigured("push")) return;
    void promptForPushOnce(userId);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void registerPushNotificationToken(userId);
    });
    return () => sub.remove();
  }, [userId]);

  return null;
}
