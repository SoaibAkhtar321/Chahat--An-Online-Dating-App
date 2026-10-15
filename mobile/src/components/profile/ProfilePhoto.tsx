import React, { useState } from "react";
import { ActivityIndicator, ImageStyle, StyleProp, View, ViewStyle } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "../../context/ThemeContext";
import { AvatarPlaceholder } from "../ui/AvatarPlaceholder";
import { getPhotoDisplayState } from "../../services/profilePolicy";

interface ProfilePhotoProps {
  uri?: string | null;
  name: string;
  style: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  placeholderSize?: number;
  contentFit?: "cover" | "contain" | "fill" | "none" | "scale-down";
  onLoadError?: () => void;
}

export function ProfilePhoto({
  uri,
  name,
  style,
  imageStyle,
  placeholderSize = 72,
  contentFit = "cover",
  onLoadError,
}: ProfilePhotoProps) {
  const { colors } = useTheme();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const state = getPhotoDisplayState(uri, loadedUri, failedUri);
  const hasImage = state === "loading" || state === "loaded";

  return (
    <View
      style={style}
      accessible
      accessibilityRole="image"
      accessibilityLabel={
        state === "missing"
          ? "No profile photo"
          : state === "error"
            ? "Profile photo unavailable"
            : state === "loading"
              ? "Loading profile photo"
              : `${name}'s profile photo`
      }
    >
      {hasImage ? (
        <Image
          source={{ uri }}
          style={[{ width: "100%", height: "100%" }, imageStyle]}
          contentFit={contentFit}
          onLoadStart={() => setLoadedUri(null)}
          onLoad={() => setLoadedUri(uri ?? null)}
          onError={() => {
            setFailedUri(uri ?? null);
            onLoadError?.();
          }}
        />
      ) : null}
      {state === "missing" || state === "error" ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.secondary,
          }}
        >
          <AvatarPlaceholder name={name} size={placeholderSize} />
        </View>
      ) : null}
      {state === "loading" ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
    </View>
  );
}
