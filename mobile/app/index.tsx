import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../src/context/AuthContext";
import { Colors } from "../src/constants/theme";

export default function Index() {
  const router = useRouter();
  const { isLoggedIn, isOnboarded, loading } = useAuth();

  useEffect(() => {
    if (loading) return;

    if (!isLoggedIn) {
      router.replace("/(auth)/welcome");
    } else if (!isOnboarded) {
      router.replace("/onboarding");
    } else {
      router.replace("/(tabs)/discover");
    }
  }, [loading, isLoggedIn, isOnboarded, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
});
