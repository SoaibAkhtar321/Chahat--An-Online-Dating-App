import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ViewStyle,
} from "react-native";
import { Radii, Typography, ThemeColors } from "../../constants/theme";
import { useTheme } from "../../context/ThemeContext";
import { calculateAge, validateDob } from "../../utils/validation";

interface DatePickerProps {
  value: string; // "YYYY-MM-DD" or ""
  onChange: (dateString: string) => void;
  error?: string;
  containerStyle?: ViewStyle;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const DatePicker: React.FC<DatePickerProps> = ({
  value,
  onChange,
  error,
  containerStyle,
}) => {
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => createStyles(Colors), [Colors]);
  // Parse initial values if present
  const parsed = useMemo(() => {
    if (!value || value.length !== 10) return null;
    const parts = value.split("-");
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return { year: y, month: m, day: d };
  }, [value]);

  // Current year for age calculation
  const currentYear = new Date().getFullYear();
  const maxEligibleYear = currentYear - 18; // 18+ strictly
  const minEligibleYear = currentYear - 85;

  // Selected drill-down state
  const [selectedYear, setSelectedYear] = useState<number | null>(
    parsed ? parsed.year : null
  );
  const [selectedMonth, setSelectedMonth] = useState<number | null>(
    parsed ? parsed.month : null
  );
  const [selectedDay, setSelectedDay] = useState<number | null>(
    parsed ? parsed.day : null
  );

  // Active step: "year" | "month" | "day" | "confirmed"
  const [activeStep, setActiveStep] = useState<"year" | "month" | "day" | "confirmed">(
    value && parsed ? "confirmed" : "year"
  );

  // Generate eligible years list (from max eligible down to min)
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = maxEligibleYear; y >= minEligibleYear; y--) {
      list.push(y);
    }
    return list;
  }, [maxEligibleYear, minEligibleYear]);

  // Calculate days in selected month/year
  const daysInMonth = useMemo(() => {
    if (!selectedYear || !selectedMonth) return 31;
    return new Date(selectedYear, selectedMonth, 0).getDate();
  }, [selectedYear, selectedMonth]);

  const daysList = useMemo(() => {
    const list: number[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      list.push(d);
    }
    return list;
  }, [daysInMonth]);

  // Handle year click -> opens months
  const handleSelectYear = (yr: number) => {
    setSelectedYear(yr);
    setActiveStep("month");
  };

  // Handle month click -> opens days
  const handleSelectMonth = (moIndex: number) => {
    const moNum = moIndex + 1;
    setSelectedMonth(moNum);
    // If previously selected day exceeds new month's days, adjust
    if (selectedDay) {
      const maxD = new Date(selectedYear || maxEligibleYear, moNum, 0).getDate();
      if (selectedDay > maxD) {
        setSelectedDay(null);
      }
    }
    setActiveStep("day");
  };

  // Handle day click -> complete selection
  const handleSelectDay = (day: number) => {
    setSelectedDay(day);
    if (selectedYear && selectedMonth) {
      const formattedMonth = selectedMonth < 10 ? `0${selectedMonth}` : `${selectedMonth}`;
      const formattedDay = day < 10 ? `0${day}` : `${day}`;
      const formatted = `${selectedYear}-${formattedMonth}-${formattedDay}`;
      onChange(formatted);
      setActiveStep("confirmed");
    }
  };

  // Current age if value set
  const currentAge = value ? calculateAge(value) : 0;
  const validation = value ? validateDob(value) : { valid: false };

  return (
    <View style={[styles.container, containerStyle]}>
      {/* Top Breadcrumb Navigation */}
      <View style={styles.breadcrumbRow}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => setActiveStep("year")}
          style={[
            styles.breadcrumbChip,
            activeStep === "year" && styles.breadcrumbChipActive,
          ]}
        >
          <Text
            style={[
              styles.breadcrumbLabel,
              activeStep === "year" && styles.breadcrumbLabelActive,
            ]}
          >
            {selectedYear ? `Year: ${selectedYear}` : "1. Select Year"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          disabled={!selectedYear}
          onPress={() => setActiveStep("month")}
          style={[
            styles.breadcrumbChip,
            activeStep === "month" && styles.breadcrumbChipActive,
            !selectedYear && styles.breadcrumbChipDisabled,
          ]}
        >
          <Text
            style={[
              styles.breadcrumbLabel,
              activeStep === "month" && styles.breadcrumbLabelActive,
              !selectedYear && styles.breadcrumbLabelDisabled,
            ]}
          >
            {selectedMonth ? `Month: ${MONTH_SHORT[selectedMonth - 1]}` : "2. Month"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.7}
          disabled={!selectedYear || !selectedMonth}
          onPress={() => setActiveStep("day")}
          style={[
            styles.breadcrumbChip,
            activeStep === "day" && styles.breadcrumbChipActive,
            (!selectedYear || !selectedMonth) && styles.breadcrumbChipDisabled,
          ]}
        >
          <Text
            style={[
              styles.breadcrumbLabel,
              activeStep === "day" && styles.breadcrumbLabelActive,
              (!selectedYear || !selectedMonth) && styles.breadcrumbLabelDisabled,
            ]}
          >
            {selectedDay ? `Day: ${selectedDay}` : "3. Day"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main Selection Area */}
      <View style={styles.panelCard}>
        {/* Step 1: Select Year */}
        {activeStep === "year" && (
          <View style={styles.stepContainer}>
            <View style={styles.stepHeader}>
              <Text style={styles.stepTitle}>Select birth year</Text>
              <Text style={styles.stepHelp}>Must be 18 or older to join</Text>
            </View>
            <ScrollView
              style={styles.yearsScroll}
              showsVerticalScrollIndicator={true}
              contentContainerStyle={styles.yearsGrid}
            >
              {years.map((yr) => {
                const isSelected = selectedYear === yr;
                return (
                  <TouchableOpacity
                    key={yr}
                    activeOpacity={0.7}
                    onPress={() => handleSelectYear(yr)}
                    style={[
                      styles.yearButton,
                      isSelected && styles.yearButtonSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.yearButtonText,
                        isSelected && styles.yearButtonTextSelected,
                      ]}
                    >
                      {yr}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Step 2: Select Month */}
        {activeStep === "month" && (
          <View style={styles.stepContainer}>
            <View style={styles.stepHeader}>
              <View>
                <Text style={styles.stepTitle}>Select birth month</Text>
                <Text style={styles.stepHelp}>Year: {selectedYear}</Text>
              </View>
              <TouchableOpacity
                onPress={() => setActiveStep("year")}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>Change Year</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.monthsGrid}>
              {MONTH_NAMES.map((name, idx) => {
                const isSelected = selectedMonth === idx + 1;
                return (
                  <TouchableOpacity
                    key={name}
                    activeOpacity={0.7}
                    onPress={() => handleSelectMonth(idx)}
                    style={[
                      styles.monthButton,
                      isSelected && styles.monthButtonSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.monthButtonText,
                        isSelected && styles.monthButtonTextSelected,
                      ]}
                    >
                      {name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Step 3: Select Day */}
        {activeStep === "day" && (
          <View style={styles.stepContainer}>
            <View style={styles.stepHeader}>
              <View>
                <Text style={styles.stepTitle}>Select day</Text>
                <Text style={styles.stepHelp}>
                  {selectedMonth ? MONTH_NAMES[selectedMonth - 1] : ""} {selectedYear}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setActiveStep("month")}
                style={styles.backButton}
              >
                <Text style={styles.backButtonText}>Change Month</Text>
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.daysScroll}
              showsVerticalScrollIndicator={true}
              contentContainerStyle={styles.daysGrid}
            >
              {daysList.map((d) => {
                const isSelected = selectedDay === d;
                return (
                  <TouchableOpacity
                    key={d}
                    activeOpacity={0.7}
                    onPress={() => handleSelectDay(d)}
                    style={[
                      styles.dayButton,
                      isSelected && styles.dayButtonSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayButtonText,
                        isSelected && styles.dayButtonTextSelected,
                      ]}
                    >
                      {d}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Confirmed Selection Summary */}
        {activeStep === "confirmed" && value && (
          <View style={styles.confirmedContainer}>
            <View style={styles.confirmedContent}>
              <Text style={styles.confirmedLabel}>Date of Birth Selected</Text>
              <Text style={styles.confirmedDate}>
                {selectedMonth ? MONTH_NAMES[selectedMonth - 1] : ""}{" "}
                {selectedDay}, {selectedYear}
              </Text>
              {currentAge >= 18 ? (
                <View style={styles.ageBadge}>
                  <Text style={styles.ageBadgeText}>
                    {currentAge} years old (Eligible for Chahat)
                  </Text>
                </View>
              ) : (
                <View style={styles.ageBadgeInvalid}>
                  <Text style={styles.ageBadgeInvalidText}>
                    Under 18 ({currentAge} years old) - Chahat is strictly 18+
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setActiveStep("year")}
              style={styles.editButton}
            >
              <Text style={styles.editButtonText}>Change Date</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Error or Validation Feedback */}
      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : !validation.valid && value ? (
        <Text style={styles.errorText}>{validation.error}</Text>
      ) : null}
    </View>
  );
};

const createStyles = (Colors: ThemeColors) => StyleSheet.create({
  container: {
    width: "100%",
    marginVertical: 12,
  },
  breadcrumbRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  breadcrumbChip: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: Colors.card,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
  },
  breadcrumbChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.secondary,
  },
  breadcrumbChipDisabled: {
    opacity: 0.5,
  },
  breadcrumbLabel: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.medium,
    color: Colors.foreground,
  },
  breadcrumbLabelActive: {
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
  breadcrumbLabelDisabled: {
    color: Colors.mutedForeground,
  },
  panelCard: {
    backgroundColor: Colors.card,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    minHeight: 280,
  },
  stepContainer: {
    flex: 1,
  },
  stepHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  stepTitle: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
  },
  stepHelp: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    marginTop: 2,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radii.sm,
    backgroundColor: Colors.secondary,
  },
  backButtonText: {
    fontSize: Typography.sizes.xs,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  yearsScroll: {
    maxHeight: 210,
  },
  yearsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-start",
  },
  yearButton: {
    width: "23%",
    paddingVertical: 12,
    borderRadius: Radii.sm,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  yearButtonSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  yearButtonText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  yearButtonTextSelected: {
    color: Colors.primaryForeground,
  },
  monthsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  monthButton: {
    width: "31%",
    paddingVertical: 14,
    borderRadius: Radii.sm,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  monthButtonSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  monthButtonText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  monthButtonTextSelected: {
    color: Colors.primaryForeground,
  },
  daysScroll: {
    maxHeight: 210,
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  dayButton: {
    width: "12%",
    paddingVertical: 10,
    borderRadius: Radii.sm,
    backgroundColor: Colors.secondary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  dayButtonSelected: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dayButtonText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.foreground,
  },
  dayButtonTextSelected: {
    color: Colors.primaryForeground,
  },
  confirmedContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
    gap: 16,
  },
  confirmedContent: {
    alignItems: "center",
  },
  confirmedLabel: {
    fontSize: Typography.sizes.xs,
    color: Colors.mutedForeground,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: Typography.weights.semibold,
  },
  confirmedDate: {
    fontSize: Typography.sizes.xxl,
    fontWeight: Typography.weights.bold,
    color: Colors.foreground,
    marginVertical: 8,
  },
  ageBadge: {
    backgroundColor: "rgba(46, 158, 103, 0.12)",
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: Colors.success,
  },
  ageBadgeText: {
    color: Colors.success,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
  },
  ageBadgeInvalid: {
    backgroundColor: "rgba(214, 57, 46, 0.12)",
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: Colors.destructive,
  },
  ageBadgeInvalidText: {
    color: Colors.destructive,
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
  },
  editButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: Colors.secondary,
    borderRadius: Radii.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  editButtonText: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    color: Colors.primary,
  },
  errorText: {
    color: Colors.destructive,
    fontSize: Typography.sizes.xs,
    marginTop: 6,
    fontWeight: Typography.weights.medium,
  },
});
