import React, { useMemo } from "react";
import { VERIFICATION_ENABLED } from "../../src/constants/features";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ShieldCheck,
  PhoneCall,
  AlertTriangle,
  EyeOff,
  UserX,
  BadgeCheck,
  Flag,
  Search,
  Lock,
} from "lucide-react-native";
import { Radii, Typography, ThemeColors, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Header } from "../../src/components/ui/Header";

export default function SafetyScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Safety Centre & Trust" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero Banner */}
        <View style={styles.heroBox}>
          <ShieldCheck size={38} color={Colors.primary} />
          <Text style={styles.heroTitle}>Your Safety & Trust Come First</Text>
          <Text style={styles.heroSubtitle}>
            CHAHAT maintains zero tolerance for harassment, scams, fake profiles, and impersonation.
            All basic safety features are free for everyone.
          </Text>
        </View>

        {/* Free Safety Guarantee Card */}
        <View style={styles.freeSafetyCard}>
          <View style={styles.guaranteeRow}>
            <Lock size={18} color={Colors.primary} />
            <Text style={styles.guaranteeTitle}>Safety is Never Behind a Paywall</Text>
          </View>
          <Text style={styles.guaranteeText}>
            {VERIFICATION_ENABLED ? "Profile Verification, " : ""}Block, Report, Privacy Controls, and Safety Centre access are
            100% free for all users on Chahat.
          </Text>
        </View>

        {/* Fake Profile & Scam Detection */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Search size={20} color={Colors.accent} />
            <Text style={styles.cardTitle}>How to Spot Fake Profiles & Scams</Text>
          </View>

          <View style={styles.tipItem}>
            <AlertTriangle size={18} color={Colors.destructive} />
            <View style={styles.tipContent}>
              <Text style={styles.tipHeader}>Financial Requests / Money Scams</Text>
              <Text style={styles.tipBody}>
                Never send UPI, Google Pay, bank transfers, or crypto to someone you met on an app,
                no matter what emergency they claim.
              </Text>
            </View>
          </View>

          <View style={styles.tipItem}>
            <EyeOff size={18} color={Colors.primary} />
            <View style={styles.tipContent}>
              <Text style={styles.tipHeader}>Unverified Photos & Stolen Pictures</Text>
              <Text style={styles.tipBody}>
                {VERIFICATION_ENABLED ? "Look for the blue Verified badge. " : ""}If someone refuses a 15-second voice
                intro or a quick video call, proceed with caution.
              </Text>
            </View>
          </View>

          <View style={styles.tipItem}>
            <UserX size={18} color={Colors.primary} />
            <View style={styles.tipContent}>
              <Text style={styles.tipHeader}>Rushing Off-Platform Immediately</Text>
              <Text style={styles.tipBody}>
                Scammers often pressure you to switch to WhatsApp or Telegram immediately. Chat here
                first until you feel secure.
              </Text>
            </View>
          </View>
        </View>

        {/* Safe Dating Guidelines */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Golden Rules for Meeting In-Person</Text>

          <View style={styles.tipItem}>
            <EyeOff size={18} color={Colors.primary} />
            <View style={styles.tipContent}>
              <Text style={styles.tipHeader}>Keep exact location private</Text>
              <Text style={styles.tipBody}>
                Use the "Hide exact distance" setting in Settings & Privacy so only city-level
                location is shown.
              </Text>
            </View>
          </View>

          <View style={styles.tipItem}>
            <PhoneCall size={18} color={Colors.primary} />
            <View style={styles.tipContent}>
              <Text style={styles.tipHeader}>Meet in public spaces only</Text>
              <Text style={styles.tipBody}>
                For a first date, always choose busy cafes, public malls, or restaurants. Inform a
                trusted friend or family member of your plan.
              </Text>
            </View>
          </View>
        </View>

        {/* Verification Link */}
        {VERIFICATION_ENABLED ? (
        <TouchableOpacity
          style={styles.verifyCtaCard}
          onPress={() => router.push("/verification")}
          activeOpacity={0.8}
        >
          <BadgeCheck size={28} color={Colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.verifyCtaTitle}>Get Your Free Verified Badge</Text>
            <Text style={styles.verifyCtaDesc}>
              A quick pose selfie verifies you are real and boosts trust with matches.
            </Text>
          </View>
        </TouchableOpacity>
        ) : null}

        {/* Helplines India */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Emergency Helplines (India)</Text>
          <View style={styles.helplineRow}>
            <Text style={styles.helplineLabel}>• National Emergency Services:</Text>
            <Text style={styles.helplineNumber}>112</Text>
          </View>
          <View style={styles.helplineRow}>
            <Text style={styles.helplineLabel}>• Women Safety Helpline:</Text>
            <Text style={styles.helplineNumber}>1091</Text>
          </View>
          <View style={styles.helplineRow}>
            <Text style={styles.helplineLabel}>• Cyber Crime Reporting Helpline:</Text>
            <Text style={styles.helplineNumber}>1930</Text>
          </View>
          <Text style={styles.helplineDisclaimer}>
            Available 24/7 toll-free across all Indian states and union territories.
          </Text>
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
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.lg,
  },
  heroBox: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xxl,
    padding: Spacing.xl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
    marginTop: Spacing.md,
    textAlign: "center",
  },
  heroSubtitle: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    textAlign: "center",
    marginTop: Spacing.sm,
    lineHeight: 18,
  },
  freeSafetyCard: {
    backgroundColor: Colors.secondary,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  guaranteeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  guaranteeTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  guaranteeText: {
    fontSize: Typography.sizes.xs,
    color: Colors.foreground,
    lineHeight: 18,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.md,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  cardTitle: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  tipItem: {
    flexDirection: "row",
    gap: Spacing.md,
    marginTop: Spacing.xs,
  },
  tipContent: {
    flex: 1,
  },
  tipHeader: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  tipBody: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: Spacing.xs,
    lineHeight: 18,
  },
  verifyCtaCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    gap: Spacing.lg,
  },
  verifyCtaTitle: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  verifyCtaDesc: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: Spacing.xs,
  },
  helplineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.xs,
  },
  helplineLabel: {
    fontSize: Typography.sizes.xs,
    color: Colors.foreground,
    fontWeight: Typography.weights.medium,
  },
  helplineNumber: {
    fontSize: Typography.sizes.sm,
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
  helplineDisclaimer: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: Spacing.sm,
    fontStyle: "italic",
  },
});
