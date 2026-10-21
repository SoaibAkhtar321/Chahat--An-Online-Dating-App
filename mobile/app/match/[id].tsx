import React, { useMemo } from "react";
import { safeBack } from "../../src/utils/navigation";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Radii, Shadows, Typography, ThemeColors, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { useAuth } from "../../src/context/AuthContext";
import { useMilo } from "../../src/context/MiloContext";
import { ProfilePhoto } from "../../src/components/profile/ProfilePhoto";

export default function MatchScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile: myProfile } = useAuth();
  const { deck, matches } = useMilo();

  const otherUser =
    deck.find((p) => p.id === id) ||
    matches.find((m) => m.otherUser.id === id || m.id === id)?.otherUser || {
      id: id || "unknown",
      name: "Your Match",
      photos: [],
    };

  const myPhotoUri =
    myProfile?.photos && myProfile.photos.length > 0 ? myProfile.photos[0]!.uri : undefined;
  const otherPhotoUri =
    otherUser.photos && otherUser.photos.length > 0 ? otherUser.photos[0] : undefined;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.logo}>
          chaha<Text style={styles.logoAccent}>t</Text>
        </Text>
      </View>

      <View style={styles.centerSection}>
        <Text style={styles.title}>It's a match!</Text>
        <Text style={styles.subtitle}>You and {otherUser.name} liked each other.</Text>

        {/* Overlapping photo cards */}
        <View style={styles.photosWrapper}>
          <ProfilePhoto
            uri={myPhotoUri}
            name={myProfile?.name || "You"}
            style={[styles.photoCard, styles.photoLeft]}
            placeholderSize={90}
          />
          <ProfilePhoto
            uri={otherPhotoUri}
            name={otherUser.name}
            style={[styles.photoCard, styles.photoRight]}
            placeholderSize={90}
          />
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.chatButton}
          onPress={() => {
            const matchId = matches.find((m) => m.otherUser.id === id)?.id || id;
            router.replace({
              pathname: "/chat/[id]",
              params: { id: matchId },
            });
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.chatButtonText}>Say hello</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.keepButton}
          onPress={() => safeBack(router)}
          activeOpacity={0.8}
        >
          <Text style={styles.keepButtonText}>Keep discovering</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primary,
    justifyContent: "space-between",
    padding: Spacing.xl,
  },
  header: {
    alignItems: "center",
    paddingTop: Spacing.md,
  },
  logo: {
    fontSize: 36,
    fontFamily: Typography.fontDisplay,
    fontWeight: Typography.weights.bold,
    fontStyle: "italic",
    color: Colors.primaryForeground,
  },
  logoAccent: {
    color: Colors.accent,
  },
  centerSection: {
    alignItems: "center",
  },
  title: {
    fontSize: 44,
    fontFamily: Typography.fontDisplay,
    fontWeight: Typography.weights.bold,
    fontStyle: "italic",
    color: Colors.primaryForeground,
    textAlign: "center",
  },
  subtitle: {
    fontSize: Typography.sizes.base,
    color: Colors.primaryForeground,
    opacity: 0.9,
    marginTop: Spacing.sm,
    textAlign: "center",
  },
  photosWrapper: {
    width: 280,
    height: 240,
    position: "relative",
    marginTop: Spacing.xxl,
    alignItems: "center",
    justifyContent: "center",
  },
  photoCard: {
    width: 150,
    height: 200,
    borderRadius: Radii.xxl,
    borderWidth: 4,
    borderColor: Colors.primaryForeground,
    position: "absolute",
    ...Shadows.card,
  },
  photoPlaceholder: {
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  photoLeft: {
    left: 20,
    transform: [{ rotate: "-8deg" }],
  },
  photoRight: {
    right: 20,
    top: 20,
    transform: [{ rotate: "8deg" }],
  },
  actions: {
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  chatButton: {
    backgroundColor: Colors.card,
    height: 54,
    borderRadius: Radii.full,
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.card,
  },
  chatButtonText: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  keepButton: {
    height: 54,
    borderRadius: Radii.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.4)",
  },
  keepButtonText: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.primaryForeground,
  },
});
