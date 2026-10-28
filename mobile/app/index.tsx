import React, { useMemo, useEffect } from "react";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/context/AuthContext";
import { Layout, Spacing, ThemeColors, Typography } from "../src/constants/theme";
import { Button } from "../src/components/ui/Button";
import { useTheme } from "../src/context/ThemeContext";
import { Alert } from "../src/utils/alert";
import { takePendingSharedProfile } from "../src/services/profileShare";

export default function Index() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const {
    isLoggedIn,
    isOnboarded,
    loading,
    profile,
    profileError,
    profileErrorDetail,
    legalStatus,
    refreshLegalStatus,
    refreshProfile,
    signOut,
  } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (isLoggedIn && !profile) return; // profile failed to load: show retry below, never guess onboarding

    if (!isLoggedIn) {
      router.replace("/(auth)/welcome");
    } else if (legalStatus === "unknown" || legalStatus === "error") {
      return; // wait for (or retry) the acceptance check; never guess
    } else if (legalStatus === "required") {
      router.replace("/legal/accept");
    } else if (!isOnboarded) {
      router.replace("/onboarding");
    } else {
      router.replace("/(tabs)/discover");
      // A shared profile link opened before sign-in / onboarding opens now, on top of the main app.
      const sharedProfileId = takePendingSharedProfile();
      if (sharedProfileId) router.push({ pathname: "/profile/[id]", params: { id: sharedProfileId } });
    }
  }, [loading, isLoggedIn, isOnboarded, profile, legalStatus, router]);

  const signOutSafely = async () => {
    try {
      await signOut();
    } catch (error) {
      Alert.alert(
        "Could not sign out securely",
        error instanceof Error
          ? error.message
          : "The device notification token could not be removed. Retry when connected.",
      );
    }
  };

  if (!loading && isLoggedIn && !profile && profileError) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>We couldn't load your profile</Text>
        <Text style={styles.body}>Check your internet connection and try again. Your account is safe.</Text>
        {profileErrorDetail ? <Text style={styles.detail}>{profileErrorDetail}</Text> : null}
        <View style={styles.actions}>
          <Button title="Try again" size="lg" onPress={() => refreshProfile()} />
          <Button title="Sign out" variant="text" onPress={signOutSafely} />
        </View>
      </View>
    );
  }

  if (!loading && isLoggedIn && profile && legalStatus === "error") {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>We couldn't check your agreements</Text>
        <Text style={styles.body}>Check your internet connection and try again.</Text>
        <View style={styles.actions}>
          <Button title="Try again" size="lg" onPress={() => refreshLegalStatus()} />
          <Button title="Sign out" variant="text" onPress={() => signOut().catch(() => {})} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: Colors.background,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: Layout.screenPadding,
    },
    title: {
      fontSize: Typography.sizes.xl,
      fontWeight: Typography.weights.bold,
      fontFamily: Typography.fontDisplay,
      color: Colors.foreground,
      textAlign: "center",
    },
    body: {
      fontSize: Typography.sizes.base,
      color: Colors.mutedForeground,
      textAlign: "center",
      lineHeight: 22,
      marginTop: Spacing.sm,
    },
    detail: {
      fontSize: Typography.sizes.xs,
      color: Colors.mutedForeground,
      textAlign: "center",
      marginTop: Spacing.md,
    },
    actions: {
      alignSelf: "stretch",
      maxWidth: 320,
      width: "100%",
      marginTop: Spacing.xxl,
      gap: Spacing.sm,
    },
  });
