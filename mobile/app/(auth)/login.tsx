import React, { useMemo, useState } from "react";
import { safeBack } from "../../src/utils/navigation";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Layout, Radii, Spacing, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { signInUser, resetPassword } from "../../src/services/auth";
import { useAuth } from "../../src/context/AuthContext";

export default function LoginScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgotPassword, setForgotPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [successNotice, setSuccessNotice] = useState("");

  const handleLogin = async () => {
    setError("");
    setEmailError("");
    setPasswordError("");
    setSuccessNotice("");

    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setEmailError("Enter a valid email address");
      return;
    }

    if (forgotPassword) {
      setLoading(true);
      const res = await resetPassword(email);
      setLoading(false);
      if (res.success) {
        setSuccessNotice("If an account exists, a reset link is on its way.");
        setForgotPassword(false);
      } else {
        setError(res.error || "Could not send reset link");
      }
      return;
    }

    if (!password) {
      setPasswordError("Enter your password");
      return;
    }

    setLoading(true);
    const res = await signInUser(email, password);
    setLoading(false);

    if (res.isUnconfirmed) {
      router.push("/(auth)/verify");
      return;
    }

    if (!res.success) {
      setError(res.error || "Could not log in right now. Please try again.");
      return;
    }

    await refreshProfile();
    router.replace("/");
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => safeBack(router, "/(auth)/welcome")}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color={Colors.foreground} />
          </TouchableOpacity>

          <Text style={styles.title}>{forgotPassword ? "Reset password" : "Welcome back"}</Text>
          <Text style={styles.subtitle}>
            {forgotPassword
              ? "We'll email you a secure reset link."
              : "Log in to pick up where you left off, on any device."}
          </Text>

          {successNotice ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>{successNotice}</Text>
            </View>
          ) : null}

          <View style={styles.form}>
            <Input
              label="Email"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                setError("");
                setEmailError("");
              }}
              error={emailError || undefined}
            />

            {!forgotPassword && (
              <Input
                label="Password"
                placeholder="Enter your password"
                secureTextEntry
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setError("");
                  setPasswordError("");
                }}
                error={passwordError || undefined}
              />
            )}

            {error ? (
              <Text style={styles.formError} accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}

            <Button
              title={loading ? "Please wait…" : forgotPassword ? "Send reset link" : "Log in"}
              onPress={handleLogin}
              loading={loading}
              disabled={loading}
              size="lg"
            />

            <TouchableOpacity
              onPress={() => {
                setForgotPassword(!forgotPassword);
                setError("");
                setEmailError("");
                setPasswordError("");
              }}
              style={styles.forgotButton}
              accessibilityRole="button"
            >
              <Text style={styles.forgotText}>
                {forgotPassword ? "Back to log in" : "Forgot password?"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>New to Chahat?</Text>
            <TouchableOpacity
              onPress={() => router.push("/(auth)/signup")}
              style={styles.footerLink}
              accessibilityRole="button"
              accessibilityLabel="Create an account"
            >
              <Text style={styles.signupLink}>Create an account</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Layout.screenPadding,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    flexGrow: 1,
  },
  backButton: {
    width: Layout.minTap,
    height: Layout.minTap,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Layout.sectionGap,
  },
  title: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    fontFamily: Typography.fontDisplay,
  },
  subtitle: {
    fontSize: Typography.sizes.base,
    color: Colors.mutedForeground,
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  successBox: {
    backgroundColor: Colors.highlight,
    padding: Spacing.md,
    borderRadius: Radii.md,
    marginTop: Spacing.lg,
  },
  successText: {
    fontSize: Typography.sizes.sm,
    color: Colors.highlightForeground,
    fontWeight: Typography.weights.medium,
  },
  form: {
    marginTop: Spacing.xxl,
  },
  formError: {
    fontSize: Typography.sizes.sm,
    color: Colors.destructive,
    fontWeight: Typography.weights.medium,
    marginBottom: Layout.fieldGap,
  },
  forgotButton: {
    minHeight: Layout.minTap,
    marginTop: Spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  forgotText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  footer: {
    marginTop: "auto",
    paddingTop: Spacing.xxl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
  },
  footerText: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
  },
  footerLink: {
    minHeight: Layout.minTap,
    justifyContent: "center",
    paddingHorizontal: Spacing.xs,
  },
  signupLink: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
});
