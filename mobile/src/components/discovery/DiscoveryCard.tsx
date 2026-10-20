import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MapPin, Info, BadgeCheck, Sparkles, Volume2 } from "lucide-react-native";
import { Radii, Shadows, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { AvatarPlaceholder } from "../ui/AvatarPlaceholder";
import { ProfilePhoto } from "../profile/ProfilePhoto";
import type { Profile } from "../../types";
import { formatDistanceLabel } from "../../services/locationPolicy";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width - 32;
const CARD_HEIGHT = CARD_WIDTH * 1.35;

interface DiscoveryCardProps {
  profile: Profile;
  onPressDetails?: () => void;
}

export const DiscoveryCard: React.FC<DiscoveryCardProps> = ({ profile, onPressDetails }) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [failedPhotoKey, setFailedPhotoKey] = useState<string | null>(null);
  const photos = profile.photos && profile.photos.length > 0 ? profile.photos : [];
  const hasPhotos = photos.length > 0;
  const currentPhoto = hasPhotos ? photos[photoIndex] : undefined;

  const photoKey = currentPhoto ? `${profile.id}:${currentPhoto}` : "";
  const photoLoadFailed = !!photoKey && failedPhotoKey === photoKey;

  const nextPhoto = () => {
    if (photoIndex < photos.length - 1) {
      setPhotoIndex(photoIndex + 1);
    }
  };

  const prevPhoto = () => {
    if (photoIndex > 0) {
      setPhotoIndex(photoIndex - 1);
    }
  };

  // Dynamic compatibility estimate
  const interestCount = profile.interests?.length || 2;
  const compatScore = Math.min(96, Math.max(72, 70 + interestCount * 5));

  return (
    <View style={styles.card}>
      {hasPhotos && currentPhoto && !photoLoadFailed ? (
        <ProfilePhoto
          uri={currentPhoto}
          name={profile.name}
          style={styles.image}
          onLoadError={() => setFailedPhotoKey(photoKey)}
        />
      ) : (
        <View style={styles.placeholderContainer}>
          <AvatarPlaceholder name={profile.name} size={110} />
          <Text style={styles.noPhotoText}>
            {photoLoadFailed ? "Photo unavailable" : "No approved photo yet"}
          </Text>
        </View>
      )}

      {/* Tap zones for photo navigation */}
      {hasPhotos && (
        <View style={styles.tapContainer}>
          <Pressable style={styles.tapLeft} onPress={prevPhoto} />
          <Pressable style={styles.tapRight} onPress={nextPhoto} />
        </View>
      )}

      {/* Top Floating Badges */}
      <View style={styles.topBadgesRow}>
        <View style={styles.compatBadge}>
          <Sparkles size={13} color={Colors.accent} />
          <Text style={styles.compatBadgeText}>{compatScore}% Match</Text>
        </View>

        <View style={styles.dailyBadge}>
          <Text style={styles.dailyBadgeText}>Daily Pick</Text>
        </View>
      </View>

      {/* Photo indicator bars */}
      {photos.length > 1 && (
        <View style={styles.indicatorContainer}>
          {photos.map((_, i) => (
            <View
              key={i}
              style={[
                styles.indicatorBar,
                i === photoIndex ? styles.indicatorActive : styles.indicatorInactive,
              ]}
            />
          ))}
        </View>
      )}

      {/* Gradient vignette */}
      <LinearGradient
        colors={["transparent", "rgba(25, 12, 20, 0.4)", "rgba(25, 12, 20, 0.96)"]}
        style={styles.gradient}
      >
        <View style={styles.infoRow}>
          <View style={styles.textColumn}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>
                {profile.name}, {profile.age}
              </Text>
              {(profile.isVerified || profile.verificationStatus === "approved") && (
                <View style={styles.verifiedTag}>
                  <BadgeCheck size={18} color={Colors.accent} fill={Colors.accent} />
                </View>
              )}
            </View>

            <View style={styles.locationRow}>
              <MapPin size={13} color={Colors.primaryForeground} />
              <Text style={styles.locationText}>
                {[profile.city, formatDistanceLabel(profile.distanceKm, profile.distanceBasis)].filter(Boolean).join(" · ")}
              </Text>
            </View>

            <View style={styles.tagChipsRow}>
              {profile.intent ? (
                <View style={styles.intentBadge}>
                  <Text style={styles.intentText}>{profile.intent}</Text>
                </View>
              ) : null}

              <View style={styles.voiceBadge}>
                <Volume2 size={12} color={Colors.primaryForeground} />
                <Text style={styles.voiceBadgeText}>Voice Intro</Text>
              </View>
            </View>

            {profile.bio ? (
              <Text style={styles.bio} numberOfLines={2}>
                {profile.bio}
              </Text>
            ) : null}
          </View>

          {onPressDetails && (
            <TouchableOpacity
              onPress={onPressDetails}
              style={styles.infoButton}
              activeOpacity={0.8}
            >
              <Info size={22} color={Colors.primaryForeground} />
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>
    </View>
  );
};

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: Radii.xxl,
    overflow: "hidden",
    backgroundColor: Colors.card,
    position: "relative",
    ...Shadows.card,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  placeholderContainer: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.secondary,
    paddingBottom: 60,
  },
  noPhotoText: {
    marginTop: 12,
    fontSize: 12,
    color: Colors.mutedForeground,
    fontWeight: Typography.weights.medium,
  },
  tapContainer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    zIndex: 1,
  },
  tapLeft: {
    flex: 1,
  },
  tapRight: {
    flex: 1,
  },
  topBadgesRow: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 2,
  },
  compatBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(30, 20, 25, 0.75)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  compatBadgeText: {
    fontSize: 11,
    fontWeight: Typography.weights.bold,
    color: Colors.accent,
  },
  dailyBadge: {
    backgroundColor: "rgba(255, 107, 129, 0.9)",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radii.full,
  },
  dailyBadgeText: {
    fontSize: 10,
    fontWeight: Typography.weights.bold,
    color: Colors.primaryForeground,
    letterSpacing: 0.3,
  },
  indicatorContainer: {
    position: "absolute",
    top: 48,
    left: 16,
    right: 16,
    flexDirection: "row",
    gap: 4,
    zIndex: 2,
  },
  indicatorBar: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },
  indicatorActive: {
    backgroundColor: "#ffffff",
  },
  indicatorInactive: {
    backgroundColor: "rgba(255, 255, 255, 0.35)",
  },
  gradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 80,
    paddingBottom: 22,
    paddingHorizontal: 18,
    zIndex: 2,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  textColumn: {
    flex: 1,
    marginRight: 12,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  name: {
    fontSize: 24,
    fontWeight: Typography.weights.bold,
    fontFamily: Typography.fontDisplay,
    color: Colors.primaryForeground,
  },
  verifiedTag: {
    justifyContent: "center",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 4,
  },
  locationText: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.9)",
    fontWeight: Typography.weights.medium,
  },
  tagChipsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    marginBottom: 6,
  },
  intentBadge: {
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.full,
    alignSelf: "flex-start",
  },
  intentText: {
    fontSize: 11,
    color: Colors.primaryForeground,
    fontWeight: Typography.weights.semibold,
  },
  voiceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255, 107, 129, 0.35)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  voiceBadgeText: {
    fontSize: 10,
    color: Colors.primaryForeground,
    fontWeight: Typography.weights.semibold,
  },
  bio: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.85)",
    lineHeight: 18,
    marginTop: 4,
  },
  infoButton: {
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
});
