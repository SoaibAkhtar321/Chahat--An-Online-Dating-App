import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Heart } from "lucide-react-native";
import { Radii, Shadows, Typography, ThemeColors, Layout, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { ProfilePhoto } from "../../src/components/profile/ProfilePhoto";
import { useMilo } from "../../src/context/MiloContext";
import { Button } from "../../src/components/ui/Button";
import { useAuth } from "../../src/context/AuthContext";
import { Alert } from "../../src/utils/alert";
import { isSupabaseConfigured } from "../../src/services/supabase";
import { fetchLikesAccess, fetchReceivedLikes } from "../../src/services/likes";
import { submitSwipe } from "../../src/services/discovery";
import type { Profile } from "../../src/types";

const { width } = Dimensions.get("window");
const CARD_SIZE = (width - 48) / 2;

type LoadState = "loading" | "ready" | "error";

export default function LikesScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { user } = useAuth();
  const { deck, refreshMatches } = useMilo();
  const backend = isSupabaseConfigured();

  const [state, setState] = useState<LoadState>(backend ? "loading" : "ready");
  const [eligible, setEligible] = useState(false);
  const [count, setCount] = useState(0);
  const [likers, setLikers] = useState<Profile[]>([]);

  const load = useCallback(async () => {
    if (!backend) return;
    setState("loading");
    // The server decides entitlement; the client only renders what it is allowed to see.
    const access = await fetchLikesAccess();
    if (!access) {
      // Never greet the person with a failure message: show the normal "see who likes you" view with a soft refresh.
      setEligible(false);
      setCount(0);
      setLikers([]);
      setState("error");
      return;
    }
    setEligible(access.eligible);
    setCount(access.count ?? 0);
    if (!access.eligible) {
      setLikers([]);
      setState("ready");
      return;
    }
    const result = await fetchReceivedLikes();
    if (result.status === "ok") {
      setLikers(result.profiles);
      setCount(result.profiles.length);
      setState("ready");
    } else if (result.status === "upgrade_required") {
      setEligible(false);
      setLikers([]);
      setState("ready");
    } else {
      setState("error");
    }
  }, [backend]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // No backend configured (local preview): fall back to the demo deck, as before.
  const previewLikers = deck.filter((p) => p.likesYou);
  const shown = backend ? likers : previewLikers;
  const isPremiumUser = backend ? eligible : true;
  const total = backend ? count : previewLikers.length;

  const handleLikeBack = async (id: string) => {
    if (!user) return;
    // Like back the profile that was tapped (not whatever happens to be first in the deck).
    const res = await submitSwipe(id, "like", user.id);
    if (!res.success) {
      Alert.alert("Couldn't like back", res.error || "Please try again.");
      return;
    }
    void refreshMatches();
    void load();
    if (res.isMatch) {
      router.push({ pathname: "/match/[id]", params: { id: res.matchId || id } });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Likes</Text>
        <Text style={styles.subtitle}>
          {backend && !isPremiumUser
              ? "Premium members can see who likes them."
              : total > 0
              ? `${total} ${total === 1 ? "person" : "people"} liked you`
              : "No new likes right now. Keep your profile fresh!"}
        </Text>

        <View style={styles.grid}>
          {shown.map((profile) => (
            <View key={profile.id} style={styles.gridItem}>
              <TouchableOpacity
                style={styles.card}
                onPress={() =>
                  router.push({ pathname: "/profile/[id]", params: { id: profile.id } })
                }
                activeOpacity={0.8}
              >
                <ProfilePhoto uri={profile.photos[0]} name={profile.name} style={styles.image} />
                <View style={styles.cardFooter}>
                  <Text style={styles.cardName}>
                    {profile.name}
                    {profile.age ? `, ${profile.age}` : ""}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleLikeBack(profile.id)}
                    style={styles.likeBackBtn}
                    activeOpacity={0.8}
                  >
                    <Heart size={16} color={Colors.primaryForeground} fill={Colors.primaryForeground} />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {state === "ready" && isPremiumUser && total === 0 && (
          <View style={styles.premiumBanner}>
            <Text style={styles.bannerTitle}>No likes yet</Text>
            <Text style={styles.bannerDesc}>
              Complete your profile and keep exploring to get noticed.
            </Text>
            <Button
              title="Go to Discover"
              onPress={() => router.push("/(tabs)/discover")}
              style={styles.bannerBtn}
            />
          </View>
        )}

        {(state === "ready" || state === "error") && backend && !isPremiumUser && (
          <View style={styles.premiumBanner}>
            <Text style={styles.bannerTitle}>See who likes you</Text>
            <Text style={styles.bannerDesc}>
              Seeing the full list of people who liked you is a Premium feature. Swiping and chatting
              stay free: when you like someone back in Discover, you will match immediately!
            </Text>
            <Button
              title="Explore Premium"
              onPress={() => router.push("/premium")}
              style={styles.bannerBtn}
            />
            {state === "error" && (
              <Button
                title="Refresh"
                variant="ghost"
                onPress={() => void load()}
                style={styles.bannerBtn}
              />
            )}
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
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
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
    marginTop: Spacing.xs,
    marginBottom: Spacing.xl,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.md,
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
    padding: Spacing.md,
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
    width: Layout.minTap,
    height: Layout.minTap,
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
    padding: Spacing.md,
  },
  lockIconCircle: {
    width: 56,
    height: 56,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  lockedHint: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    fontWeight: Typography.weights.semibold,
  },
  premiumBanner: {
    backgroundColor: Colors.secondary,
    borderRadius: Radii.xxl,
    padding: Spacing.lg,
    marginTop: Spacing.xl,
    alignItems: "center",
  },
  bannerTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: Spacing.sm,
  },
  bannerDesc: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  bannerBtn: {
    width: "100%",
  },
});
