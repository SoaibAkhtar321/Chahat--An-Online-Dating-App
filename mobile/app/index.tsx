import React, { useMemo, useEffect } from "react";
import { View, ActivityIndicator, StyleSheet, Text, TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/context/AuthContext";
import { ThemeColors } from "../src/constants/theme";
import { useTheme } from "../src/context/ThemeContext";
import { Alert } from "../src/utils/alert";

export default function Index() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { isLoggedIn, isOnboarded, loading, profile, profileError, refreshProfile, signOut } =
    useAuth();

  useEffect(() => {
    if (loading) return;
    if (isLoggedIn && !profile) return; // profile failed to load: show retry below, never guess onboarding

    if (!isLoggedIn) {
      router.replace("/(auth)/welcome");
    } else if (!isOnboarded) {
      router.replace("/onboarding");
    } else {
      router.replace("/(tabs)/discover");
    }
  }, [loading, isLoggedIn, isOnboarded, profile, router]);

  if (!loading && isLoggedIn && !profile && profileError) {
    return (
      <View style={styles.container}>
        <Text style={{ marginBottom: 16 }}>Could not load your profile.</Text>
        <TouchableOpacity onPress={() => refreshProfile()}>
          <Text style={{ color: Colors.primary, marginBottom: 16 }}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={async () => {
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
          }}
        >
          <Text>Sign out</Text>
        </TouchableOpacity>
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
      justifyContent: "center",
      alignItems: "center",
    },
  });
