import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Compass, MapPin, Search } from "lucide-react-native";
import { Radii, Typography, ThemeColors, Spacing } from "../../constants/theme";
import { POPULAR_CITIES } from "../../constants/cities";
import { useTheme } from "../../context/ThemeContext";
import { Input } from "../ui/Input";
import { Chip } from "../ui/Chip";
import { ensureConsent } from "../../services/consent";
import {
  describeSelectionResult,
  loadLocationSelection,
  selectCityManually,
  selectCurrentLocation,
  type SelectionResult,
} from "../../services/locationSelection";
import {
  describeMode,
  describeSelection,
  searchCities,
  type LocationSelection,
} from "../../services/locationSelectionPolicy";

interface Props {
  /** Called with the authoritative server selection after load and after every successful change. */
  onSelectionChange?: (selection: LocationSelection | null) => void;
}

/**
 * The single "Your location" control used by onboarding and Settings. The server owns the state: this component
 * only renders it and asks for changes through selectCityManually / selectCurrentLocation, so the current-location
 * mode, a searched city and the popular-city shortcuts can never overwrite each other or leave a stale pair.
 */
export function LocationPicker({ onSelectionChange }: Props) {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  const [selection, setSelection] = useState<LocationSelection | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<"current" | "manual" | null>(null);
  const [message, setMessage] = useState("");
  const [needsSettings, setNeedsSettings] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const onChange = useRef(onSelectionChange);
  onChange.current = onSelectionChange;

  const refresh = useCallback(async () => {
    const next = await loadLocationSelection();
    if (!mounted.current) return;
    setSelection(next);
    setLoadState(next ? "ready" : "error");
    onChange.current?.(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const run = async (kind: "current" | "manual", action: () => Promise<SelectionResult>) => {
    if (busyRef.current) return; // one change at a time; ignores double taps
    busyRef.current = true;
    setBusy(kind);
    setMessage("");
    setNeedsSettings(false);
    try {
      const result = await action();
      if (!mounted.current) return;
      setMessage(describeSelectionResult(result));
      setNeedsSettings(result.status === "permission_denied" && !result.canAskAgain);
      if (result.status === "saved") {
        setQuery("");
        await refresh();
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  };

  const useCurrent = () =>
    run("current", async () => {
      if (!(await ensureConsent("location_discovery"))) return { status: "consent_required" };
      return selectCurrentLocation();
    });

  const chooseCity = (name: string) => run("manual", () => selectCityManually(name));

  const results = searchCities(query);
  const disabled = busy !== null;
  const current = selection?.city && selection.mode === "current";
  const manual = selection?.city && selection.mode === "manual";

  return (
    <View>
      <Text style={styles.title}>Your location</Text>
      <View style={styles.selectedRow} accessibilityLiveRegion="polite">
        <MapPin size={16} color={Colors.primary} style={{ marginRight: 6 }} />
        <Text style={styles.selectedText}>
          {loadState === "loading" ? "Loading…" : loadState === "error" ? "Couldn't load your location" : describeSelection(selection)}
        </Text>
      </View>
      {loadState === "ready" ? <Text style={styles.modeText}>{describeMode(selection)}</Text> : null}
      {loadState === "error" ? (
        <TouchableOpacity onPress={() => void refresh()} style={styles.linkBtn} accessibilityRole="button">
          <Text style={styles.linkText}>Try again</Text>
        </TouchableOpacity>
      ) : null}

      {/* Mode A: current location */}
      <View style={[styles.card, current ? styles.cardActive : null]}>
        <View style={styles.cardHead}>
          <Compass size={22} color={Colors.primary} />
          <Text style={styles.cardTitle}>Use my current location{current ? " (active)" : ""}</Text>
        </View>
        <Text style={styles.cardDesc}>
          We detect your approximate area and match it to a city. Your exact position is never shared.
        </Text>
        <TouchableOpacity
          style={[styles.primaryBtn, disabled && styles.btnDisabled]}
          onPress={() => void useCurrent()}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel="Use my current location"
        >
          {busy === "current" ? (
            <ActivityIndicator color={Colors.primaryForeground} />
          ) : (
            <Text style={styles.primaryBtnText}>{current ? "Refresh my location" : "Use my current location"}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Mode B: search / popular cities (both call chooseCity) */}
      <View style={[styles.card, manual ? styles.cardActive : null]}>
        <View style={styles.cardHead}>
          <Search size={22} color={Colors.primary} />
          <Text style={styles.cardTitle}>Search for your city{manual ? " (active)" : ""}</Text>
        </View>
        <Input
          placeholder="Type a city, e.g. Pune"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          containerStyle={{ marginBottom: 8 }}
          editable={!disabled}
        />
        {query.trim().length > 0 && results.length === 0 ? (
          <Text style={styles.cardDesc}>No supported city matches “{query.trim()}”.</Text>
        ) : null}
        {results.map((c) => (
          <TouchableOpacity
            key={c.name}
            style={styles.resultRow}
            onPress={() => void chooseCity(c.name)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Select ${c.name}`}
          >
            <MapPin size={16} color={Colors.mutedForeground} style={{ marginRight: 8 }} />
            <Text style={styles.resultText}>{c.name}</Text>
          </TouchableOpacity>
        ))}
        <Text style={styles.subheading}>Popular cities</Text>
        <View style={styles.chipWrap}>
          {POPULAR_CITIES.map((c) => (
            <Chip key={c} label={c} active={Boolean(manual) && selection?.city === c} onPress={() => void chooseCity(c)} />
          ))}
        </View>
      </View>

      {message ? (
        <View style={styles.messageBox} accessibilityLiveRegion="polite">
          <Text style={styles.messageText}>{message}</Text>
          {needsSettings ? (
            <TouchableOpacity onPress={() => void Linking.openSettings()} style={styles.linkBtn} accessibilityRole="button">
              <Text style={styles.linkText}>Open settings</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (Colors: ThemeColors) =>
  StyleSheet.create({
    title: { fontSize: Typography.sizes.xl, fontWeight: Typography.weights.bold, color: Colors.foreground, marginBottom: 8 },
    selectedRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
    selectedText: { fontSize: Typography.sizes.base, fontWeight: Typography.weights.bold, color: Colors.foreground },
    modeText: { fontSize: Typography.sizes.sm, color: Colors.mutedForeground, marginBottom: 12 },
    card: {
      backgroundColor: Colors.card,
      borderRadius: Radii.lg,
      borderWidth: 1,
      borderColor: Colors.border,
      padding: Spacing.lg,
      marginBottom: Spacing.md,
    },
    cardActive: { borderColor: Colors.primary, borderWidth: 2 },
    cardHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
    cardTitle: { fontSize: Typography.sizes.base, fontWeight: Typography.weights.bold, color: Colors.foreground, flexShrink: 1 },
    cardDesc: { fontSize: Typography.sizes.sm, color: Colors.mutedForeground, marginBottom: 10 },
    primaryBtn: {
      backgroundColor: Colors.primary,
      borderRadius: Radii.lg,
      paddingVertical: Spacing.md,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
    },
    primaryBtnText: { color: Colors.primaryForeground, fontWeight: Typography.weights.bold, fontSize: Typography.sizes.base },
    btnDisabled: { opacity: 0.6 },
    resultRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
    resultText: { fontSize: Typography.sizes.base, color: Colors.foreground },
    subheading: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.bold, color: Colors.mutedForeground, marginTop: 14, marginBottom: 8 },
    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    messageBox: { backgroundColor: Colors.secondary, borderRadius: Radii.lg, padding: 12 },
    messageText: { fontSize: Typography.sizes.sm, color: Colors.foreground },
    linkBtn: { paddingVertical: 8 },
    linkText: { color: Colors.primary, fontWeight: Typography.weights.bold },
  });
