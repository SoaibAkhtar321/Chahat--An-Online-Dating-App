import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { useAuth } from "../../src/context/AuthContext";
import { Button } from "../../src/components/ui/Button";
import { LegalAcceptanceCheckbox } from "../../src/components/legal/LegalAcceptanceCheckbox";
import { acceptCurrentLegalDocuments } from "../../src/services/legalAcceptance";
import { validateLegalAcceptance } from "../../src/utils/legalGate";
import { Alert } from "../../src/utils/alert";

// Shown to signed-in users who have not accepted the CURRENT Terms/Privacy versions (existing users are never
// auto-marked as accepted). There is no back button: the app cannot be used until the user accepts or signs out.
export default function AcceptLegalScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { refreshLegalStatus, signOut } = useAuth();
  const [accepted, setAccepted] = useState(false); // never preselected
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const onContinue = async () => {
    const validation = validateLegalAcceptance(accepted);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    const result = await acceptCurrentLegalDocuments();
    if (!result.success) {
      setSaving(false);
      setError(result.error);
      return;
    }
    await refreshLegalStatus();
    setSaving(false);
    router.replace("/");
  };

  const onSignOut = async () => {
    try {
      await signOut();
      router.replace("/");
    } catch (e) {
      Alert.alert("Could not sign out", e instanceof Error ? e.message : "Please try again.");
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Terms & Privacy</Text>
        <Text style={styles.subtitle}>
          To keep using Chahat, please review our Terms & Conditions and Privacy Policy and confirm below.
        </Text>
        <View style={styles.form}>
          <LegalAcceptanceCheckbox
            checked={accepted}
            onChange={(next) => {
              setAccepted(next);
              setError(undefined);
            }}
            error={error}
          />
          <Button title={saving ? "Saving…" : "Continue"} onPress={onContinue} loading={saving} />
          <Button title="Sign out" variant="ghost" onPress={onSignOut} style={styles.signOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 24, flexGrow: 1, justifyContent: "center" },
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
    form: { marginTop: 32 },
    signOut: { marginTop: 8 },
  });
