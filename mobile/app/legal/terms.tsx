import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Typography, ThemeColors, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Header } from "../../src/components/ui/Header";

export default function TermsScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  return (
    <SafeAreaView style={styles.container}>
      <Header title="Terms of Service" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Chahat Terms of Service (India)</Text>
        <Text style={styles.paragraph}>
          Welcome to Chahat — Online Friendship App. By creating an account or accessing the Chahat application, you agree to
          these Terms of Service.
        </Text>

        <Text style={styles.subheading}>1. Eligibility & Age Restriction</Text>
        <Text style={styles.paragraph}>
          You must be at least 18 years of age to create an account and use Chahat. Misrepresentation
          of your age or date of birth constitutes a violation of these terms and will result in
          immediate termination of your account.
        </Text>

        <Text style={styles.subheading}>2. Community Standards</Text>
        <Text style={styles.paragraph}>
          Chahat is dedicated to genuine human connections. You agree not to post abusive, obscene, or
          fraudulent content, solicit commercial transactions, or impersonate other persons.
        </Text>

        <Text style={styles.subheading}>3. Safety & Reporting</Text>
        <Text style={styles.paragraph}>
          Users may report any profiles or behavior that violate these terms. Reports are audited by
          the Chahat moderation team.
        </Text>
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
    padding: Spacing.xl,
  },
  heading: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
    marginBottom: Spacing.lg,
  },
  subheading: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  paragraph: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    lineHeight: 22,
  },
});
