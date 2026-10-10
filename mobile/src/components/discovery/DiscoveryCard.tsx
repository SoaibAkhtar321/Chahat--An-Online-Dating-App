import React, { useState } from "react";
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, Pressable } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { MapPin, Info } from "lucide-react-native";
import { Colors, Radii, Shadows, Typography } from "../../constants/theme";
import type { Profile } from "../../types";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width - 32;
const CARD_HEIGHT = CARD_WIDTH * 1.35;

interface DiscoveryCardProps {
  profile: Profile;
  onPressDetails?: () => void;
}

export const DiscoveryCard: React.FC<DiscoveryCardProps> = ({ profile, onPressDetails }) => {
  const [photoIndex, setPhotoIndex] = useState(0);
  const photos = profile.photos && profile.photos.length > 0 ? profile.photos : [];
  const currentPhoto =
    photos[photoIndex] || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800";

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

  return (
    <View style={styles.card}>
      <Image
        source={{ uri: currentPhoto }}
        style={styles.image}
        contentFit="cover"
        transition={200}
      />

      {/* Tap zones for photo navigation */}
      <View style={styles.tapContainer}>
        <Pressable style={styles.tapLeft} onPress={prevPhoto} />
        <Pressable style={styles.tapRight} onPress={nextPhoto} />
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
        colors={["transparent", "rgba(35, 20, 30, 0.3)", "rgba(35, 20, 30, 0.95)"]}
        style={styles.gradient}
      >
        <View style={styles.infoRow}>
          <View style={styles.textColumn}>
            <Text style={styles.name}>
              {profile.name}, {profile.age}
            </Text>
            <View style={styles.locationRow}>
              <MapPin size={14} color={Colors.primaryForeground} />
              <Text style={styles.locationText}>
                {profile.city} · ~{profile.distanceKm} km away
              </Text>
            </View>
            {profile.intent ? (
              <View style={styles.intentBadge}>
                <Text style={styles.intentText}>{profile.intent}</Text>
              </View>
            ) : null}
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

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: Radii.xxl,
    overflow: "hidden",
    backgroundColor: Colors.card,
    ...Shadows.card,
  },
  image: {
    width: "100%",
    height: "100%",
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
  indicatorContainer: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
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
    backgroundColor: Colors.primaryForeground,
  },
  indicatorInactive: {
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },
  gradient: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "55%",
    justifyContent: "flex-end",
    padding: 20,
    zIndex: 2,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  textColumn: {
    flex: 1,
    paddingRight: 12,
  },
  name: {
    fontSize: Typography.sizes.xxl,
    fontWeight: Typography.weights.bold,
    color: Colors.primaryForeground,
    fontFamily: Typography.fontDisplay,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  locationText: {
    fontSize: Typography.sizes.sm,
    color: Colors.primaryForeground,
    opacity: 0.9,
  },
  intentBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(200, 70, 48, 0.8)",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radii.full,
    marginTop: 8,
  },
  intentText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.bold,
    color: Colors.primaryForeground,
  },
  bio: {
    fontSize: Typography.sizes.sm,
    color: Colors.primaryForeground,
    opacity: 0.9,
    marginTop: 8,
    lineHeight: 18,
  },
  infoButton: {
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    backgroundColor: "rgba(35, 20, 30, 0.5)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
});
