import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Alert } from "../../src/utils/alert";
import { Radii, Typography, ThemeColors, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Header } from "../../src/components/ui/Header";
import { SUPPORT_CONTACT, supportMailtoUrl } from "../../src/constants/supportContact";

export default function SupportScreen() {
  const router = useRouter();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);

  const emailSupport = async () => {
    try {
      await Linking.openURL(supportMailtoUrl());
    } catch {
      Alert.alert("No email app found", `Write to us at ${SUPPORT_CONTACT.email}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Help & Support" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.paragraph}>
          Questions, problems with your account, or something to report? Email us and include the email address you
          signed up with. Never send your password.
        </Text>

        <Text style={styles.subheading}>Email</Text>
        <TouchableOpacity style={styles.card} onPress={emailSupport} activeOpacity={0.7} accessibilityRole="link">
          <Text style={styles.link}>{SUPPORT_CONTACT.email}</Text>
          <Text style={styles.hint}>Tap to write to us</Text>
        </TouchableOpacity>

        <Text style={styles.subheading}>Postal address</Text>
        <View style={styles.card}>
          {SUPPORT_CONTACT.addressLines.map((line) => (
            <Text key={line} style={styles.addressLine}>
              {line}
            </Text>
          ))}
        </View>

        <Text style={styles.subheading}>More help</Text>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push("/safety")} activeOpacity={0.7}>
          <Text style={styles.rowLabel}>Safety Centre & Guidelines</Text>
          <ChevronRight size={18} color={Colors.mutedForeground} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.navRow} onPress={() => router.push("/legal")} activeOpacity={0.7}>
          <Text style={styles.rowLabel}>Legal & Privacy</Text>
          <ChevronRight size={18} color={Colors.mutedForeground} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 24 },
    subheading: {
      fontSize: Typography.sizes.base,
      fontWeight: Typography.weights.bold,
      color: Colors.foreground,
      marginTop: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    paragraph: { fontSize: Typography.sizes.sm, color: Colors.mutedForeground, lineHeight: 22 },
    card: {
      backgroundColor: Colors.card,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: Colors.border,
      padding: Spacing.lg,
    },
    link: { fontSize: Typography.sizes.base, color: Colors.primary, fontWeight: Typography.weights.bold },
    hint: { fontSize: Typography.sizes.xs, color: Colors.mutedForeground, marginTop: 4 },
    addressLine: { fontSize: Typography.sizes.sm, color: Colors.foreground, lineHeight: 22 },
    navRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      backgroundColor: Colors.card,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: Colors.border,
      padding: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    rowLabel: { fontSize: Typography.sizes.sm, color: Colors.foreground },
  });
