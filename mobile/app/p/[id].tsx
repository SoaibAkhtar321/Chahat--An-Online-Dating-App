// Opened by a shared profile link: https://chahatlegal.netlify.app/p/<id> (Android App Link) or chahat://p/<id>.
// Signed-in, onboarded members go straight to the profile; anyone else is sent through the normal start flow and
// the profile opens afterwards (see index.tsx).
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { isValidProfileId, setPendingSharedProfile } from "../../src/services/profileShare";

export default function SharedProfileLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { loading, isLoggedIn, isOnboarded, legalStatus } = useAuth();

  useEffect(() => {
    if (loading) return;
    const valid = isValidProfileId(id);
    if (valid && isLoggedIn && isOnboarded && legalStatus === "accepted") {
      router.replace({ pathname: "/profile/[id]", params: { id: id.toLowerCase() } });
      return;
    }
    setPendingSharedProfile(valid ? id : null);
    router.replace("/");
  }, [loading, isLoggedIn, isOnboarded, legalStatus, id, router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
