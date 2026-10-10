import React, { useState } from "react";
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
import { Colors, Radii, Typography } from "../../src/constants/theme";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { signInUser, resetPassword } from "../../src/services/auth";
import { useAuth } from "../../src/context/AuthContext";

export default function LoginScreen() {
  const router = useRouter();
  const { refreshProfile } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgotPassword, setForgotPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successNotice, setSuccessNotice] = useState("");

  const handleLogin = async () => {
    setError("");
    setSuccessNotice("");

    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid email address");
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
      setError("Enter your password");
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
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
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
              }}
              error={error && !password ? error : undefined}
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
                }}
                error={error}
              />
            )}

            <Button
              title={loading ? "Please wait…" : forgotPassword ? "Send reset link" : "Log in"}
              onPress={handleLogin}
              loading={loading}
              style={styles.submitButton}
            />

            <TouchableOpacity
              onPress={() => {
                setForgotPassword(!forgotPassword);
                setError("");
              }}
              style={styles.forgotButton}
            >
              <Text style={styles.forgotText}>
                {forgotPassword ? "Back to log in" : "Forgot password?"}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              New to Milo?{" "}
              <Text style={styles.signupLink} onPress={() => router.push("/(auth)/signup")}>
                Create an account
              </Text>
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    flexGrow: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
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
    marginTop: 6,
    lineHeight: 22,
  },
  successBox: {
    backgroundColor: Colors.highlight,
    padding: 12,
    borderRadius: Radii.md,
    marginTop: 16,
  },
  successText: {
    fontSize: Typography.sizes.sm,
    color: Colors.highlightForeground,
    fontWeight: Typography.weights.medium,
  },
  form: {
    marginTop: 32,
  },
  submitButton: {
    marginTop: 12,
  },
  forgotButton: {
    marginTop: 20,
    alignItems: "center",
  },
  forgotText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  footer: {
    marginTop: "auto",
    paddingTop: 32,
    alignItems: "center",
  },
  footerText: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
  },
  signupLink: {
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
});
