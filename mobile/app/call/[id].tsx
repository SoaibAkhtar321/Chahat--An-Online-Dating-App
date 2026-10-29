import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { safeBack } from "../../src/utils/navigation";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CallVideoStage, type CallSessionWithVideo } from "../../src/services/agoraCallMedia";
import { Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff } from "lucide-react-native";
import { Radii, Typography, ThemeColors, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { ProfilePhoto } from "../../src/components/profile/ProfilePhoto";
import { useMilo } from "../../src/context/MiloContext";
import { useAuth } from "../../src/context/AuthContext";
import { useCallController } from "../../src/hooks/useCallController";
import {
  friendlyCallError,
  isCallingAvailable,
  isPremiumCallError,
  PAID_ALLOWANCE_USED_MESSAGE,
  PREMIUM_CALL_MESSAGE,
} from "../../src/services/callMedia";
import { getUserVideoCallAllowance } from "../../src/services/subscription";
import {
  isPhoneInAnotherCall,
  PHONE_BUSY_ANSWER_MESSAGE,
  PHONE_BUSY_MESSAGE,
} from "../../src/services/deviceCallState";
import { callingUnavailableReason } from "../../src/services/registerCallProvider";
import { formatCallDuration } from "../../src/utils/callEvents";
import {
  createVideoCall,
  getMyVideoCalls,
  markCallConnected,
  CallAllowanceUsedError,
  transitionVideoCall,
  type CallStatus,
  type CallType,
} from "../../src/services/calls";

export default function CallScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { id, callId: routeCallId, type } = useLocalSearchParams<{
    id: string;
    callId?: string;
    type?: CallType;
  }>();
  const { matches } = useMilo();
  const { user } = useAuth();
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [callId, setCallId] = useState(routeCallId);
  const [status, setStatus] = useState<CallStatus | "creating">(
    routeCallId ? "pending" : "creating",
  );
  const [freeSeconds, setFreeSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callKind, setCallKind] = useState<CallType | null>(type === "video" ? type : null);
  // Premium prompt, shown when today's free video-call time is used up (replaces the old "not enough coins").
  const [premiumPrompt, setPremiumPrompt] = useState<string | null>(null);
  const [isFreePlan, setIsFreePlan] = useState(true);
  // Server-covered time ends at this wall-clock moment; the screen counts down to it and hangs up itself.
  const [coveredUntil, setCoveredUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const reportedConnected = useRef(false);
  const callingAvailable = isCallingAvailable();
  const unavailableReason = callingAvailable ? null : callingUnavailableReason();
  const { controller, state: media } = useCallController();
  const partner = matches.find((match) => match.id === id)?.otherUser;
  const partnerPhoto = partner?.photos?.[0];

  const refreshCall = useCallback(async () => {
    if (!callId) return;
    const calls = await getMyVideoCalls();
    const call = calls.find((item) => item.id === callId);
    if (!call) {
      setError("This call is no longer available.");
      return;
    }
    setStatus(call.status);
    setCallKind(call.call_type);
    setRecipientId(call.recipient_id);
    setFreeSeconds(call.free_seconds_remaining);
    setCoveredUntil(
      call.status === "accepted" && call.free_seconds_remaining !== null
        ? Date.now() + call.free_seconds_remaining * 1000
        : null,
    );
  }, [callId]);

  useEffect(() => {
    let cancelled = false;
    if (routeCallId) {
      void getMyVideoCalls()
        .then((calls) => {
          const call = calls.find((item) => item.id === routeCallId);
          if (cancelled) return;
          if (!call) {
            setError("This call is no longer available.");
            setStatus("ended");
            return;
          }
          setStatus(call.status);
          setCallKind(call.call_type);
          setRecipientId(call.recipient_id);
          setFreeSeconds(call.free_seconds_remaining);
        })
        .catch((cause) => {
          if (!cancelled)
            setError(friendlyCallError(cause, "Could not load the call."));
        });
      return () => {
        cancelled = true;
      };
    }

    if (!id || type !== "video") {
      setError("A valid match is required to start a video call.");
      setStatus("ended");
      return;
    }
    if (!callingAvailable) {
      // Never create an invitation for a call that cannot connect.
      setError("Calling is not available yet.");
      setStatus("ended");
      return;
    }
    // Already in a phone / WhatsApp call on this phone: don't ring anyone.
    if (isPhoneInAnotherCall()) {
      setError(PHONE_BUSY_MESSAGE);
      setStatus("ended");
      return;
    }
    // Check today's allowance first, so nobody's phone rings for a call that could not be answered.
    void getUserVideoCallAllowance()
      .then((allowance) => {
        if (cancelled) return null;
        if (allowance.valid && allowance.secondsRemaining <= 0) {
          setIsFreePlan(allowance.isFree);
          if (allowance.isFree) setPremiumPrompt(PREMIUM_CALL_MESSAGE);
          else setError(PAID_ALLOWANCE_USED_MESSAGE);
          setStatus("ended");
          return null;
        }
        return createVideoCall(id, type);
      })
      .then((created) => {
        if (!created) return;
        if (cancelled) return;
        setCallId(created.callId);
        setStatus("pending");
      })
      .catch((cause) => {
        if (!cancelled) {
          if (cause instanceof CallAllowanceUsedError) {
            setIsFreePlan(cause.isFree);
            if (cause.isFree) setPremiumPrompt(PREMIUM_CALL_MESSAGE);
            else setError(PAID_ALLOWANCE_USED_MESSAGE);
          } else {
            setError(friendlyCallError(cause, "Could not start the call. Please try again."));
          }
          setStatus("ended");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, type, routeCallId, callingAvailable]);

  // Join the media session once the server reports the call as accepted. The controller ignores
  // duplicate requests, and the server re-checks authorization when issuing the token.
  useEffect(() => {
    if (
      status === "accepted" &&
      callId &&
      callKind &&
      callingAvailable &&
      controller &&
      media.phase === "idle"
    ) {
      void controller.join(callId, callKind);
    }
  }, [status, callId, callKind, callingAvailable, controller, media.phase]);

  // Remote hang-up or provider drop: close the server-side call too.
  useEffect(() => {
    if (media.phase === "ended" && callId && status === "accepted") {
      void transitionVideoCall(callId, "end")
        .then(setStatus)
        .catch(() => undefined);
    }
  }, [media.phase, callId, status]);

  useEffect(() => {
    if (
      !callId ||
      status === "ended" ||
      status === "declined" ||
      status === "cancelled" ||
      status === "timed_out"
    ) {
      return;
    }
    const interval = setInterval(() => {
      void refreshCall().catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not refresh call status.");
      });
      // Poll quickly while ringing / connecting so the caller sees "accepted" (and joins) within ~1 s instead of 5 s.
    }, status === "accepted" && media.phase === "connected" ? 4000 : 1500);
    return () => clearInterval(interval);
  }, [callId, status, refreshCall, media.phase]);

  // One-second tick for the call timer and the free-time countdown.
  useEffect(() => {
    if (status !== "accepted") return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [status]);

  // Tell the server this phone is in the call. The server starts the free-time clock only once BOTH phones
  // have reported in, so connecting time is never charged against the daily allowance.
  useEffect(() => {
    if (media.phase !== "connected" || !callId || reportedConnected.current) return;
    reportedConnected.current = true;
    setConnectedAt(Date.now());
    void markCallConnected(callId).then((result) => {
      if (result?.secondsRemaining != null) {
        setFreeSeconds(result.secondsRemaining);
        setCoveredUntil(Date.now() + result.secondsRemaining * 1000);
      }
    });
  }, [media.phase, callId]);

  // Free plan check, used to pick the right wording when time runs out.
  useEffect(() => {
    void getUserVideoCallAllowance()
      .then((allowance) => setIsFreePlan(allowance.isFree))
      .catch(() => undefined);
  }, []);

  // The media layer reports why it ended (for example the time allowance is used up).
  useEffect(() => {
    // Only the person who pays for the call (the caller) is offered Premium.
    const amRecipient = Boolean(user?.id && recipientId && user.id === recipientId);
    if (!amRecipient && media.error && isPremiumCallError(media.error.code)) {
      // Premium members already have the bigger allowance: tell them when it renews instead of selling Premium.
      if (isFreePlan === false) setError(PAID_ALLOWANCE_USED_MESSAGE);
      else setPremiumPrompt(PREMIUM_CALL_MESSAGE);
    }
  }, [media.error, user?.id, recipientId, isFreePlan]);

  // The user is free to stay on the call for the whole covered time. When it is really over, end cleanly.
  const secondsLeft = coveredUntil === null ? null : Math.max(0, Math.ceil((coveredUntil - now) / 1000));
  const timeUpHandled = useRef(false);
  useEffect(() => {
    if (secondsLeft !== 0 || status !== "accepted" || media.phase !== "connected" || timeUpHandled.current) return;
    timeUpHandled.current = true;
    void (async () => {
      await controller?.hangUp();
      if (callId) await transitionVideoCall(callId, "end").then(setStatus).catch(() => undefined);
      const amRecipient = Boolean(user?.id && recipientId && user.id === recipientId);
      if (!amRecipient) {
        // Free members are offered Premium; paid members are told when their 5 minutes renew (no upgrade pitch).
        if (isFreePlan) setPremiumPrompt(PREMIUM_CALL_MESSAGE);
        else setError(PAID_ALLOWANCE_USED_MESSAGE);
      }
    })();
  }, [secondsLeft, status, media.phase, controller, callId, isFreePlan, user?.id, recipientId]);

  const handleEnd = async () => {
    await controller?.hangUp();
    if (callId && (status === "pending" || status === "accepted")) {
      try {
        const next = await transitionVideoCall(callId, status === "pending" ? "cancel" : "end");
        setStatus(next);
      } catch (cause) {
        setError(friendlyCallError(cause, "Could not end the call."));
        return;
      }
    }
    safeBack(router);
  };

  const isRecipient = Boolean(user?.id && recipientId && user.id === recipientId);

  // Recipient actions. The server validates the recipient and the pending state atomically; the screen
  // only reflects the result. Answering is refused up front when the build cannot connect a call.
  const handleAnswer = async () => {
    if (!callId || responding) return;
    if (!callingAvailable) {
      setError("Calling is not available yet, so this call was not answered.");
      return;
    }
    if (isPhoneInAnotherCall()) {
      setError(PHONE_BUSY_ANSWER_MESSAGE);
      return;
    }
    setResponding(true);
    try {
      setStatus(await transitionVideoCall(callId, "accept"));
      setError(null);
    } catch (cause) {
      setError(friendlyCallError(cause, "Could not answer the call."));
      await refreshCall().catch(() => undefined);
    } finally {
      setResponding(false);
    }
  };

  const handleDecline = async () => {
    if (!callId || responding) return;
    setResponding(true);
    try {
      setStatus(await transitionVideoCall(callId, "decline"));
      safeBack(router);
    } catch (cause) {
      setError(friendlyCallError(cause, "Could not decline the call."));
      await refreshCall().catch(() => undefined);
    } finally {
      setResponding(false);
    }
  };

  if (!partner) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          {status === "creating" ? <ActivityIndicator color={Colors.primary} /> : null}
          <Text style={styles.title}>{error ?? "Matched connection not found."}</Text>
          <TouchableOpacity style={styles.endCallBtn} onPress={() => safeBack(router)}>
            <Text style={styles.endCallText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isTerminal = ["declined", "cancelled", "timed_out", "ended"].includes(status);
  const connected = status === "accepted" && media.phase === "connected";
  const elapsed = connectedAt ? formatCallDuration((now - connectedAt) / 1000) : "0:00";
  // Wording like a normal calling app: Calling… / Ringing / Connecting… / 0:12, never "invitation sent".
  const statusMessage =
    status === "creating"
      ? "Calling…"
      : status === "pending"
        ? isRecipient
          ? "Incoming video call"
          : "Ringing…"
        : status === "accepted"
          ? !callingAvailable
            ? "Calling isn't available in this build."
            : connected
              ? elapsed
              : media.phase === "failed"
                ? "Couldn't connect"
                : "Connecting…"
          : status === "declined"
            ? isRecipient
              ? "Call declined"
              : "Call declined"
            : status === "timed_out" || status === "cancelled"
              ? isRecipient
                ? "Missed call"
                : "No answer"
              : "Call ended";

  const showVideo = callKind === "video" && connected;
  const waitingForCamera =
    showVideo &&
    !((controller?.getSession() as CallSessionWithVideo | null)?.video?.getState().remoteVideoReady ?? false);

  const micProblem =
    connected && ((controller?.getSession() as CallSessionWithVideo | null)?.video?.getState().micProblem ?? false);

  return (
    <SafeAreaView style={styles.container}>
      {showVideo ? (
        <View style={StyleSheet.absoluteFill}>
          <CallVideoStage session={(controller?.getSession() as CallSessionWithVideo | null) ?? null} />
        </View>
      ) : null}

      <View style={styles.topBlock} pointerEvents="none">
        {showVideo ? null : (
          <ProfilePhoto
            uri={partnerPhoto}
            name={partner.name}
            style={styles.partnerPhoto}
            placeholderSize={72}
          />
        )}
        <Text style={styles.partnerName}>{partner.name}</Text>
        <Text style={styles.callType}>{statusMessage}</Text>
        {showVideo && waitingForCamera ? (
          <Text style={styles.callType}>Waiting for {partner.name}'s camera…</Text>
        ) : null}
        {micProblem ? (
          <Text style={styles.error}>
            Your microphone isn't working, so they can't hear you. Allow the microphone for Chahat in Settings and
            close other apps that use it.
          </Text>
        ) : null}
        {connected && secondsLeft !== null ? (
          <Text style={[styles.timer, secondsLeft <= 5 && { color: Colors.destructive }]}>
            {isFreePlan === false ? "Time left today" : "Free time left"}: {formatCallDuration(secondsLeft)}
          </Text>
        ) : null}
        {callingAvailable ? null : (
          <Text style={styles.providerNotice}>
            Calling isn't available in this build.
            {unavailableReason ? `\n\nDetails: ${unavailableReason}` : ""}
          </Text>
        )}
        {error && !premiumPrompt ? <Text style={styles.error}>{error}</Text> : null}
        {media.error && !isPremiumCallError(media.error.code) ? (
          <Text style={styles.error}>{media.error.message}</Text>
        ) : null}
      </View>

      <View style={styles.bottomBlock}>
        {premiumPrompt ? (
          <View style={styles.premiumCard}>
            <Text style={styles.stateTitle}>{premiumPrompt}</Text>
            {isFreePlan ? (
              <TouchableOpacity
                style={[styles.pillBtn, { backgroundColor: Colors.primary }]}
                accessibilityRole="button"
                onPress={() => router.push("/premium")}
              >
                <Text style={styles.pillBtnText}>Get Premium</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {connected && (
          <View style={styles.mediaControls}>
            <TouchableOpacity
              style={styles.mediaBtn}
              accessibilityLabel={media.microphoneEnabled ? "Mute microphone" : "Unmute microphone"}
              onPress={() => void controller?.setMicrophoneEnabled(!media.microphoneEnabled)}
            >
              {media.microphoneEnabled ? (
                <Mic size={22} color={Colors.foreground} />
              ) : (
                <MicOff size={22} color={Colors.foreground} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.mediaBtn}
              accessibilityLabel={media.cameraEnabled ? "Turn camera off" : "Turn camera on"}
              onPress={() => void controller?.setCameraEnabled(!media.cameraEnabled)}
            >
              {media.cameraEnabled ? (
                <Video size={22} color={Colors.foreground} />
              ) : (
                <VideoOff size={22} color={Colors.foreground} />
              )}
            </TouchableOpacity>
            {media.cameraEnabled ? (
              <TouchableOpacity
                style={styles.mediaBtn}
                accessibilityLabel="Switch camera"
                onPress={() => void controller?.switchCamera()}
              >
                <SwitchCamera size={22} color={Colors.foreground} />
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {status === "pending" && isRecipient && (
          <View style={styles.answerRow}>
            <View style={styles.roundWrap}>
              <TouchableOpacity
                style={[styles.roundBtn, { backgroundColor: Colors.destructive }]}
                disabled={responding}
                accessibilityRole="button"
                accessibilityLabel="Decline call"
                onPress={() => void handleDecline()}
              >
                <PhoneOff size={28} color={Colors.destructiveForeground} />
              </TouchableOpacity>
              <Text style={styles.roundLabel}>Decline</Text>
            </View>
            <View style={styles.roundWrap}>
              <TouchableOpacity
                style={[styles.roundBtn, { backgroundColor: Colors.success }]}
                disabled={responding}
                accessibilityRole="button"
                accessibilityLabel="Answer call"
                onPress={() => void handleAnswer()}
              >
                <Phone size={28} color={Colors.successForeground} />
              </TouchableOpacity>
              <Text style={styles.roundLabel}>Answer</Text>
            </View>
          </View>
        )}

        {/* Caller while ringing, and everyone while connected: a single red hang-up button, like a normal call. */}
        {!isTerminal && status !== "creating" && !(status === "pending" && isRecipient) && (
          <View style={styles.roundWrap}>
            <TouchableOpacity
              style={[styles.roundBtn, { backgroundColor: Colors.destructive }]}
              accessibilityRole="button"
              accessibilityLabel={status === "pending" ? "Cancel call" : "End call"}
              onPress={() => void handleEnd()}
            >
              <PhoneOff size={28} color={Colors.destructiveForeground} />
            </TouchableOpacity>
          </View>
        )}

        {isTerminal && (
          <TouchableOpacity style={[styles.pillBtn, { backgroundColor: Colors.destructive }]} onPress={() => safeBack(router)}>
            <Text style={styles.pillBtnText}>Close</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.ink, justifyContent: "space-between" },
    topBlock: { alignItems: "center", paddingTop: 48, paddingHorizontal: 24, gap: 10 },
    bottomBlock: { alignItems: "center", paddingBottom: 40, paddingHorizontal: 24, gap: 20 },
    center: { alignItems: "center", padding: 24, gap: 16 },
    partnerPhoto: { width: 144, height: 144, borderRadius: Radii.full, overflow: "hidden", marginBottom: 8 },
    partnerName: {
      fontSize: Typography.sizes.xl,
      fontWeight: Typography.weights.bold,
      color: Colors.inkForeground,
    },
    callType: { color: Colors.mutedForeground, fontSize: Typography.sizes.base },
    stateTitle: {
      color: Colors.foreground,
      fontSize: Typography.sizes.base,
      textAlign: "center",
      lineHeight: 22,
    },
    timer: { color: Colors.primary, fontSize: Typography.sizes.sm, textAlign: "center" },
    error: { color: Colors.destructive, textAlign: "center" },
    providerNotice: {
      color: Colors.mutedForeground,
      fontSize: Typography.sizes.xs,
      lineHeight: 18,
      textAlign: "center",
    },
    title: { color: Colors.inkForeground, textAlign: "center" },
    premiumCard: {
      width: "100%",
      alignItems: "center",
      padding: Spacing.lg,
      borderWidth: 1,
      borderColor: Colors.border,
      borderRadius: Radii.xl,
      backgroundColor: Colors.card,
      gap: Spacing.md,
    },
    mediaControls: { flexDirection: "row", gap: 16 },
    mediaBtn: {
      width: 52,
      height: 52,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: Radii.full,
      backgroundColor: Colors.card,
      borderWidth: 1,
      borderColor: Colors.border,
    },
    answerRow: { flexDirection: "row", gap: 72 },
    roundWrap: { alignItems: "center", gap: 8 },
    roundBtn: {
      width: 68,
      height: 68,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: Radii.full,
    },
    roundLabel: { color: Colors.inkForeground, fontSize: Typography.sizes.sm },
    pillBtn: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: Spacing.xl,
      borderRadius: Radii.full,
    },
    pillBtnText: {
      color: Colors.destructiveForeground,
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.semibold,
    },
    endCallBtn: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: Spacing.md,
      backgroundColor: Colors.destructive,
      paddingHorizontal: Spacing.xl,
      borderRadius: Radii.full,
    },
    endCallText: {
      color: Colors.destructiveForeground,
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.semibold,
    },
  });
