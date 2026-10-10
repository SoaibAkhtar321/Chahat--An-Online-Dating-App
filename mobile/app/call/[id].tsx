import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff } from "lucide-react-native";
import { Colors, Radii, Typography } from "../../src/constants/theme";
import { DEMO_PROFILES } from "../../src/services/discovery";
import { useMilo } from "../../src/context/MiloContext";

export default function CallScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { matches } = useMilo();

  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const [seconds, setSeconds] = useState(0);

  const partner =
    matches.find((m) => m.otherUser.id === id || m.id === id)?.otherUser || DEMO_PROFILES[0]!;

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.partnerName}>{partner.name}</Text>
        <Text style={styles.timer}>{formatTimer(seconds)}</Text>
      </View>

      <View style={styles.videoArea}>
        <Image source={{ uri: partner.photos[0] }} style={styles.partnerPhoto} contentFit="cover" />
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

const styles = StyleSheet.create({
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
});
