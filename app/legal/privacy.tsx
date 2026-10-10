import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors, Typography } from "../../src/constants/theme";
import { Header } from "../../src/components/ui/Header";

export default function PrivacyScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Header title="Privacy Policy" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Milo Privacy Policy</Text>
        <Text style={styles.paragraph}>
          Your privacy is foundational to our product. This policy explains what information Milo
          collects, how we use it, and how your data is protected under Indian data protection
          principles (DPDP Act).
        </Text>

        <Text style={styles.subheading}>1. Data We Collect</Text>
        <Text style={styles.paragraph}>
          • Account info: Email address and authentication credentials.{"\n"}• Profile info: Name,
          date of birth (used strictly to calculate age, never displayed publicly), gender,
          relationship intents, city, work, education, and photos.{"\n"}• Discovery location:
          City-level location only. Milo never reveals your precise coordinates or physical address
          to other users.
        </Text>

        <Text style={styles.subheading}>2. Private Photographs & Moderation</Text>
        <Text style={styles.paragraph}>
          Uploaded profile photographs are stored in secure cloud object storage. In accordance with
          platform security standards, photos undergo approval review to protect members from
          inappropriate or fraudulent content.
        </Text>

        <Text style={styles.subheading}>3. Account & Data Deletion</Text>
        <Text style={styles.paragraph}>
          You have the right to delete your account at any time via Settings. Deleting your account
          immediately purges your profile, photos, matches, and chat history from active databases.
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
