import React, { useState, useMemo, useEffect } from "react";
import { safeBack } from "../../src/utils/navigation";
import { getDistanceTo } from "../../src/services/location";
import { fetchVerifiedIds } from "../../src/services/verificationBadges";
import { formatDistanceLabel } from "../../src/services/locationPolicy";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  MapPin,
  Briefcase,
  GraduationCap,
  Heart,
  X,
  Flag,
  Ban,
  BadgeCheck,
  Sparkles,
  HeartHandshake,
} from "lucide-react-native";
import { VoiceIntroPlayer } from "../../src/components/profile/VoiceIntroPlayer";
import { ProfilePhoto } from "../../src/components/profile/ProfilePhoto";
import { Radii, Shadows, Typography, ThemeColors, Layout, Spacing } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { useAuth } from "../../src/context/AuthContext";
import { useMilo } from "../../src/context/MiloContext";
import { blockUser, reportUser } from "../../src/services/moderation";
import { supabase, isSupabaseConfigured } from "../../src/services/supabase";
import { getSignedUrls } from "../../src/services/storage";
import { AvatarPlaceholder } from "../../src/components/ui/AvatarPlaceholder";
import { Dialog } from "../../src/components/ui/Dialog";
import { Alert } from "../../src/utils/alert";
import type { Profile } from "../../src/types";

const { width } = Dimensions.get("window");

export default function ProfileDetailScreen() {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile: myProfile } = useAuth();
  const { deck, swipeCard } = useMilo();

  const [dialogAction, setDialogAction] = useState<"block" | "report" | null>(null);
  const [fetchedProfile, setFetchedProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);

  // Search profile in deck first
  const deckMatch = deck.find((p) => p.id === id);

  useEffect(() => {
    if (deckMatch || !id || !isSupabaseConfigured()) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const { data: profRows, error } = await supabase.rpc("get_public_profile", { _id: id });
        if (error || !profRows || (Array.isArray(profRows) && profRows.length === 0)) {
          if (!cancelled) setLoading(false);
          return;
        }
        const prof = Array.isArray(profRows) ? profRows[0] : profRows;
        const photoPaths = Array.isArray(prof.photos)
          ? prof.photos.map((p: any) => p.path).filter(Boolean)
          : [];
        const signed = await getSignedUrls("photos", photoPaths);
        const photos = Array.isArray(prof.photos)
          ? prof.photos
              .map((p: any) => (p.path ? signed[p.path] || "" : ""))
              .filter(Boolean)
          : [];

        // Bucketed distance from the server; null when unknown, hidden by the other member, or blocked.
        const [distanceKm, verified] = await Promise.all([
          getDistanceTo(prof.id).catch(() => null),
          fetchVerifiedIds([prof.id]),
        ]);

        if (!cancelled) {
          setFetchedProfile({
            id: prof.id,
            name: prof.name || "Member",
            age: prof.age || 0,
            city: prof.city || "",
            distanceKm,
            bio: prof.bio || "",
            photos,
            interests: prof.interests || [],
            intent: prof.intents?.[0] || "",
            intents: prof.intents || [],
            work: prof.work,
            education: prof.education,
            prompt: prof.prompt,
            lifestyle: prof.lifestyle,
            languages: prof.languages || [],
            isVerified: verified.has(prof.id),
            verificationStatus: verified.has(prof.id) ? "approved" : "none",
          });
          setLoading(false);
        }
      } catch (err) {
        console.warn("get_public_profile failed:", err);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, deckMatch]);

  const targetProfile: Profile | null = deckMatch || fetchedProfile;

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </SafeAreaView>
    );
  }

  if (!targetProfile) {
    return (
      <SafeAreaView style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>Profile not found</Text>
        <TouchableOpacity style={styles.backBtnAlt} onPress={() => safeBack(router)}>
          <Text style={styles.backBtnText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Compatibility score calculation based on shared interests & languages
  const myInterests = myProfile?.interests || [];
  const sharedInterests = (targetProfile.interests || []).filter((i) => myInterests.includes(i));
  const score = Math.min(95, 60 + sharedInterests.length * 10);

  const handleAction = async (dir: "like" | "pass") => {
    const res = await swipeCard(dir);
    if (res.isMatch) {
      router.replace({
        pathname: "/match/[id]",
        params: { id: targetProfile.id },
      });
    } else {
      safeBack(router);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Photo Gallery Header */}
        <View style={styles.photoContainer}>
          {targetProfile.photos && targetProfile.photos.length > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
              {targetProfile.photos.map((uri, idx) => (
                <ProfilePhoto
                  key={`${targetProfile.id}-${idx}-${uri}`}
                  uri={uri}
                  name={targetProfile.name}
                  style={styles.heroPhoto}
                  placeholderSize={120}
                />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.heroPlaceholder}>
              <AvatarPlaceholder name={targetProfile.name} size={120} />
            </View>
          )}

          <TouchableOpacity
            style={styles.backButton}
            onPress={() => safeBack(router)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={20} color={Colors.foreground} />
          </TouchableOpacity>

          {targetProfile.photos && targetProfile.photos.length > 0 && (
            <View style={styles.photoCountBadge}>
              <Text style={styles.photoCountText}>{targetProfile.photos.length} photos</Text>
            </View>
          )}
        </View>

        {/* Profile Info */}
        <View style={styles.detailsBody}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>
              {targetProfile.name}, {targetProfile.age}
            </Text>
            {(targetProfile.isVerified || targetProfile.verificationStatus === "approved") && (
              <BadgeCheck size={22} color={Colors.accent} fill={Colors.accent} />
            )}
          </View>

          <View style={styles.metaRow}>
            <MapPin size={16} color={Colors.mutedForeground} />
            <Text style={styles.metaText}>
              {[targetProfile.city, formatDistanceLabel(targetProfile.distanceKm, "device")].filter(Boolean).join(" · ") ||
                "Location not shared"}
            </Text>
          </View>

          {/* Relationship Intentions Badge */}
          {targetProfile.intent ? (
            <View style={styles.intentCard}>
              <View style={styles.intentIconBox}>
                <HeartHandshake size={18} color={Colors.primary} />
              </View>
              <View style={styles.intentTextBox}>
                <Text style={styles.intentHeading}>Looking for / संबंध इरादा:</Text>
                <Text style={styles.intentValue}>{targetProfile.intent}</Text>
              </View>
            </View>
          ) : null}

          {/* Voice Introduction Player */}
          <VoiceIntroPlayer userId={targetProfile.id} userName={targetProfile.name} />

          {/* Compatibility Card */}
          <View style={styles.compatCard}>
            <View style={styles.compatHeaderRow}>
              <Sparkles size={18} color={Colors.accent} />
              <Text style={styles.compatTitle}>
                <Text style={styles.compatScore}>{score}%</Text> Compatibility Summary
              </Text>
            </View>
            <Text style={styles.compatDesc}>
              {sharedInterests.length > 0
                ? `You both love ${sharedInterests.join(", ")}. Strong lifestyle alignment in city and age preferences.`
                : "Common lifestyle and relationship goal alignment detected."}
            </Text>
            <Text style={styles.compatDisclaimer}>
              *Score is calculated from shared interests & relationship goals as an estimate, not a scientific guarantee.
            </Text>
          </View>

          {/* Bio */}
          {targetProfile.bio ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.bioText}>{targetProfile.bio}</Text>
            </View>
          ) : null}

          {/* Prompt */}
          {targetProfile.prompt?.a ? (
            <View style={styles.promptCard}>
              <Text style={styles.promptQ}>{targetProfile.prompt.q}</Text>
              <Text style={styles.promptA}>{targetProfile.prompt.a}</Text>
            </View>
          ) : null}

          {/* Work / Education */}
          {targetProfile.work || targetProfile.education ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Basics</Text>
              {targetProfile.work ? (
                <View style={styles.basicRow}>
                  <Briefcase size={16} color={Colors.primary} />
                  <Text style={styles.basicText}>{targetProfile.work}</Text>
                </View>
              ) : null}
              {targetProfile.education ? (
                <View style={styles.basicRow}>
                  <GraduationCap size={16} color={Colors.primary} />
                  <Text style={styles.basicText}>{targetProfile.education}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Interests */}
          {targetProfile.interests.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Interests</Text>
              <View style={styles.chipWrap}>
                {targetProfile.interests.map((interest) => (
                  <View
                    key={interest}
                    style={[
                      styles.interestPill,
                      myInterests.includes(interest) && styles.sharedInterestPill,
                    ]}
                  >
                    <Text
                      style={[
                        styles.interestText,
                        myInterests.includes(interest) && styles.sharedInterestText,
                      ]}
                    >
                      {interest}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Safety options */}
          <View style={styles.safetyRow}>
            <TouchableOpacity style={styles.safetyOption} onPress={() => setDialogAction("report")}>
              <Flag size={16} color={Colors.mutedForeground} />
              <Text style={styles.safetyText}>Report {targetProfile.name}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.safetyOption} onPress={() => setDialogAction("block")}>
              <Ban size={16} color={Colors.destructive} />
              <Text style={[styles.safetyText, { color: Colors.destructive }]}>Block profile</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Action Floating Buttons */}
      <View style={styles.floatingActions}>
        <TouchableOpacity
          style={styles.passButton}
          onPress={() => handleAction("pass")}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Pass"
        >
          <X size={28} color={Colors.mutedForeground} strokeWidth={2.5} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.likeButton}
          onPress={() => handleAction("like")}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Like"
        >
          <Heart size={32} color={Colors.primaryForeground} fill={Colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      {/* Safety Dialog */}
      <Dialog
        visible={dialogAction !== null}
        title={
          dialogAction === "block" ? `Block ${targetProfile.name}?` : `Report ${targetProfile.name}`
        }
        body={
          dialogAction === "block"
            ? "They will no longer appear in your discovery deck or be able to message you."
            : "Help us keep Chahat genuine and safe. Please confirm your report."
        }
        confirmText={dialogAction === "block" ? "Block" : "Submit Report"}
        danger={dialogAction === "block"}
        onConfirm={async () => {
          if (dialogAction === "block") {
            await blockUser(targetProfile.id);
            setDialogAction(null);
            safeBack(router);
          } else {
            const rep = await reportUser(
              targetProfile.id,
              "Profile concern",
              "Reported from profile detail",
              "profile",
            );
            setDialogAction(null);
            if (rep.success) {
              Alert.alert("Report submitted", "Thank you for helping keep Chahat safe.");
              safeBack(router);
            } else {
              Alert.alert("Could not report", rep.error || "Please try again later.");
            }
          }
        }}
        onCancel={() => setDialogAction(null)}
      />
    </SafeAreaView>
  );
}

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  photoContainer: {
    width,
    height: width * 1.33,
    position: "relative",
  },
  heroPhoto: {
    width,
    height: width * 1.33,
  },
  backButton: {
    position: "absolute",
    top: 16,
    left: 16,
    width: Layout.minTap,
    height: Layout.minTap,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.card,
  },
  photoCountBadge: {
    position: "absolute",
    bottom: 16,
    right: 16,
    backgroundColor: "rgba(35, 20, 30, 0.7)",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.full,
  },
  photoCountText: {
    fontSize: Typography.sizes.xs,
    color: Colors.primaryForeground,
    fontWeight: Typography.weights.bold,
  },
  detailsBody: {
    padding: Spacing.xl,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  name: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  metaText: {
    fontSize: Typography.sizes.base,
    color: Colors.mutedForeground,
  },
  intentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.secondary,
    padding: Spacing.lg,
    borderRadius: Radii.xl,
    marginTop: Spacing.md,
  },
  intentIconBox: {
    width: 38,
    height: 38,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  intentTextBox: {
    flex: 1,
  },
  intentHeading: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    fontWeight: Typography.weights.semibold,
  },
  intentValue: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginTop: Spacing.xs,
  },
  compatCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginVertical: Spacing.md,
  },
  compatHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  compatTitle: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  compatScore: {
    fontSize: Typography.sizes.xl,
    fontFamily: Typography.fontDisplay,
    color: Colors.primary,
  },
  compatDesc: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    lineHeight: 20,
    marginTop: Spacing.xs,
  },
  compatDisclaimer: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    fontStyle: "italic",
    marginTop: Spacing.sm,
    lineHeight: 14,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: Spacing.sm,
  },
  bioText: {
    fontSize: Typography.sizes.base,
    color: Colors.foreground,
    lineHeight: 22,
  },
  promptCard: {
    backgroundColor: Colors.secondary,
    padding: Spacing.lg,
    borderRadius: Radii.xl,
    marginBottom: Spacing.lg,
  },
  promptQ: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  promptA: {
    fontSize: Typography.sizes.lg,
    fontFamily: Typography.fontDisplay,
    color: Colors.foreground,
    marginTop: Spacing.sm,
  },
  basicRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginVertical: Spacing.xs,
  },
  basicText: {
    fontSize: Typography.sizes.base,
    color: Colors.foreground,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  interestPill: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.full,
  },
  sharedInterestPill: {
    backgroundColor: Colors.highlight,
    borderColor: Colors.highlight,
  },
  interestText: {
    fontSize: Typography.sizes.sm,
    color: Colors.foreground,
  },
  sharedInterestText: {
    color: Colors.highlightForeground,
    fontWeight: Typography.weights.bold,
  },
  safetyRow: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.md,
  },
  safetyOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  safetyText: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
  },
  floatingActions: {
    position: "absolute",
    bottom: 20,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    gap: Spacing.xl,
  },
  passButton: {
    width: 60,
    height: 60,
    borderRadius: Radii.full,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.card,
  },
  likeButton: {
    width: 68,
    height: 68,
    borderRadius: Radii.full,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.glow,
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.xl,
  },
  errorText: {
    fontSize: Typography.sizes.base,
    color: Colors.mutedForeground,
    marginBottom: Spacing.lg,
  },
  backBtnAlt: {
    paddingHorizontal: Layout.screenPadding,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: Radii.full,
  },
  backBtnText: {
    color: Colors.primaryForeground,
    fontWeight: Typography.weights.bold,
  },
  heroPlaceholder: {
    width,
    height: width * 1.33,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
});
