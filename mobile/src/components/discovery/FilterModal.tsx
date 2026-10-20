import React, { useEffect, useMemo, useState } from "react";
import { Modal, View, Text, StyleSheet, ScrollView, TouchableOpacity } from "react-native";
import { X, Check } from "lucide-react-native";
import { Radii, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import type { Filters } from "../../types";
import { INTERESTS, LANGUAGES, DEFAULT_FILTERS, MAX_DISCOVERY_RADIUS_KM } from "../../types";
import { Chip } from "../ui/Chip";
import { Button } from "../ui/Button";
import { Slider, RangeSlider } from "../ui/Slider";
import { Alert } from "../../utils/alert";
import { hasUnsavedChanges } from "../../utils/navigation";

interface FilterModalProps {
  visible: boolean;
  filters: Filters;
  onClose: () => void;
  onApply: (newFilters: Filters) => void;
}

export const FilterModal: React.FC<FilterModalProps> = ({ visible, filters, onClose, onApply }) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const [localFilters, setLocalFilters] = useState<Filters>(filters);

  // Start from the applied filters every time the sheet opens, so discarded edits never linger.
  useEffect(() => {
    if (visible) setLocalFilters(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Used by the X button AND Android hardware/gesture back (Modal onRequestClose), so both behave alike.
  const requestClose = () => {
    if (!hasUnsavedChanges(filters, localFilters)) {
      onClose();
      return;
    }
    Alert.alert("Discard changes?", "Your filter changes haven't been applied.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
  };

  const toggleInterest = (interest: string) => {
    setLocalFilters((prev) => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter((i) => i !== interest)
        : [...prev.interests, interest],
    }));
  };

  const toggleLanguage = (lang: string) => {
    setLocalFilters((prev) => ({
      ...prev,
      languages: prev.languages.includes(lang)
        ? prev.languages.filter((l) => l !== lang)
        : [...prev.languages, lang],
    }));
  };

  const handleReset = () => {
    setLocalFilters(DEFAULT_FILTERS);
  };

  const handleApply = () => {
    onApply(localFilters);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={requestClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={requestClose}
            style={styles.closeButton}
            accessibilityLabel="Close filters"
            testID="filters-close"
          >
            <X size={24} color={Colors.foreground} />
          </TouchableOpacity>
          <Text style={styles.title}>Discovery Filters</Text>
          <TouchableOpacity onPress={handleReset}>
            <Text style={styles.resetText}>Reset</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Age range Slider */}
          <View style={styles.section}>
            <RangeSlider
              label="Age Range"
              minVal={localFilters.ageMin}
              maxVal={localFilters.ageMax}
              min={18}
              max={65}
              unit="years"
              onChange={(ageMin, ageMax) => {
                setLocalFilters((prev) => ({ ...prev, ageMin, ageMax }));
              }}
            />
          </View>

          {/* Distance Slider */}
          <View style={styles.section}>
            <Slider
              label="Maximum Distance"
              value={localFilters.distance}
              min={5}
              max={MAX_DISCOVERY_RADIUS_KM}
              step={5}
              unit="km"
              prefix="Up to "
              onChange={(distance) => {
                setLocalFilters((prev) => ({ ...prev, distance }));
              }}
            />
          </View>

          {/* Interests */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Shared Interests</Text>
            <View style={styles.pillWrap}>
              {INTERESTS.map((interest) => (
                <Chip
                  key={interest}
                  label={interest}
                  active={localFilters.interests.includes(interest)}
                  onPress={() => toggleInterest(interest)}
                />
              ))}
            </View>
          </View>

          {/* Languages */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Languages</Text>
            <View style={styles.pillWrap}>
              {LANGUAGES.slice(0, 10).map((lang) => (
                <Chip
                  key={lang}
                  label={lang}
                  active={localFilters.languages.includes(lang)}
                  onPress={() => toggleLanguage(lang)}
                />
              ))}
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button title="Apply Filters" onPress={handleApply} />
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeButton: {
    padding: 4,
  },
  title: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  resetText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginBottom: 4,
  },
  sectionValue: {
    fontSize: Typography.sizes.sm,
    color: Colors.mutedForeground,
    marginBottom: 12,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  pillWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.card,
  },
});
