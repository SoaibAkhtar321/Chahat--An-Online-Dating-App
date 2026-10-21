import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MailCheck } from "lucide-react-native";
import { Layout, Radii, Spacing, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { Button } from "../../src/components/ui/Button";
import { Input } from "../../src/components/ui/Input";
import {
  checkSignupConfirmed,
  resendConfirmation,
  verifySignupCode,
} from "../../src/services/auth";
import { clearPendingSignup, getPendingSignup } from "../../src/services/pendingSignup";
import { useHardwareBack } from "../../src/hooks/useHardwareBack";

const RESEND_COOLDOWN_SECONDS = 60;
const POLL_INTERVAL_MS = 8000;
const POLL_MAX_MS = 10 * 60 * 1000;

export default function VerifyScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const pending = getPendingSignup();
  const [email, setEmail] = useState(pending?.email ?? "");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const done = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    clearPendingSignup();
    router.replace("/");
  }, [router]);

  // The e-mail may be confirmed through the link on any browser or device. While this screen is open, quietly check with
  // the credentials held in memory so the person continues here without logging in again.
  useEffect(() => {
    if (!pending) return;
    const startedAt = Date.now();
    let busy = false;
    const check = async () => {
      if (busy || done.current || Date.now() - startedAt > POLL_MAX_MS) return;
      busy = true;
      const result = await checkSignupConfirmed(pending.email, pending.password);
      busy = false;
      if (result === "confirmed") finish();
    };
    const timer = setInterval(check, POLL_INTERVAL_MS);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [pending, finish]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleVerify = async () => {
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    setError(null);
    setVerifying(true);
    const res = await verifySignupCode(email, code);
    setVerifying(false);
    if (res.success) finish();
    else setError(res.error || "Could not verify the code.");
  };

  const handleResend = async () => {
    if (!email.trim() || cooldown > 0) return;
    setError(null);
    setResending(true);
    const res = await resendConfirmation(email);
    setResending(false);
    if (res.success) {
      setMessage("A new code has been sent to your email.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } else {
      setError(res.error || "Could not resend the email. Try again in a minute.");
    }
  };

  const handleBack = useCallback(() => {
    clearPendingSignup();
    router.replace("/(auth)/login");
  }, [router]);

  // Hardware/gesture back does exactly what "Back to log in" does (drops the in-memory credentials used for polling).
  const onHardwareBack = useCallback(() => {
    if (verifying) return true;
    handleBack();
    return true;
  }, [verifying, handleBack]);
  useHardwareBack(onHardwareBack);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconCircle}>
          <MailCheck size={40} color={Colors.primary} />
        </View>

        <Text style={styles.title}>Check your inbox</Text>
        <Text style={styles.subtitle}>
          We sent a 6-digit code to {email || "your email"}. Enter it below to activate your Chahat
          account. You can also tap the link in the email, then come back here to continue.
        </Text>

        {!pending ? (
          <Input
            label="Email"
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />
        ) : null}

        <Input
          label="Verification code"
          placeholder="123456"
          keyboardType="number-pad"
          maxLength={8}
          value={code}
          onChangeText={setCode}
          error={error ?? undefined}
        />
        <Button
          title={verifying ? "Verifying…" : "Verify and continue"}
          onPress={handleVerify}
          loading={verifying}
          disabled={code.trim().length < 6}
          size="lg"
          style={styles.fullWidth}
        />

        {message ? <Text style={styles.noticeText}>{message}</Text> : null}

        <View style={styles.secondaryActions}>
          <Button
            title={
              resending
                ? "Sending…"
                : cooldown > 0
                  ? `Resend email in ${cooldown}s`
                  : "Resend email"
            }
            variant="text"
            size="sm"
            onPress={handleResend}
            loading={resending}
            disabled={cooldown > 0}
          />
          <Button variant="text" size="sm" title="Back to log in" onPress={handleBack} />
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
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Layout.screenPadding,
    paddingVertical: Layout.sectionGap,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: Radii.full,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Layout.sectionGap,
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
    marginTop: Spacing.sm,
    lineHeight: 22,
    marginBottom: Layout.sectionGap,
  },
  fullWidth: {
    alignSelf: "stretch",
  },
  noticeText: {
    color: Colors.success,
    textAlign: "center",
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.medium,
    marginTop: Spacing.lg,
  },
  secondaryActions: {
    alignSelf: "stretch",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
});
