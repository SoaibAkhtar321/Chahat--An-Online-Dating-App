import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { Lock, Heart } from "lucide-react-native";
import { Radii, Shadows, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { useMilo } from "../../src/context/MiloContext";
import { Button } from "../../src/components/ui/Button";

const { width } = Dimensions.get("window");
const CARD_SIZE = (width - 48) / 2;

export default function LikesScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { deck, swipeCard } = useMilo();

  // Likers are profiles with likesYou = true
  const likers = deck.filter((p) => p.likesYou);
  const isPremiumUser = false; // Initial MVP does not gate or charge; free matching stays primary

  const handleLikeBack = async (id: string) => {
    const res = await swipeCard("like");
    if (res.isMatch) {
      router.push({
        pathname: "/match/[id]",
        params: { id },
      });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Likes</Text>
        <Text style={styles.subtitle}>
          {likers.length > 0
            ? `${likers.length} ${likers.length === 1 ? "person" : "people"} liked you`
            : "No new likes right now. Keep your profile fresh!"}
        </Text>

        <View style={styles.grid}>
          {likers.map((profile) => (
            <View key={profile.id} style={styles.gridItem}>
              {isPremiumUser ? (
                <TouchableOpacity
                  style={styles.card}
                  onPress={() =>
                    router.push({
                      pathname: "/profile/[id]",
                      params: { id: profile.id },
                    })
                  }
                  activeOpacity={0.8}
                >
                  <Image
                    source={{ uri: profile.photos[0] }}
                    style={styles.image}
                    contentFit="cover"
                  />
                  <View style={styles.cardFooter}>
                    <Text style={styles.cardName}>
                      {profile.name}, {profile.age}
                    </Text>
                    <TouchableOpacity
                      onPress={() => handleLikeBack(profile.id)}
                      style={styles.likeBackBtn}
                      activeOpacity={0.8}
                    >
                      <Heart
                        size={16}
                        color={Colors.primaryForeground}
                        fill={Colors.primaryForeground}
                      />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              ) : (
                <View style={styles.lockedCard}>
                  <View style={styles.lockIconCircle}>
                    <Lock size={28} color={Colors.mutedForeground} />
                  </View>
                  <Text style={styles.lockedHint}>Someone near you</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        {likers.length > 0 && !isPremiumUser && (
          <View style={styles.premiumBanner}>
            <Text style={styles.bannerTitle}>See who likes you</Text>
            <Text style={styles.bannerDesc}>
              The full incoming-likes list is a premium preview. Swiping and chatting stay 100%
              free: when you like them back in Discover, you will match immediately!
            </Text>
            <Button
              title="Explore Premium"
              onPress={() => router.push("/premium")}
              style={styles.bannerBtn}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  title: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
  },
  subtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    marginTop: 4,
    marginBottom: 24,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  gridItem: {
    width: CARD_SIZE,
    height: CARD_SIZE * 1.33,
    borderRadius: Radii.xl,
    overflow: "hidden",
  },
  card: {
    width: "100%",
    height: "100%",
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  cardFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "rgba(35, 20, 30, 0.7)",
  },
  cardName: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.primaryForeground,
  },
  likeBackBtn: {
    width: 32,
    height: 32,
    borderRadius: Radii.full,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  lockedCard: {
    width: "100%",
    height: "100%",
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  lockIconCircle: {
    width: 56,
    height: 56,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  lockedHint: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    fontWeight: Typography.weights.semibold,
  },
  premiumBanner: {
    backgroundColor: Colors.secondary,
    borderRadius: Radii.xxl,
    padding: 20,
    marginTop: 28,
    alignItems: "center",
  },
  bannerTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: 6,
  },
  bannerDesc: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  bannerBtn: {
    width: "100%",
  },
});
