import { Settings2, ShieldAlert, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LiquidGlass } from "../components/LiquidGlass";
import type { CybaraMobileApi, PendingToolApproval, ToolApprovalDecision } from "../lib/api";
import { colors, spacing } from "../theme/liquidGlass";
import { styles } from "./dashboardStyles";

export function ChatApprovalBanner({ api }: { api: CybaraMobileApi }) {
  const [approvals, setApprovals] = useState<PendingToolApproval[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const pending = await api.toolApprovals();
        if (active) setApprovals(pending);
      } catch (error) {
        void error;
      }
    };
    void poll();
    const interval = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [api]);

  const resolve = async (id: string, decision: ToolApprovalDecision) => {
    setApprovals((prev) => prev.filter((a) => a.id !== id));
    try {
      await api.resolveToolApproval(id, decision);
    } catch (error) {
      void error;
    }
  };

  if (approvals.length === 0) return null;

  return (
    <View style={styles.chatApprovalBanner}>
      {approvals.map((req) => {
        const expanded = expandedId === req.id;
        const hasDetail = req.argsSummary.trim().length > 0;
        return (
          <View key={req.id} style={styles.chatApprovalRow}>
            <View style={styles.chatApprovalLine}>
              <ShieldAlert color={colors.amber} size={16} strokeWidth={2.3} />
              <Pressable
                style={styles.chatApprovalSummary}
                onPress={() => hasDetail && setExpandedId(expanded ? null : req.id)}
              >
                <Text style={styles.chatApprovalTool}>{req.toolName}</Text>
                {hasDetail ? (
                  <Text numberOfLines={1} style={styles.chatApprovalArgs}>
                    {req.argsSummary}
                  </Text>
                ) : null}
              </Pressable>
              <View style={styles.chatApprovalButtons}>
                <Pressable
                  style={[styles.chatApprovalBtn, { backgroundColor: `${colors.green}22` }]}
                  onPress={() => void resolve(req.id, "approve_once")}
                >
                  <Text style={[styles.chatApprovalBtnText, { color: colors.green }]}>Once</Text>
                </Pressable>
                <Pressable
                  style={[styles.chatApprovalBtn, { backgroundColor: `${colors.blueText}22` }]}
                  onPress={() => void resolve(req.id, "approve_session")}
                >
                  <Text style={[styles.chatApprovalBtnText, { color: colors.blueText }]}>
                    Session
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.chatApprovalBtn, { backgroundColor: `${colors.red}22` }]}
                  onPress={() => void resolve(req.id, "deny")}
                >
                  <Text style={[styles.chatApprovalBtnText, { color: colors.red }]}>Deny</Text>
                </Pressable>
              </View>
            </View>
            {expanded && hasDetail ? (
              <Text style={styles.chatApprovalDetail}>{req.argsSummary}</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export type ChatSettingsAction = {
  destructive?: boolean;
  disabled?: boolean;
  icon: typeof Settings2;
  label: string;
  onPress: () => void;
};

export type ChatSettingsRow = {
  detail?: string | null;
  icon: typeof Settings2;
  label: string;
  value: string;
};

function ChatSettingsInfoRow({ row }: { row: ChatSettingsRow }) {
  const Icon = row.icon;
  return (
    <View style={styles.chatSettingsInfoRow}>
      <View style={styles.chatSettingsInfoIcon}>
        <Icon color={colors.textMuted} size={16} strokeWidth={2.2} />
      </View>
      <View style={styles.chatSettingsInfoText}>
        <Text style={styles.chatSettingsInfoLabel}>{row.label}</Text>
        <Text selectable style={styles.chatSettingsInfoValue}>
          {row.value}
        </Text>
        {row.detail ? (
          <Text selectable style={styles.chatSettingsInfoDetail}>
            {row.detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function ChatSettingsActionButton({ action }: { action: ChatSettingsAction }) {
  const Icon = action.icon;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={action.disabled}
      onPress={action.onPress}
      style={[
        styles.chatSettingsActionButton,
        action.destructive && styles.chatSettingsActionButtonDestructive,
        action.disabled && styles.chatSettingsActionButtonDisabled,
      ]}
    >
      <Icon color={action.destructive ? colors.red : colors.text} size={16} strokeWidth={2.3} />
      <Text
        style={[
          styles.chatSettingsActionText,
          action.destructive && styles.chatSettingsActionTextDestructive,
        ]}
      >
        {action.label}
      </Text>
    </Pressable>
  );
}

export function ChatSettingsSheet({
  actions,
  onClose,
  rows,
  subtitle,
  title,
  visible,
}: {
  actions: ChatSettingsAction[];
  onClose: () => void;
  rows: ChatSettingsRow[];
  subtitle: string;
  title: string;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [dragOffset, setDragOffset] = useState(0);
  const [expanded, setExpanded] = useState(true);
  const availableHeight = Math.max(420, windowHeight - insets.top - insets.bottom - spacing.lg);
  const expandedHeight = Math.min(availableHeight, Math.round(windowHeight * 0.84));
  const collapsedHeight = Math.min(expandedHeight, Math.max(360, Math.round(windowHeight * 0.58)));
  const sheetHeight = expanded ? expandedHeight : collapsedHeight;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dy) > 7 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.15,
        onPanResponderMove: (_event, gesture) => {
          const lowerBound = expanded ? 0 : -90;
          setDragOffset(Math.min(180, Math.max(lowerBound, gesture.dy)));
        },
        onPanResponderRelease: (_event, gesture) => {
          if (!expanded && (gesture.dy < -48 || gesture.vy < -0.7)) {
            setExpanded(true);
            setDragOffset(0);
            return;
          }
          if (expanded && gesture.dy > 76 && gesture.vy < 1.2) {
            setExpanded(false);
            setDragOffset(0);
            return;
          }
          if (gesture.dy > 118 || gesture.vy > 1.1) {
            setDragOffset(0);
            onClose();
            return;
          }
          setDragOffset(0);
        },
        onPanResponderTerminate: () => setDragOffset(0),
      }),
    [expanded, onClose]
  );

  useEffect(() => {
    if (visible) {
      setExpanded(true);
      setDragOffset(0);
    }
  }, [visible]);

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.chatSettingsOverlay}>
        <Pressable
          accessibilityRole="button"
          style={styles.chatSettingsBackdrop}
          onPress={onClose}
        />
        <View
          style={[
            styles.chatSettingsSheetFrame,
            {
              height: sheetHeight,
              marginBottom: Math.max(spacing.sm, insets.bottom + spacing.sm),
              transform: [{ translateY: dragOffset }],
            },
          ]}
        >
          <LiquidGlass
            intensity={76}
            contentStyle={styles.chatSettingsSheetContent}
            style={styles.chatSettingsSheet}
          >
            <View {...panResponder.panHandlers} style={styles.chatSettingsDragHandle}>
              <View style={styles.chatSettingsGrabber} />
              <View style={styles.chatSettingsHeader}>
                <View style={styles.chatSettingsTitleWrap}>
                  <Text numberOfLines={2} style={styles.chatSettingsTitle}>
                    {title}
                  </Text>
                  <Text numberOfLines={1} style={styles.chatSettingsSubtitle}>
                    {subtitle}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Close chat settings"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={onClose}
                  style={styles.chatSettingsCloseButton}
                >
                  <X color={colors.textMuted} size={18} strokeWidth={2.4} />
                </Pressable>
              </View>
            </View>
            <ScrollView
              contentContainerStyle={styles.chatSettingsScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.chatSettingsScroll}
            >
              <View style={styles.chatSettingsInfoGroup}>
                {rows.map((row) => (
                  <ChatSettingsInfoRow key={row.label} row={row} />
                ))}
              </View>
              <View style={styles.chatSettingsActionsGrid}>
                {actions.map((action) => (
                  <ChatSettingsActionButton key={action.label} action={action} />
                ))}
              </View>
            </ScrollView>
          </LiquidGlass>
        </View>
      </View>
    </Modal>
  );
}
