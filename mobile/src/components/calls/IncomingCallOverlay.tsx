import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Phone, PhoneOff } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { useMilo } from "../../context/MiloContext";
import { useIncomingCallController, useIncomingCallView } from "../../context/IncomingCallContext";
import { ProfilePhoto } from "../profile/ProfilePhoto";

/**
 * In-app incoming-call screen, shown while the app is open and a call is ringing for this account.
 * (When the app is closed the Android notification with Answer/Decline does this job.)
 */
export function IncomingCallOverlay() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const controller = useIncomingCallController();
  const { ringing } = useIncomingCallView();
  const { matches } = useMilo();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(false);
  }, [ringing?.callId]);

  if (!controller || !ringing) return null;
  const partner = matches.find((match) => match.id === ringing.matchId)?.otherUser;
  const run = async (action: "answer" | "decline") => {
    if (busy) return;
    setBusy(true);
    try {
      if (action === "answer") await controller.answer(ringing.callId, ringing);
      else await controller.decline(ringing.callId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root} accessibilityViewIsModal accessibilityLiveRegion="assertive">
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <ProfilePhoto
            uri={partner?.photos?.[0]}
            name={partner?.name ?? "Someone"}
            style={styles.photo}
            placeholderSize={72}
          />
          <Text style={styles.name}>{partner?.name ?? "Someone"}</Text>
          <Text style={styles.type}>Incoming video call</Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.decline, busy && styles.disabled]}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Decline call"
            onPress={() => void run("decline")}
          >
            <PhoneOff size={26} color={colors.destructiveForeground} />
            <Text style={styles.buttonText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.answer, busy && styles.disabled]}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Answer call"
            onPress={() => void run("answer")}
          >
            <Phone size={26} color={colors.successForeground} />
            <Text style={styles.buttonText}>Answer</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    root: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 1000, backgroundColor: Colors.ink },
    safe: { flex: 1, justifyContent: "space-between", padding: 24 },
    content: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
    photo: { width: 160, height: 160, borderRadius: Radii.full, overflow: "hidden" },
    name: { fontSize: Typography.sizes.xl, fontWeight: Typography.weights.bold, color: Colors.inkForeground },
    type: { fontSize: Typography.sizes.base, color: Colors.mutedForeground },
    actions: { flexDirection: "row", justifyContent: "space-around", paddingBottom: 24 },
    button: {
      minWidth: 132,
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      borderRadius: Radii.full,
      paddingHorizontal: 24,
    },
    decline: { backgroundColor: Colors.destructive },
    answer: { backgroundColor: Colors.success },
    disabled: { opacity: 0.6 },
    buttonText: { color: Colors.destructiveForeground, fontSize: Typography.sizes.base, fontWeight: Typography.weights.semibold },
  });
