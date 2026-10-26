import React, { useMemo, useState } from "react";
import { safeBack } from "../../src/utils/navigation";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Layout, Radii, Spacing, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Input } from "../../src/components/ui/Input";
import { Button } from "../../src/components/ui/Button";
import { signUpUser } from "../../src/services/auth";
import { setPendingSignup } from "../../src/services/pendingSignup";
import { GoogleSignInButton } from "../../src/components/auth/GoogleSignInButton";
import { useAuth } from "../../src/context/AuthContext";
import { LegalAcceptanceCheckbox } from "../../src/components/legal/LegalAcceptanceCheckbox";
import { currentLegalAcceptanceClaim } from "../../src/constants/legalVersions";
import { validateLegalAcceptance } from "../../src/utils/legalGate";

export default function SignupScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { refreshProfile } = useAuth();
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

    if (res.signedIn) {
      await refreshProfile();
      router.replace("/");
      return;
    }

    setPendingSignup(email, password);
    router.push("/(auth)/verify");
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior="height"
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

          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.subtitle}>Join Chahat in under a minute.</Text>

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

            <Text style={styles.rulesText}>
              You must be 18 or older. One profile per person, with authentic photos.
            </Text>

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
              disabled={loading}
              size="lg"
            />

            <GoogleSignInButton />
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Have an account?</Text>
            <TouchableOpacity
              onPress={() => router.push("/(auth)/login")}
              style={styles.footerLink}
              accessibilityRole="button"
              accessibilityLabel="Log in"
            >
              <Text style={styles.loginLink}>Log in</Text>
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
  form: {
    marginTop: Spacing.xxl,
  },
  rulesText: {
    fontSize: Typography.sizes.sm,
    lineHeight: 20,
    color: Colors.mutedForeground,
    marginBottom: Layout.fieldGap,
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
  loginLink: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
});
