import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PhoneCall, Video, Info } from "lucide-react-native";
import { Colors, Radii, Typography } from "../../src/constants/theme";
import { Header } from "../../src/components/ui/Header";

export default function CallsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Header title="Calls & Billing" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.infoBox}>
          <Info size={20} color={Colors.primary} />
          <Text style={styles.infoText}>
            Milo video and voice calls require mutual consent between matched members. First minute
            is free on demo calls.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent Calls</Text>
          <Text style={styles.emptyText}>
            No recent calls. You can start audio or video calls directly from inside an active chat.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 20,
  },
  infoBox: {
    flexDirection: "row",
    backgroundColor: Colors.secondary,
    padding: 16,
    borderRadius: Radii.lg,
    gap: 12,
    marginBottom: 20,
    alignItems: "center",
  },
  infoText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.secondaryForeground,
    lineHeight: 18,
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
    marginBottom: 8,
  },
  emptyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    lineHeight: 20,
  },
});
