import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Dimensions } from "react-native";
import { Alert } from "../../utils/alert";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Plus, X, Star, ArrowLeft, ArrowRight } from "lucide-react-native";
import { Colors, Radii, Typography } from "../../constants/theme";
import type { PhotoItem } from "../../types";

const { width } = Dimensions.get("window");
const ITEM_WIDTH = (width - 64) / 3;

interface PhotoUploaderProps {
  photos: PhotoItem[];
  onChange: (photos: PhotoItem[]) => void;
  maxPhotos?: number;
}

export const PhotoUploader: React.FC<PhotoUploaderProps> = ({
  photos,
  onChange,
  maxPhotos = 6,
}) => {
  const pickImage = async (index: number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission required",
        "Chahat needs photo permissions to upload profile pictures.",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [3, 4],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      const newPhoto: PhotoItem = {
        id: `photo_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        uri: result.assets[0].uri,
        status: "pending",
        isMain: index === 0,
      };

      const updated = [...photos];
      if (index < updated.length) {
        updated[index] = newPhoto;
      } else {
        updated.push(newPhoto);
      }
      onChange(updated);
    }
  };

  const removePhoto = (index: number) => {
    const updated = photos.filter((_, i) => i !== index);
    onChange(updated);
  };

  const movePhoto = (from: number, to: number) => {
    if (to < 0 || to >= photos.length) return;
    const updated = [...photos];
    const [moved] = updated.splice(from, 1);
    if (moved) {
      updated.splice(to, 0, moved);
      onChange(updated);
    }
  };

  const slots = Array.from({ length: maxPhotos }, (_, i) => photos[i] || null);

  return (
    <View style={styles.grid}>
      {slots.map((item, index) => (
        <View key={index} style={styles.slot}>
          {item ? (
            <View style={styles.photoContainer}>
              <Image source={{ uri: item.uri }} style={styles.image} contentFit="cover" />

              {/* Star badge for main photo */}
              {index === 0 && (
                <View style={styles.starBadge}>
                  <Star
                    size={12}
                    color={Colors.primaryForeground}
                    fill={Colors.primaryForeground}
                  />
                </View>
              )}

              {/* Status indicator */}
              <View
                style={[
                  styles.statusBadge,
                  item.status === "approved" ? styles.statusApproved : styles.statusPending,
                ]}
              >
                <Text style={styles.statusText}>
                  {item.status === "approved" ? "Live" : "Review"}
                </Text>
              </View>

              {/* Delete button */}
              <TouchableOpacity
                onPress={() => removePhoto(index)}
                style={styles.deleteButton}
                activeOpacity={0.8}
              >
                <X size={12} color={Colors.primaryForeground} />
              </TouchableOpacity>

              {/* Reorder controls */}
              <View style={styles.reorderRow}>
                {index > 0 && (
                  <TouchableOpacity
                    onPress={() => movePhoto(index, index - 1)}
                    style={styles.arrowButton}
                  >
                    <ArrowLeft size={10} color={Colors.primaryForeground} />
                  </TouchableOpacity>
                )}
                {index < photos.length - 1 && (
                  <TouchableOpacity
                    onPress={() => movePhoto(index, index + 1)}
                    style={styles.arrowButton}
                  >
                    <ArrowRight size={10} color={Colors.primaryForeground} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => pickImage(index)}
              style={styles.emptySlot}
              activeOpacity={0.7}
            >
              <Plus size={24} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginVertical: 12,
  },
  slot: {
    width: ITEM_WIDTH,
    height: ITEM_WIDTH * 1.33,
    borderRadius: Radii.lg,
    overflow: "hidden",
  },
  photoContainer: {
    width: "100%",
    height: "100%",
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
    borderRadius: Radii.lg,
  },
  emptySlot: {
    width: "100%",
    height: "100%",
    borderRadius: Radii.lg,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: "dashed",
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  starBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: Colors.primary,
    padding: 4,
    borderRadius: Radii.full,
  },
  statusBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusApproved: {
    backgroundColor: Colors.success,
  },
  statusPending: {
    backgroundColor: Colors.accent,
  },
  statusText: {
    fontSize: 9,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  deleteButton: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: Radii.full,
    backgroundColor: Colors.destructive,
    alignItems: "center",
    justifyContent: "center",
  },
  reorderRow: {
    position: "absolute",
    bottom: 6,
    right: 6,
    flexDirection: "row",
    gap: 2,
  },
  arrowButton: {
    backgroundColor: "rgba(35, 20, 30, 0.7)",
    padding: 3,
    borderRadius: 4,
  },
});
