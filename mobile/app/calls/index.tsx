import React, { useMemo, useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Video, Info, MessageCircle, ShieldCheck, Clock } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Header } from "../../src/components/ui/Header";
import { useMilo } from "../../src/context/MiloContext";
import { useAuth } from "../../src/context/AuthContext";
import { Alert } from "../../src/utils/alert";
import {
  buildExistingCallRoute,
  buildNewCallRoute,
  getMyVideoCalls,
  transitionVideoCall,
  type VideoCall,
} from "../../src/services/calls";
import { isCallingAvailable } from "../../src/services/callMedia";

export default function CallsScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { matches } = useMilo();
  const { user } = useAuth();
  const [calls, setCalls] = useState<VideoCall[]>([]);
  const callingAvailable = isCallingAvailable();

  const refreshCalls = async () => {
    try {
      setCalls(await getMyVideoCalls());
    } catch (error) {
      Alert.alert("Calls unavailable", error instanceof Error ? error.message : "Please try again.");
    }
  };

  useEffect(() => {
    void refreshCalls();
  }, []);

  const handleCallAction = async (call: VideoCall, action: "accept" | "decline" | "cancel") => {
    try {
      const status = await transitionVideoCall(call.id, action);
      await refreshCalls();
      if (action === "accept" && status === "accepted") {
        router.push(buildExistingCallRoute(call));
      }
    } catch (error) {
      Alert.alert("Call update failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const incomingCalls = calls.filter(
    (call) => call.status === "pending" && call.recipient_id === user?.id,
  );
  const outgoingCalls = calls.filter(
    (call) => call.status === "pending" && call.caller_id === user?.id,
  );

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Calls & Billing" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Banner with Info */}
        <View style={styles.infoBox}>
          <View style={styles.infoIconWrap}>
            <Info size={20} color={Colors.primary} />
          </View>
          <Text style={styles.infoText}>
            Video calling requires mutual consent between matched members. The first minute of every
            call is always free.
          </Text>
        </View>

        {/* Feature Overview Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Calling Features</Text>

          <View style={styles.featureRow}>
            <View style={styles.iconCircle}>
              <Video size={18} color={Colors.primary} />
            </View>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Face-to-Face Video Calls</Text>
              <Text style={styles.featureDesc}>High-definition video with camera flip, privacy toggle, and live timer.</Text>
            </View>
          </View>

          <View style={styles.featureRow}>
            <View style={styles.iconCircle}>
              <ShieldCheck size={18} color={Colors.accent} />
            </View>
            <View style={styles.featureContent}>
              <Text style={styles.featureTitle}>Mutual Consent Protected</Text>
              <Text style={styles.featureDesc}>Calls can only be initiated with members you have actively matched with.</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.callRequestHeader}>
            <Text style={styles.cardTitle}>Call requests</Text>
            <TouchableOpacity onPress={() => void refreshCalls()} activeOpacity={0.7}>
              <Text style={styles.refreshText}>Refresh</Text>
            </TouchableOpacity>
          </View>
          {incomingCalls.map((call) => (
            <View key={call.id} style={styles.matchRow}>
              <View style={styles.matchInfo}>
                <Text style={styles.matchName}>Incoming video call request</Text>
                <Text style={styles.matchCity}>Invitation expires soon</Text>
              </View>
              <View style={styles.callActions}>
                <TouchableOpacity style={styles.requestButton} onPress={() => void handleCallAction(call, "decline")}>
                  <Text style={styles.requestButtonText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.requestButton, styles.acceptButton]}
                  onPress={() => void handleCallAction(call, "accept")}
                >
                  <Text style={[styles.requestButtonText, styles.acceptText]}>Accept</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          {outgoingCalls.map((call) => (
            <View key={call.id} style={styles.matchRow}>
              <View style={styles.matchInfo}>
                <Text style={styles.matchName}>Waiting for response</Text>
                <Text style={styles.matchCity}>Video call request sent</Text>
              </View>
              <TouchableOpacity style={styles.requestButton} onPress={() => void handleCallAction(call, "cancel")}>
                <Text style={styles.requestButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ))}
          {incomingCalls.length === 0 && outgoingCalls.length === 0 && (
            <Text style={styles.emptyText}>No pending requests.</Text>
          )}
          <Text style={styles.providerNotice}>
            A call request is not a live video call. Video provider setup is still required.
          </Text>
        </View>

        {/* Call Logs & Matched Contacts */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quick Call With Matches</Text>
          {!callingAvailable ? (
            <View style={styles.emptyWrap}>
              <Info size={32} color={Colors.mutedForeground} />
              <Text style={styles.emptyText}>
                Video calling is not available yet. We will tell you when it is ready.
              </Text>
            </View>
          ) : matches.length > 0 ? (
            <View style={styles.matchList}>
              {matches.map((m) => (
                <View key={m.id} style={styles.matchRow}>
                  <View style={styles.matchInfo}>
                    <Text style={styles.matchName}>{m.otherUser.name}</Text>
                    <Text style={styles.matchCity}>{m.otherUser.city}</Text>
                  </View>
                  <View style={styles.callActions}>
                    <TouchableOpacity
                      style={[styles.callBtn, styles.callBtnPrimary]}
                      onPress={() => router.push(buildNewCallRoute(m.id, "video"))}
                      activeOpacity={0.7}
                    >
                      <Video size={16} color={Colors.primaryForeground} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyWrap}>
              <MessageCircle size={32} color={Colors.mutedForeground} />
              <Text style={styles.emptyText}>
                No active matches yet. Once you match with someone, you can start video calls directly with them.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
  },
  infoBox: {
    flexDirection: "row",
    backgroundColor: Colors.secondary,
    padding: 16,
    borderRadius: Radii.lg,
    gap: 12,
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoIconWrap: {
    marginTop: 2,
  },
  infoText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.secondaryForeground,
    lineHeight: 20,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  featureContent: {
    flex: 1,
  },
  featureTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  featureDesc: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: 2,
    lineHeight: 16,
  },
  matchList: {
    gap: 12,
  },
  callRequestHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  refreshText: {
    color: Colors.primary,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
  },
  requestButton: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radii.full,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  requestButtonText: {
    color: Colors.foreground,
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
  },
  acceptButton: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  acceptText: {
    color: Colors.primaryForeground,
  },
  providerNotice: {
    marginTop: 10,
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    lineHeight: 16,
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  matchInfo: {
    flex: 1,
  },
  matchName: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  matchCity: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
  callActions: {
    flexDirection: "row",
    gap: 8,
  },
  callBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  callBtnPrimary: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  emptyWrap: {
    alignItems: "center",
    paddingVertical: 16,
    gap: 8,
  },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    lineHeight: 20,
    textAlign: "center",
  },
});
