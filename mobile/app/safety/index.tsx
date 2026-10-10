import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ShieldCheck, PhoneCall, AlertTriangle, EyeOff } from "lucide-react-native";
import { Colors, Radii, Typography } from "../../src/constants/theme";
import { Header } from "../../src/components/ui/Header";

export default function SafetyScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Header title="Safety Centre" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroBox}>
          <ShieldCheck size={36} color={Colors.primary} />
          <Text style={styles.heroTitle}>Your safety comes first</Text>
          <Text style={styles.heroSubtitle}>
            Milo is built around authentic profiles, respectful communication, and zero tolerance
            for harassment.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Dating Safely Guidelines</Text>

          <View style={styles.tipItem}>
            <EyeOff size={20} color={Colors.primary} />
            <View style={styles.tipContent}>
              <Text style={styles.tipHeader}>Keep personal details private</Text>
              <Text style={styles.tipBody}>
                Never share your home address, workplace, or financial information with matches.
              </Text>
            </View>
          </View>

          <View style={styles.tipItem}>
            <AlertTriangle size={20} color={Colors.primary} />
            <View style={styles.tipContent}>
              <Text style={styles.tipHeader}>Beware of financial requests</Text>
              <Text style={styles.tipBody}>
                Never send money or crypto to anyone you meet online. Report any user asking for
                financial assistance immediately.
              </Text>
            </View>
          </View>

          <View style={styles.tipItem}>
            <PhoneCall size={20} color={Colors.primary} />
            <View style={styles.tipContent}>
              <Text style={styles.tipHeader}>Meet in public spaces</Text>
              <Text style={styles.tipBody}>
                For first dates, pick busy public places like cafes. Inform a friend or family
                member of your plans.
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Emergency Helpline (India)</Text>
          <Text style={styles.emergencyItem}>• National Emergency Number: 112</Text>
          <Text style={styles.emergencyItem}>• Women Helpline: 1091</Text>
          <Text style={styles.emergencyItem}>• Cyber Crime Helpline: 1930</Text>
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
    paddingBottom: 40,
  },
  heroBox: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 24,
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
    marginTop: 12,
  },
  heroSubtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 20,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: 16,
  },
  tipItem: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  tipContent: {
    flex: 1,
  },
  tipHeader: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  tipBody: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: 2,
    lineHeight: 18,
  },
  emergencyItem: {
    fontSize: Typography.sizes.sm,
    color: Colors.foreground,
    marginVertical: 4,
    fontWeight: Typography.weights.medium,
  },
});
