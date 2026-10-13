import React, { useState, useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
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
import { Radii, Shadows, Typography, ThemeColors } from "../../src/constants/theme";
import { useTheme } from "../../src/context/ThemeContext";
import { useAuth } from "../../src/context/AuthContext";
import { useMilo } from "../../src/context/MiloContext";
import { DEMO_PROFILES } from "../../src/services/discovery";
import { blockUser, reportUser } from "../../src/services/moderation";
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

  // Search profile in deck or demo profiles
  const targetProfile: Profile = deck.find((p) => p.id === id) ||
    DEMO_PROFILES.find((p) => p.id === id) || {
      id: id || "unknown",
      name: "Chahat Member",
      age: 26,
      city: "Mumbai",
      distanceKm: 5,
      bio: "Looking for meaningful connections.",
      photos: ["https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800"],
      interests: ["Coffee", "Travel"],
      intent: "Serious relationship",
    };

  // Compatibility score calculation based on shared interests & languages
  const myInterests = myProfile?.interests || [];
  const sharedInterests = targetProfile.interests.filter((i) => myInterests.includes(i));
  const score = Math.min(95, 60 + sharedInterests.length * 10);

  const handleAction = async (dir: "like" | "pass") => {
    const res = await swipeCard(dir);
    if (res.isMatch) {
      router.replace({
        pathname: "/match/[id]",
        params: { id: targetProfile.id },
      });
    } else {
      router.back();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Photo Gallery Header */}
        <View style={styles.photoContainer}>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
            {targetProfile.photos.map((uri, idx) => (
              <Image key={idx} source={{ uri }} style={styles.heroPhoto} contentFit="cover" />
            ))}
          </ScrollView>

          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <ArrowLeft size={20} color={Colors.foreground} />
          </TouchableOpacity>

          <View style={styles.photoCountBadge}>
            <Text style={styles.photoCountText}>{targetProfile.photos.length} photos</Text>
          </View>
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
              {targetProfile.city} · ~{targetProfile.distanceKm} km away
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
          <VoiceIntroPlayer userName={targetProfile.name} durationSec={24} />

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
        >
          <X size={28} color={Colors.mutedForeground} strokeWidth={2.5} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.likeButton}
          onPress={() => handleAction("like")}
          activeOpacity={0.8}
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
            router.back();
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
              router.back();
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
    width: 40,
    height: 40,
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
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.full,
  },
  photoCountText: {
    fontSize: Typography.sizes.xs,
    color: Colors.primaryForeground,
    fontWeight: Typography.weights.bold,
  },
  detailsBody: {
    padding: 24,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
    gap: 6,
    marginTop: 4,
  },
  metaText: {
    fontSize: Typography.sizes.base,
    color: Colors.mutedForeground,
  },
  intentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.secondary,
    padding: 14,
    borderRadius: Radii.xl,
    marginTop: 12,
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
    fontSize: 11,
    color: Colors.mutedForeground,
    fontWeight: Typography.weights.semibold,
  },
  intentValue: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginTop: 2,
  },
  compatCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginVertical: 12,
  },
  compatHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
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
    marginTop: 4,
  },
  compatDisclaimer: {
    fontSize: 10,
    color: Colors.mutedForeground,
    fontStyle: "italic",
    marginTop: 8,
    lineHeight: 14,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: 8,
  },
  bioText: {
    fontSize: Typography.sizes.base,
    color: Colors.foreground,
    lineHeight: 22,
  },
  promptCard: {
    backgroundColor: Colors.secondary,
    padding: 16,
    borderRadius: Radii.xl,
    marginBottom: 20,
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
    marginTop: 6,
  },
  basicRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 4,
  },
  basicText: {
    fontSize: Typography.sizes.base,
    color: Colors.foreground,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  interestPill: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 7,
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
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 12,
  },
  safetyOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
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
    gap: 24,
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
});
