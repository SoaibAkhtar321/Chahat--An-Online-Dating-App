import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { ProfilePhoto } from "../../src/components/profile/ProfilePhoto";
import { useMilo } from "../../src/context/MiloContext";
import { useCallController } from "../../src/hooks/useCallController";
import { isCallingAvailable } from "../../src/services/callMedia";
import {
  createVideoCall,
  getMyVideoCalls,
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
  const [callId, setCallId] = useState(routeCallId);
  const [status, setStatus] = useState<CallStatus | "creating">(
    routeCallId ? "pending" : "creating",
  );
  const [freeSeconds, setFreeSeconds] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callKind, setCallKind] = useState<CallType | null>(
    type === "audio" || type === "video" ? type : null,
  );
  const callingAvailable = isCallingAvailable();
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
    setFreeSeconds(call.free_seconds_remaining);
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
          setFreeSeconds(call.free_seconds_remaining);
        })
        .catch((cause) => {
          if (!cancelled)
            setError(cause instanceof Error ? cause.message : "Could not load the call.");
        });
      return () => {
        cancelled = true;
      };
    }

    if (!id || (type !== "audio" && type !== "video")) {
      setError("A valid match and call type are required.");
      setStatus("ended");
      return;
    }
    if (!callingAvailable) {
      // Never create an invitation for a call that cannot connect.
      setError("Calling is not available yet.");
      setStatus("ended");
      return;
    }
    void createVideoCall(id, type)
      .then((created) => {
        if (cancelled) return;
        setCallId(created.callId);
        setStatus("pending");
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not create the call request.");
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
    }, 5000);
    return () => clearInterval(interval);
  }, [callId, status, refreshCall]);

  const handleEnd = async () => {
    await controller?.hangUp();
    if (callId && (status === "pending" || status === "accepted")) {
      try {
        const next = await transitionVideoCall(callId, status === "pending" ? "cancel" : "end");
        setStatus(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not end the call.");
        return;
      }
    }
    router.back();
  };

  if (!partner) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          {status === "creating" ? <ActivityIndicator color={Colors.primary} /> : null}
          <Text style={styles.title}>{error ?? "Matched connection not found."}</Text>
          <TouchableOpacity style={styles.endCallBtn} onPress={() => router.back()}>
            <Text style={styles.endCallText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const isTerminal = ["declined", "cancelled", "timed_out", "ended"].includes(status);
  const statusMessage =
    status === "creating"
      ? "Creating a secure call invitation…"
      : status === "pending"
        ? "Invitation sent. Waiting for the other person to accept."
        : status === "accepted"
          ? !callingAvailable
            ? "Invitation accepted. A live audio/video provider is not configured in this build."
            : media.phase === "connected"
              ? "Connected."
              : media.phase === "failed"
                ? "Could not connect."
                : "Connecting…"
          : `Call ${status}.`;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <ProfilePhoto
          uri={partnerPhoto}
          name={partner.name}
          style={styles.partnerPhoto}
          placeholderSize={72}
        />
        <Text style={styles.partnerName}>{partner.name}</Text>
        <Text style={styles.callType}>{callKind === "audio" ? "Audio call" : "Video call"}</Text>
        <View style={styles.callState}>
          <Text style={styles.stateTitle}>{statusMessage}</Text>
          {freeSeconds !== null && status === "accepted" && (
            <Text style={styles.timer}>
              Call time covered by the server: {freeSeconds}s
            </Text>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {media.error ? <Text style={styles.error}>{media.error.message}</Text> : null}
          {callingAvailable ? null : (
            <Text style={styles.providerNotice}>
              No media session has started. A call provider must be configured and a development
              client built before live calls can connect.
            </Text>
          )}
        </View>
        {media.phase === "connected" && (
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
            {callKind === "video" && (
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
            )}
          </View>
        )}
        {!isTerminal && status !== "creating" && (
          <TouchableOpacity style={styles.endCallBtn} onPress={() => void handleEnd()}>
            <PhoneOff size={22} color={Colors.destructiveForeground} />
            <Text style={styles.endCallText}>
              {status === "pending" ? "Cancel request" : "End call"}
            </Text>
          </TouchableOpacity>
        )}
        {isTerminal && (
          <TouchableOpacity style={styles.endCallBtn} onPress={() => router.back()}>
            <Text style={styles.endCallText}>Close</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.ink, justifyContent: "center" },
    content: { alignItems: "center", padding: 24, gap: 16 },
    center: { alignItems: "center", padding: 24, gap: 16 },
    partnerPhoto: { width: 144, height: 144, borderRadius: Radii.full, overflow: "hidden" },
    partnerName: {
      fontSize: Typography.sizes.xl,
      fontWeight: Typography.weights.bold,
      color: Colors.inkForeground,
    },
    callType: { color: Colors.mutedForeground, fontSize: Typography.sizes.sm },
    callState: {
      width: "100%",
      alignItems: "center",
      padding: 20,
      borderWidth: 1,
      borderColor: Colors.border,
      borderRadius: Radii.xl,
      backgroundColor: Colors.card,
      gap: 10,
    },
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
    endCallBtn: {
      minHeight: 52,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      backgroundColor: Colors.destructive,
      paddingHorizontal: 24,
      borderRadius: Radii.full,
    },
    endCallText: {
      color: Colors.destructiveForeground,
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.semibold,
    },
  });
