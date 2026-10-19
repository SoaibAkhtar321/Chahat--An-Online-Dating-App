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
import { Radii, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { signUpUser } from "../../src/services/auth";
import { setPendingSignup } from "../../src/services/pendingSignup";
import { LegalAcceptanceCheckbox } from "../../src/components/legal/LegalAcceptanceCheckbox";
import { currentLegalAcceptanceClaim } from "../../src/constants/legalVersions";
import { validateLegalAcceptance } from "../../src/utils/legalGate";

export default function SignupScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false); // never preselected
  const [errors, setErrors] = useState<{ email?: string; password?: string; legal?: string }>({});

  const validate = () => {
    const err: { email?: string; password?: string; legal?: string } = {};

    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      err.email = "Enter a valid email address";
    }

    if (password.length < 8) {
      err.password = "Use at least 8 characters";
    } else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      err.password = "Include at least one letter and one number";
    } else if (password.length > 64) {
      err.password = "Use 64 characters or fewer";
    }

    const legalError = validateLegalAcceptance(legalAccepted);
    if (legalError) err.legal = legalError;

    setErrors(err);
    return Object.keys(err).length === 0;
  };

  const handleSignup = async () => {
    if (!validate()) return;

    setLoading(true);
    const res = await signUpUser(email, password, currentLegalAcceptanceClaim());
    setLoading(false);

    if (!res.success) {
      if (/exists/i.test(res.error || "")) {
        setErrors({ email: "An account with this email already exists. Log in instead." });
      } else {
        setErrors({ password: res.error || "Could not create account" });
      }
      return;
    }

    setPendingSignup(email, password);
    router.push("/(auth)/verify");
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity style={styles.backButton} onPress={() => safeBack(router, "/(auth)/welcome")}>
            <ArrowLeft size={20} color={Colors.foreground} />
          </TouchableOpacity>

          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>
            Free with email. We'll send you a link to confirm your account.
          </Text>

          <View style={styles.form}>
            <Input
              label="Email"
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                setErrors((prev) => ({ ...prev, email: undefined }));
              }}
              error={errors.email}
            />

            <Input
              label="Password"
              placeholder="8+ characters, a letter and a number"
              secureTextEntry
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                setErrors((prev) => ({ ...prev, password: undefined }));
              }}
              error={errors.password}
            />

            <View style={styles.rulesBox}>
              <Text style={styles.rulesText}>• Must be 18 years or older to register</Text>
              <Text style={styles.rulesText}>
                • One profile per individual with authentic photos
              </Text>
            </View>

            <LegalAcceptanceCheckbox
              checked={legalAccepted}
              onChange={(next) => {
                setLegalAccepted(next);
                setErrors((prev) => ({ ...prev, legal: undefined }));
              }}
              error={errors.legal}
            />

            <Button
              title={loading ? "Creating…" : "Sign up"}
              onPress={handleSignup}
              loading={loading}
              style={styles.submitButton}
            />
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>
              Have an account?{" "}
              <Text style={styles.loginLink} onPress={() => router.push("/(auth)/login")}>
                Log in
              </Text>
            </Text>
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
  form: {
    marginTop: 32,
  },
  rulesBox: {
    backgroundColor: Colors.secondary,
    padding: 14,
    borderRadius: Radii.md,
    marginBottom: 20,
    gap: 4,
  },
  rulesText: {
    fontSize: Typography.sizes.xs,
    color: Colors.secondaryForeground,
  },
  submitButton: {
    marginTop: 8,
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
  loginLink: {
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
});
