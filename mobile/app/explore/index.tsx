import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Compass, Coffee, Mountain, BookOpen, Music, Camera } from "lucide-react-native";
import { Colors, Radii, Typography } from "../../src/constants/theme";
import { Header } from "../../src/components/ui/Header";

import { useMilo } from "../../src/context/MiloContext";

const TOPICS = [
  { id: "coffee", title: "Coffee & Chats", desc: "People who love cafe hopping", icon: Coffee, interests: ["Coffee", "Foodie"] },
  { id: "outdoor", title: "Weekend Trekkers", desc: "Hikes and monsoon getaways", icon: Mountain, interests: ["Hiking", "Travel", "Yoga"] },
  { id: "readers", title: "Book Lovers", desc: "Fiction, non-fiction and poetry", icon: BookOpen, interests: ["Books"] },
  { id: "music", title: "Concerts & Gigs", desc: "Indie, Bollywood and live music", icon: Music, interests: ["Music", "Bollywood"] },
  {
    id: "photo",
    title: "Photography & Art",
    desc: "Visual creators and gallery dates",
    icon: Camera,
    interests: ["Photography", "Art"],
  },
];

export default function ExploreScreen() {
  const router = useRouter();
  const { setFilters } = useMilo();

  const handleSelectTopic = (interests: string[]) => {
    setFilters((prev) => ({
      ...prev,
      interests,
    }));
    router.push("/(tabs)/discover");
  };

  return (
    <SafeAreaView style={styles.container}>
      <Header title="Explore Vibes" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>
          Browse people based on curated passions and shared interests.
        </Text>

        <View style={styles.grid}>
          {TOPICS.map((item) => {
            const Icon = item.icon;
            return (
              <TouchableOpacity
                key={item.id}
                style={styles.card}
                onPress={() => handleSelectTopic(item.interests)}
                activeOpacity={0.7}
              >
                <View style={styles.iconCircle}>
                  <Icon size={24} color={Colors.primary} />
                </View>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardDesc}>{item.desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  subtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    marginBottom: 20,
  },
  grid: {
    gap: 16,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: Radii.full,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  cardDesc: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    marginTop: 4,
  },
});
