import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors, Typography } from "../../src/constants/theme";
import { Header } from "../../src/components/ui/Header";

export default function TermsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Header title="Terms of Service" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Milo Terms of Service (India)</Text>
        <Text style={styles.paragraph}>
          Welcome to Milo. By creating an account or accessing the Milo application, you agree to
          these Terms of Service.
        </Text>

        <Text style={styles.subheading}>1. Eligibility & Age Restriction</Text>
        <Text style={styles.paragraph}>
          You must be at least 18 years of age to create an account and use Milo. Misrepresentation
          of your age or date of birth constitutes a violation of these terms and will result in
          immediate termination of your account.
        </Text>

        <Text style={styles.subheading}>2. Community Standards</Text>
        <Text style={styles.paragraph}>
          Milo is dedicated to genuine human connections. You agree not to post abusive, obscene, or
          fraudulent content, solicit commercial transactions, or impersonate other persons.
        </Text>

        <Text style={styles.subheading}>3. Safety & Reporting</Text>
        <Text style={styles.paragraph}>
          Users may report any profiles or behavior that violate these terms. Reports are audited by
          the Milo moderation team.
        </Text>
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
    padding: 24,
  },
  heading: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
    marginBottom: 16,
  },
  subheading: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginTop: 16,
    marginBottom: 6,
  },
  paragraph: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    lineHeight: 22,
  },
});
