import React, { useState, useEffect, useMemo } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { useMilo } from "../../src/context/MiloContext";
import { Alert } from "../../src/utils/alert";
import { AvatarPlaceholder } from "../../src/components/ui/AvatarPlaceholder";

export default function CallScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { matches, subscription } = useMilo();

  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const partner = matches.find((m) => m.otherUser.id === id || m.id === id)?.otherUser;
  const partnerPhoto = partner?.photos && partner.photos.length > 0 ? partner.photos[0] : undefined;

  const isPaidUser = subscription?.tier && subscription.tier !== "free";
  const MAX_FREE_CALL_SECONDS = 60;

  useEffect(() => {
    if (!partner) {
      Alert.alert("Call Ended", "Matched connection not found.", [
        { text: "OK", onPress: () => router.back() },
      ]);
      return;
    }

    const timer = setInterval(() => {
      setSeconds((prev) => {
        const next = prev + 1;
        if (!isPaidUser && next >= MAX_FREE_CALL_SECONDS) {
          clearInterval(timer);
          Alert.alert(
            "Free Call Limit Reached",
            "Your 60-second free video call allowance has concluded. Upgrade to CHAHAT Premium for unlimited calling.",
            [{ text: "OK", onPress: () => router.back() }],
          );
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isPaidUser, partner]);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  if (!partner) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <Text style={{ color: Colors.inkForeground }}>Connecting...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.partnerName}>{partner.name}</Text>
        <Text style={styles.timer}>{formatTimer(seconds)}</Text>
        {!isPaidUser && (
          <View style={styles.freeAllowanceBadge}>
            <Text style={styles.freeAllowanceText}>
              Free allowance: {Math.max(0, MAX_FREE_CALL_SECONDS - seconds)}s remaining
            </Text>
          </View>
        )}
      </View>

      <View style={styles.videoArea}>
        {partnerPhoto ? (
          <Image source={{ uri: partnerPhoto }} style={styles.partnerPhoto} contentFit="cover" />
        ) : (
          <View style={[styles.partnerPhoto, { backgroundColor: "#1e1e24", alignItems: "center", justifyContent: "center" }]}>
            <AvatarPlaceholder name={partner.name} size={120} />
          </View>
        )}
        {videoOff && (
          <View style={styles.videoDisabledOverlay}>
            <Text style={styles.disabledText}>Camera turned off</Text>
          </View>
        )}
      </View>

      <View style={styles.controlsBar}>
        <TouchableOpacity
          style={[styles.controlBtn, muted && styles.btnActive]}
          onPress={() => setMuted(!muted)}
        >
          {muted ? (
            <MicOff size={24} color={Colors.primaryForeground} />
          ) : (
            <Mic size={24} color={Colors.foreground} />
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.endCallBtn} onPress={() => router.back()}>
          <PhoneOff size={28} color={Colors.destructiveForeground} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, videoOff && styles.btnActive]}
          onPress={() => setVideoOff(!videoOff)}
        >
          {videoOff ? (
            <VideoOff size={24} color={Colors.primaryForeground} />
          ) : (
            <VideoIcon size={24} color={Colors.foreground} />
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.ink,
    justifyContent: "space-between",
  },
  topBar: {
    alignItems: "center",
    paddingTop: 16,
  },
  partnerName: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.inkForeground,
  },
  timer: {
    fontSize: Typography.sizes.sm,
    color: "rgba(255, 255, 255, 0.7)",
    marginTop: 4,
  },
  videoArea: {
    flex: 1,
    margin: 20,
    borderRadius: Radii.xxl,
    overflow: "hidden",
    position: "relative",
  },
  partnerPhoto: {
    width: "100%",
    height: "100%",
  },
  videoDisabledOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  disabledText: {
    color: Colors.inkForeground,
    fontSize: Typography.sizes.base,
  },
  controlsBar: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 24,
    paddingBottom: 40,
  },
  controlBtn: {
    width: 56,
    height: 56,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  btnActive: {
    backgroundColor: Colors.destructive,
  },
  endCallBtn: {
    width: 68,
    height: 68,
    borderRadius: Radii.full,
    backgroundColor: Colors.destructive,
    alignItems: "center",
    justifyContent: "center",
  },
  freeAllowanceBadge: {
    marginTop: 8,
    backgroundColor: "rgba(200, 70, 48, 0.85)",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: Radii.full,
  },
  freeAllowanceText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: Typography.weights.semibold,
  },
});
