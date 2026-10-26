import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, KeyboardAvoidingView, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useLocalSearchParams } from "expo-router";
import { Layout, Radii, Spacing, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Header } from "../../src/components/ui/Header";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { Alert } from "../../src/utils/alert";
import { resetPassword, updateRecoveryPassword } from "../../src/services/auth";
import { validatePassword } from "../../src/utils/validation";

export default function ResetPasswordScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isRecoveryFlow = mode === "update";
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [confirmError, setConfirmError] = useState("");

  const handleSend = async () => {
    setError("");
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    setLoading(true);
    const res = await resetPassword(email);
    setLoading(false);

    if (res.success) {
      setSent(true);
    } else {
      setError(res.error || "Failed to send reset link");
    }
  };

  const handleUpdatePassword = async () => {
    setError("");
    setConfirmError("");
    const validation = validatePassword(newPassword);
    if (!validation.valid) {
      setError(validation.error || "Use a valid password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setConfirmError("Passwords do not match.");
      return;
    }
    setLoading(true);
    const result = await updateRecoveryPassword(newPassword);
    setLoading(false);
    if (result.success) {
      Alert.alert("Password updated", "Sign in using your new password.");
      router.replace("/(auth)/login");
    } else {
      setError(result.error || "Could not update your password.");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Reset Password" />
      <KeyboardAvoidingView
        behavior="height"
        style={styles.flex}
      >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>
          {isRecoveryFlow ? "Choose a new password" : "Forgot your password?"}
        </Text>
        <Text style={styles.subtitle}>
          {isRecoveryFlow
            ? "Set a new password to secure your Chahat account."
            : "Enter your registered email address and we will send you a secure reset link."}
        </Text>

        {isRecoveryFlow ? (
          <View style={styles.form}>
            <Input
              label="New password"
              placeholder="8+ characters, a letter and a number"
              secureTextEntry
              value={newPassword}
              onChangeText={(t) => {
                setNewPassword(t);
                setError("");
              }}
              error={error}
            />
            <Input
              label="Confirm new password"
              placeholder="Enter the new password again"
              secureTextEntry
              value={confirmPassword}
              onChangeText={(t) => {
                setConfirmPassword(t);
                setConfirmError("");
              }}
              error={confirmError || undefined}
            />
            <Button
              title={loading ? "Updating…" : "Update password"}
              onPress={handleUpdatePassword}
              loading={loading}
              size="lg"
              style={styles.actionBtn}
            />
          </View>
        ) : sent ? (
          <View style={styles.successBox}>
            <Text style={styles.successText}>
              We sent a password reset link to {email}.
            </Text>
            <Button
              title="Back to login"
              onPress={() => router.replace("/(auth)/login")}
              style={styles.actionBtn}
            />
          </View>
        ) : (
          <View style={styles.form}>
            <Input
              label="Email"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setError("");
              }}
              error={error}
            />
            <Button
              title={loading ? "Sending…" : "Send Reset Link"}
              onPress={handleSend}
              loading={loading}
              size="lg"
              style={styles.actionBtn}
            />
          </View>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: Colors.background,
    },
    flex: {
      flex: 1,
    },
    content: {
      paddingHorizontal: Layout.screenPadding,
      paddingTop: Layout.sectionGap,
      paddingBottom: Layout.sectionGap,
    },
    title: {
      fontSize: Typography.sizes.xxl,
      fontWeight: Typography.weights.bold,
      color: Colors.foreground,
      fontFamily: Typography.fontDisplay,
    },
    subtitle: {
      fontSize: Typography.sizes.base,
      color: Colors.mutedForeground,
      marginTop: Spacing.sm,
      lineHeight: 22,
      marginBottom: Layout.sectionGap,
    },
    form: {
      width: "100%",
    },
    actionBtn: {
      marginTop: Spacing.sm,
    },
    successBox: {
      backgroundColor: Colors.highlight,
      padding: Spacing.lg,
      borderRadius: Radii.md,
    },
    successText: {
      color: Colors.highlightForeground,
      fontSize: Typography.sizes.base,
      marginBottom: Spacing.lg,
      lineHeight: 22,
    },
  });
