import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isPhoneInAnotherCall } from "../services/deviceCallState";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { Alert } from "../utils/alert";
import { useAuth } from "./AuthContext";
import { isCallingAvailable } from "../services/callMedia";
import { buildExistingCallRoute } from "../services/calls";
import { fetchCallSync, subscribeToCallEvents } from "../services/callSignaling";
import { transitionVideoCall } from "../services/calls";
import { isCallPushData } from "../services/callNotificationPolicy";
import {
  dismissCallNotifications,
  ensureCallNotificationSetup,
  startInAppRing,
  stopInAppRing,
} from "../services/callNotifications";
import {
  createIncomingCallController,
  type IncomingCallController,
  type IncomingCallView,
} from "../services/incomingCallController";

const IncomingCallContext = createContext<IncomingCallController | null>(null);

export function IncomingCallProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const controller = useMemo(
    () =>
      createIncomingCallController({
        fetchSync: fetchCallSync,
        transition: (callId, action) => transitionVideoCall(callId, action),
        openCall: (route) =>
          routerRef.current.push(
            buildExistingCallRoute({ id: route.callId, match_id: route.matchId, call_type: route.callType }),
          ),
        dismissNotifications: dismissCallNotifications,
        startRinging: startInAppRing,
        stopRinging: stopInAppRing,
        tell: (title, message) => Alert.alert(title, message),
        isCallingAvailable: () => isCallingAvailable(),
        isPhoneBusy: () => isPhoneInAnotherCall(),
        now: () => Date.now(),
      }),
    [],
  );

  // One lifecycle for the signed-in account. Signing out or switching accounts stops the ring, clears
  // every call notification and drops all call state, so nothing leaks to the next account.
  useEffect(() => {
    if (!userId) {
      controller.stop();
      return;
    }
    void ensureCallNotificationSetup().catch((error) =>
      console.warn("Could not set up the call notification channel:", error),
    );
    void controller.start(userId);
    return () => controller.stop();
  }, [controller, userId]);

  // Realtime signaling (only when a call can actually be connected) with a snapshot on every
  // (re)connection, plus a snapshot whenever the app returns to the foreground.
  useEffect(() => {
    if (!userId || !isCallingAvailable()) return;
    const resync = () => void controller.sync().catch(() => undefined);
    const unsubscribe = subscribeToCallEvents(userId, controller.handleEvent, resync);
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") resync();
    });
    // A call push that arrives while the app is open is a hint: confirm it with the server.
    const received = Notifications.addNotificationReceivedListener((notification) => {
      if (isCallPushData(notification.request.content.data)) resync();
    });
    return () => {
      unsubscribe();
      appState.remove();
      received.remove();
    };
  }, [controller, userId]);

  return <IncomingCallContext.Provider value={controller}>{children}</IncomingCallContext.Provider>;
}

export function useIncomingCallController(): IncomingCallController | null {
  return useContext(IncomingCallContext);
}

export function useIncomingCallView(): IncomingCallView {
  const controller = useIncomingCallController();
  const [view, setView] = useState<IncomingCallView>(() => controller?.getView() ?? { ringing: null });
  useEffect(() => {
    if (!controller) return;
    setView(controller.getView());
    return controller.subscribe(() => setView(controller.getView()));
  }, [controller]);
  return view;
}
