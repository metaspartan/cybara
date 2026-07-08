import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Check, GitBranch, Plus, Search, X } from "lucide-react-native";
import type { GitBranchSummary } from "../lib/api";
import { colors } from "../theme/liquidGlass";

export function MobileBranchPicker({
  branches,
  currentBranch,
  error,
  loading,
  onCheckout,
  onClose,
  onCreate,
  visible,
}: {
  branches: GitBranchSummary[];
  currentBranch: string | null;
  error?: string | null;
  loading?: boolean;
  onCheckout: (branch: string) => void;
  onClose: () => void;
  onCreate: (branch: string) => void;
  visible: boolean;
}) {
  const [query, setQuery] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const filteredBranches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return branches;
    return branches.filter((branch) => branch.name.toLowerCase().includes(needle));
  }, [branches, query]);
  const canCreate =
    newBranch.trim().length > 0 && !branches.some((branch) => branch.name === newBranch.trim());

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(0, 0, 0, 0.48)",
          padding: 16,
        }}
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            maxHeight: "76%",
            borderRadius: 28,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            padding: 18,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <GitBranch color={colors.textMuted} size={18} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: "700" }}>
                Change branch
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                {currentBranch ? `Current: ${currentBranch}` : "No active branch"}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <X color={colors.textMuted} size={20} />
            </Pressable>
          </View>

          <View
            style={{
              marginTop: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surfaceLift,
              paddingHorizontal: 12,
              paddingVertical: 9,
            }}
          >
            <Search color={colors.textMuted} size={16} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search branches"
              placeholderTextColor={colors.textMuted}
              style={{ flex: 1, color: colors.text, fontSize: 15, padding: 0 }}
            />
          </View>

          {loading ? (
            <View style={{ alignItems: "center", paddingVertical: 24 }}>
              <ActivityIndicator />
            </View>
          ) : (
            <ScrollView style={{ marginTop: 12 }} keyboardShouldPersistTaps="handled">
              {filteredBranches.map((branch) => (
                <Pressable
                  key={branch.name}
                  onPress={() => onCheckout(branch.name)}
                  style={{
                    minHeight: 44,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    borderRadius: 14,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                  }}
                >
                  <GitBranch color={colors.textMuted} size={16} />
                  <Text
                    numberOfLines={1}
                    style={{ flex: 1, color: colors.text, fontSize: 14, fontWeight: "600" }}
                  >
                    {branch.name}
                  </Text>
                  {(branch.current || branch.name === currentBranch) && (
                    <Check color={colors.text} size={17} />
                  )}
                </Pressable>
              ))}
              {filteredBranches.length === 0 && (
                <Text style={{ color: colors.textMuted, paddingVertical: 18 }}>
                  No matching branches
                </Text>
              )}
            </ScrollView>
          )}

          <View
            style={{
              marginTop: 12,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingTop: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <TextInput
              value={newBranch}
              onChangeText={setNewBranch}
              autoCapitalize="none"
              placeholder="New branch name"
              placeholderTextColor={colors.textMuted}
              style={{
                flex: 1,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.border,
                color: colors.text,
                backgroundColor: colors.surfaceLift,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />
            <Pressable
              disabled={!canCreate}
              onPress={() => {
                const branch = newBranch.trim();
                if (!branch) return;
                setNewBranch("");
                onCreate(branch);
              }}
              style={{
                opacity: canCreate ? 1 : 0.45,
                borderRadius: 16,
                backgroundColor: colors.cyan,
                padding: 11,
              }}
            >
              <Plus color="#111" size={18} />
            </Pressable>
          </View>
          {error ? <Text style={{ marginTop: 8, color: colors.red }}>{error}</Text> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
