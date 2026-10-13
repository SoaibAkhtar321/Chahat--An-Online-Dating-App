import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MailCheck } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Button } from "../../src/components/ui/Button";
import { Input } from "../../src/components/ui/Input";
import { resendConfirmation } from "../../src/services/auth";

export default function VerifyScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [resent, setResent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleResend = async () => {
    if (!email.trim()) return;
    setLoading(true);
    const res = await resendConfirmation(email);
    setLoading(false);
    if (res.success) {
      setResent(true);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <MailCheck size={40} color={Colors.primary} />
        </View>

        <Text style={styles.title}>Check your inbox</Text>
        <Text style={styles.subtitle}>
          We sent a verification link to your email address. Please click the link to activate your
          Chahat account.
        </Text>

        {resent ? (
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>A new confirmation link has been sent.</Text>
          </View>
        ) : (
          <View style={styles.resendSection}>
            <Input
              label="Didn't get the email? Enter your email to resend:"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />
            <Button
              title={loading ? "Sending…" : "Resend confirmation email"}
              variant="ghost"
              onPress={handleResend}
              loading={loading}
            />
          </View>
        )}

        <Button
          title="Back to log in"
          onPress={() => router.replace("/(auth)/login")}
          style={styles.backButton}
        />
      </View>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    padding: 24,
    justifyContent: "center",
  },
  content: {
    alignItems: "center",
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: Radii.full,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    fontFamily: Typography.fontDisplay,
    textAlign: "center",
  },
  subtitle: {
    fontSize: Typography.sizes.base,
    color: Colors.mutedForeground,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
    marginBottom: 24,
  },
  noticeBox: {
    backgroundColor: Colors.highlight,
    padding: 14,
    borderRadius: Radii.md,
    marginBottom: 24,
    width: "100%",
  },
  noticeText: {
    color: Colors.highlightForeground,
    textAlign: "center",
    fontWeight: Typography.weights.medium,
  },
  resendSection: {
    width: "100%",
    marginBottom: 24,
  },
  backButton: {
    width: "100%",
  },
});
