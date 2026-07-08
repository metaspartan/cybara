import { useState, type ReactNode } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import SegmentedControl from "@react-native-segmented-control/segmented-control";
import { Check, ChevronDown } from "lucide-react-native";
import { haptics } from "../lib/haptics";
import { colors } from "../theme/liquidGlass";
import { styles } from "./dashboardStyles";
import type { IconGlyph } from "./dashboardPrimitives";

export function StableDetailPanel({
  children,
  edgeToEdge,
}: {
  children: ReactNode;
  edgeToEdge?: boolean;
}) {
  return (
    <View
      style={[
        styles.detailPanel,
        styles.mainTabPanel,
        styles.stableDetailPanel,
        edgeToEdge && styles.settingsRootContent,
      ]}
    >
      {children}
    </View>
  );
}

export function SettingsTextField({
  autoCapitalize = "none",
  editable = true,
  help,
  keyboardType,
  label,
  multiline,
  onBlur,
  onChangeText,
  onSubmitEditing,
  placeholder,
  returnKeyType,
  secureTextEntry,
  value,
}: {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  editable?: boolean;
  help?: string;
  keyboardType?: "default" | "numeric" | "decimal-pad" | "email-address" | "url";
  label: string;
  multiline?: boolean;
  onBlur?: () => void;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  placeholder?: string;
  returnKeyType?: "done" | "next" | "go" | "send";
  secureTextEntry?: boolean;
  value: string;
}) {
  return (
    <View style={styles.settingsField}>
      <Text style={styles.settingsFieldLabel}>{label}</Text>
      <TextInput
        autoCapitalize={autoCapitalize}
        editable={editable}
        keyboardType={keyboardType}
        multiline={multiline}
        onBlur={onBlur}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        returnKeyType={returnKeyType}
        secureTextEntry={secureTextEntry}
        style={[
          styles.settingsInput,
          multiline && styles.settingsTextArea,
          !editable && { opacity: 0.58 },
        ]}
        textAlignVertical={multiline ? "top" : "center"}
        value={value}
      />
      {help ? <Text style={styles.settingsFieldHelp}>{help}</Text> : null}
    </View>
  );
}

export function SettingSelector({
  disabled,
  label,
  options,
  selected,
  tone = colors.cyan,
  variant = "chips",
  onSelect,
}: {
  disabled?: boolean;
  label: string;
  options: Array<{ label: string; value: string }>;
  selected: string;
  tone?: string;
  variant?: "chips" | "segmented" | "menu";
  onSelect: (value: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  if (options.length === 0) return null;
  const segmented = variant === "segmented";

  if (variant === "menu") {
    const current = options.find((option) => option.value === selected);
    const openMenu = () => {
      if (disabled) return;
      haptics.select();
      if (Platform.OS === "ios") {
        const labels = options.map((option) => option.label);
        ActionSheetIOS.showActionSheetWithOptions(
          { title: label, options: [...labels, "Cancel"], cancelButtonIndex: labels.length },
          (index: number) => {
            const option = options[index];
            if (option) onSelect(option.value);
          }
        );
      } else {
        setMenuOpen(true);
      }
    };
    return (
      <>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${current?.label ?? "Select"}`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={openMenu}
          style={[styles.settingsMenuRow, disabled && styles.settingsActionButtonDisabled]}
        >
          <Text style={styles.settingsMenuLabel}>{label}</Text>
          <View style={styles.settingsMenuValueWrap}>
            <Text numberOfLines={1} style={styles.settingsMenuValue}>
              {current?.label ?? "Select"}
            </Text>
            <ChevronDown color={colors.textDim} size={16} strokeWidth={2.2} />
          </View>
        </Pressable>
        {Platform.OS !== "ios" ? (
          <Modal
            transparent
            visible={menuOpen}
            animationType="fade"
            onRequestClose={() => setMenuOpen(false)}
          >
            <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
              <View style={styles.menuSheet}>
                <Text style={styles.menuSheetTitle}>{label}</Text>
                {options.map((option) => {
                  const isSelected = option.value === selected;
                  return (
                    <Pressable
                      key={option.value}
                      style={styles.menuSheetRow}
                      onPress={() => {
                        haptics.select();
                        onSelect(option.value);
                        setMenuOpen(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.menuSheetRowText,
                          isSelected && { color: tone, fontWeight: "700" },
                        ]}
                      >
                        {option.label}
                      </Text>
                      {isSelected ? <Check color={tone} size={18} strokeWidth={2.4} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </Pressable>
          </Modal>
        ) : null}
      </>
    );
  }

  if (segmented) {
    const selectedIndex = Math.max(
      0,
      options.findIndex((option) => option.value === selected)
    );
    const segmentedAppearance = colors.background === "#000000" ? "dark" : "light";
    return (
      <View style={[styles.settingsField, styles.settingsSegmentField]}>
        <Text style={styles.settingsFieldLabel}>{label}</Text>
        <SegmentedControl
          appearance={segmentedAppearance}
          enabled={!disabled}
          values={options.map((option) => option.label)}
          selectedIndex={selectedIndex}
          onChange={(event) => {
            const index = event.nativeEvent.selectedSegmentIndex;
            const option = options[index];
            if (!option) return;
            haptics.select();
            onSelect(option.value);
          }}
          tintColor={tone}
          backgroundColor={colors.inset}
          fontStyle={{ color: colors.textMuted }}
          activeFontStyle={{ color: colors.background, fontWeight: "600" }}
        />
      </View>
    );
  }

  return (
    <View style={styles.settingsField}>
      <Text style={styles.settingsFieldLabel}>{label}</Text>
      <View style={styles.settingsChipRow}>
        {options.map((option) => {
          const isSelected = selected === option.value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${option.label}`}
              accessibilityState={{ disabled, selected: isSelected }}
              disabled={disabled}
              key={option.value}
              onPress={() => {
                haptics.select();
                onSelect(option.value);
              }}
              style={[
                styles.settingsChip,
                isSelected && [
                  styles.settingsChipActive,
                  { backgroundColor: `${tone}16`, borderColor: `${tone}88` },
                ],
                disabled && styles.settingsActionButtonDisabled,
              ]}
            >
              <Text
                numberOfLines={1}
                style={[styles.settingsChipText, isSelected && styles.settingsChipTextActive]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function SettingsTabRail({
  options,
  selected,
  tone = colors.cyan,
  onSelect,
}: {
  options: Array<{ label: string; value: string }>;
  selected: string;
  tone?: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.settingsCategoryRailWrap}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.settingsCategoryRail}
      >
        {options.map((option) => {
          const isSelected = option.value === selected;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: isSelected }}
              key={option.value}
              onPress={() => {
                haptics.select();
                onSelect(option.value);
              }}
              style={[
                styles.settingsCategoryChip,
                isSelected && [
                  styles.settingsCategoryChipActive,
                  { backgroundColor: `${tone}18`, borderColor: `${tone}88` },
                ],
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.settingsCategoryText,
                  isSelected && styles.settingsCategoryTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function DetailInfoSection({
  title,
  fields,
}: {
  title?: string;
  fields: Array<{ label: string; value: string }>;
}) {
  if (fields.length === 0) return null;
  return (
    <View style={styles.infoSection}>
      {title ? <Text style={styles.infoSectionTitle}>{title}</Text> : null}
      <View style={styles.infoCard}>
        {fields.map((field, index) => (
          <View
            key={`${field.label}-${index}`}
            style={[styles.infoRow, index > 0 && styles.infoRowDivider]}
          >
            <Text style={styles.infoLabel}>{field.label}</Text>
            <Text selectable style={styles.infoValue}>
              {field.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function DetailActionButton({
  Icon,
  busy,
  disabled,
  label,
  onPress,
  tone = colors.cyan,
}: {
  Icon: IconGlyph;
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  tone?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={[
        styles.settingsActionButton,
        { borderColor: `${tone}55`, backgroundColor: `${tone}12` },
        (disabled || busy) && styles.settingsActionButtonDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={tone} size="small" />
      ) : (
        <Icon color={tone} size={17} strokeWidth={2.3} />
      )}
      <Text style={[styles.settingsActionText, { color: tone }]}>{label}</Text>
    </Pressable>
  );
}

export function SettingToggle({
  busy,
  detail,
  disabled,
  label,
  onPress,
  tone = colors.cyan,
  value,
}: {
  busy?: boolean;
  detail?: string;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  tone?: string;
  value: boolean;
}) {
  const inactive = disabled || busy;
  const handleToggle = () => {
    haptics.light();
    onPress();
  };
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: inactive }}
      disabled={inactive}
      onPress={handleToggle}
      style={[styles.settingToggleRow, inactive && styles.settingToggleRowDisabled]}
    >
      <View style={styles.toggleTextWrap}>
        <Text style={styles.toggleTitle}>{label}</Text>
        {detail ? <Text style={styles.toggleDetail}>{detail}</Text> : null}
      </View>
      {busy ? (
        <ActivityIndicator color={value ? tone : colors.textMuted} size="small" />
      ) : (
        <View pointerEvents="none" style={styles.nativeSwitchWrap}>
          <Switch
            disabled={inactive}
            ios_backgroundColor="rgba(120, 132, 143, 0.28)"
            onValueChange={handleToggle}
            thumbColor={Platform.OS === "android" ? colors.text : undefined}
            trackColor={{
              false: "rgba(120, 132, 143, 0.28)",
              true: `${tone}92`,
            }}
            value={value}
          />
        </View>
      )}
    </Pressable>
  );
}

export function SettingsSection({
  accessory,
  children,
  title,
}: {
  accessory?: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  return (
    <View style={styles.settingsSection}>
      {title ? (
        <View style={styles.settingsSectionHeader}>
          <Text style={styles.settingsSectionTitle}>{title}</Text>
          {accessory}
        </View>
      ) : null}
      <View style={styles.settingsGroup}>{children}</View>
    </View>
  );
}
