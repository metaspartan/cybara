import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Bot, ChevronDown, ChevronRight, Plus, Square, Trash2, X } from "lucide-react-native";
import { LiquidGlass } from "../components/LiquidGlass";
import type { CybaraMobileApi, MobileSubagentSummary, MobileSubagentToolCall } from "../lib/api";
import { colors, spacing } from "../theme/liquidGlass";

function toolValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ["content", "output", "stdout"]) {
      if (typeof record[key] === "string" && record[key].trim()) return record[key];
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function MobileSubagentToolRow({ tool }: { tool: MobileSubagentToolCall }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={styles.toolCard}>
      <Pressable onPress={() => setExpanded((value) => !value)} style={styles.toolHeader}>
        {expanded ? (
          <ChevronDown color={colors.textMuted} size={14} />
        ) : (
          <ChevronRight color={colors.textMuted} size={14} />
        )}
        <Text numberOfLines={1} style={styles.toolName}>
          {tool.name}
        </Text>
        <Text style={styles.toolStatus}>{tool.status || "completed"}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.toolDetail}>
          {tool.args && Object.keys(tool.args).length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Arguments</Text>
              <Text selectable style={styles.codeText}>
                {toolValue(tool.args)}
              </Text>
            </>
          ) : null}
          <Text style={styles.sectionLabel}>Output</Text>
          <Text selectable style={styles.codeText}>
            {toolValue(tool.result)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function MobileSubagentsSheet({
  agentId,
  api,
  onClose,
  sessionId,
  visible,
  workspaceDir,
}: {
  agentId?: string | null;
  api: CybaraMobileApi;
  onClose: () => void;
  sessionId: string;
  visible: boolean;
  workspaceDir?: string | null;
}) {
  const [items, setItems] = useState<MobileSubagentSummary[]>([]);
  const [selected, setSelected] = useState<MobileSubagentSummary | null>(null);
  const [showSpawn, setShowSpawn] = useState(false);
  const [taskDraft, setTaskDraft] = useState("");
  const [mutating, setMutating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.subagents(sessionId);
      setItems(next);
      setSelected((current) =>
        current && !next.some((item) => item.id === current.id) ? null : current
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [api, sessionId]);

  useEffect(() => {
    if (!visible) return;
    setSelected(null);
    setShowSpawn(false);
    setTaskDraft("");
    void load();
    const timer = setInterval(() => void load(), 3_000);
    return () => clearInterval(timer);
  }, [load, sessionId, visible]);

  useEffect(() => {
    if (!visible || !selected || !["running", "pending"].includes(selected.status)) return;
    const timer = setInterval(() => {
      void api
        .subagent(selected.id)
        .then(setSelected)
        .catch(() => undefined);
    }, 2_000);
    return () => clearInterval(timer);
  }, [api, selected, visible]);

  const openDetail = async (item: MobileSubagentSummary) => {
    setSelected(item);
    try {
      setSelected(await api.subagent(item.id));
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : String(detailError));
    }
  };

  const confirmClear = () => {
    const completedCount = items.filter(
      (item) => item.status !== "running" && item.status !== "pending"
    ).length;
    if (completedCount === 0) return;
    Alert.alert(
      "Clear subagent history?",
      `Remove ${completedCount} completed ${completedCount === 1 ? "run" : "runs"} from this chat?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void api.clearSubagentHistory(sessionId).then(() => load());
          },
        },
      ]
    );
  };

  const spawn = async () => {
    const task = taskDraft.trim();
    if (!task || mutating) return;
    setMutating(true);
    setError(null);
    try {
      const result = await api.spawnSubagent({
        task,
        label: task.length > 42 ? `${task.slice(0, 39)}...` : task,
        agentId: agentId || undefined,
        workspaceDir: workspaceDir || undefined,
        requesterSessionId: sessionId,
      });
      if (!result.success) throw new Error(result.warning || "Subagent could not be started");
      setTaskDraft("");
      setShowSpawn(false);
      await load();
    } catch (spawnError) {
      setError(spawnError instanceof Error ? spawnError.message : String(spawnError));
    } finally {
      setMutating(false);
    }
  };

  const confirmClearSelected = () => {
    if (!selected || ["running", "pending"].includes(selected.status)) return;
    Alert.alert("Clear this subagent?", "Remove this completed run and its saved details?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          setMutating(true);
          void api
            .clearSubagent(selected.id)
            .then(async () => {
              setSelected(null);
              await load();
            })
            .catch((clearError: unknown) => {
              setError(clearError instanceof Error ? clearError.message : String(clearError));
            })
            .finally(() => setMutating(false));
        },
      },
    ]);
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={styles.shell}>
        <LiquidGlass
          contentStyle={styles.headerGlassContent}
          intensity={78}
          style={styles.headerGlass}
        >
          <View style={styles.header}>
            {selected || showSpawn ? (
              <Pressable
                onPress={() => {
                  setSelected(null);
                  setShowSpawn(false);
                }}
                style={styles.headerButton}
              >
                <ChevronDown color={colors.text} size={18} />
              </Pressable>
            ) : (
              <View style={styles.headerButton} />
            )}
            <View style={styles.headerTitleWrap}>
              <Text numberOfLines={1} style={styles.title}>
                {selected?.label || (showSpawn ? "New Subagent" : "Subagents")}
              </Text>
              <Text style={styles.subtitle}>Current chat only</Text>
            </View>
            {selected || showSpawn ? (
              <Pressable onPress={onClose} style={styles.headerButton}>
                <X color={colors.textMuted} size={19} />
              </Pressable>
            ) : (
              <Pressable onPress={() => setShowSpawn(true)} style={styles.headerButton}>
                <Plus color={colors.textMuted} size={19} />
              </Pressable>
            )}
          </View>
        </LiquidGlass>

        <ScrollView contentContainerStyle={styles.content}>
          {loading && items.length === 0 ? <ActivityIndicator color={colors.textMuted} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {showSpawn ? (
            <View style={styles.spawnCard}>
              <Text style={styles.spawnTitle}>Delegate a focused task</Text>
              <Text style={styles.spawnHint}>
                This worker inherits the current chat agent and workspace.
              </Text>
              <TextInput
                autoFocus
                multiline
                onChangeText={setTaskDraft}
                placeholder="Review a specific area and report findings..."
                placeholderTextColor={colors.textDim}
                style={styles.taskInput}
                textAlignVertical="top"
                value={taskDraft}
              />
              <Pressable
                disabled={!taskDraft.trim() || mutating}
                onPress={() => void spawn()}
                style={[styles.spawnButton, (!taskDraft.trim() || mutating) && styles.disabled]}
              >
                {mutating ? (
                  <ActivityIndicator color={colors.cyan} size="small" />
                ) : (
                  <Plus color={colors.cyan} size={15} />
                )}
                <Text style={styles.spawnButtonText}>Start subagent</Text>
              </Pressable>
            </View>
          ) : selected ? (
            <View style={styles.detailStack}>
              <View style={styles.summaryCard}>
                <View style={styles.statusRow}>
                  <Text style={styles.status}>{selected.status}</Text>
                  <Text style={styles.meta}>{selected.toolCallCount} tool calls</Text>
                </View>
                <Text selectable style={styles.task}>
                  {selected.task}
                </Text>
                {["running", "pending"].includes(selected.status) ? (
                  <Pressable
                    onPress={() => {
                      void api.stopSubagent(selected.id).then(async () => {
                        await load();
                        setSelected(await api.subagent(selected.id));
                      });
                    }}
                    style={styles.stopButton}
                  >
                    <Square color={colors.red} size={14} />
                    <Text style={styles.stopText}>Stop subagent</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    disabled={mutating}
                    onPress={confirmClearSelected}
                    style={styles.stopButton}
                  >
                    <Trash2 color={colors.red} size={14} />
                    <Text style={styles.stopText}>Clear this run</Text>
                  </Pressable>
                )}
              </View>
              {(selected.activities || []).length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Activity</Text>
                  {selected.activities?.map((activity) => (
                    <View key={activity.id} style={styles.activityRow}>
                      <View style={styles.activityDot} />
                      <View style={styles.activityTextWrap}>
                        <Text selectable style={styles.activityText}>
                          {activity.text}
                        </Text>
                        {activity.toolName && activity.toolName !== "__thought" ? (
                          <Text style={styles.activityMeta}>
                            {activity.toolName} · {activity.phase}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
              {selected.thinking ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Thinking</Text>
                  <Text selectable style={styles.bodyText}>
                    {selected.thinking}
                  </Text>
                </View>
              ) : null}
              {(selected.toolCalls || []).length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Tool calls</Text>
                  {selected.toolCalls?.map((tool, index) => (
                    <MobileSubagentToolRow key={tool.id || `${tool.name}-${index}`} tool={tool} />
                  ))}
                </View>
              ) : null}
              {selected.result || selected.error ? (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Final output</Text>
                  <Text selectable style={styles.bodyText}>
                    {selected.result || selected.error}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : items.length === 0 && !loading ? (
            <View style={styles.empty}>
              <Bot color={colors.textDim} size={30} />
              <Text style={styles.emptyTitle}>No subagents in this chat</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {items.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => void openDetail(item)}
                  style={styles.listRow}
                >
                  <View style={styles.listText}>
                    <Text numberOfLines={1} style={styles.listTitle}>
                      {item.label}
                    </Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      {item.toolCallCount} tools · {item.status}
                    </Text>
                  </View>
                  <ChevronRight color={colors.textDim} size={17} />
                </Pressable>
              ))}
              {items.some((item) => item.status !== "running" && item.status !== "pending") ? (
                <Pressable onPress={confirmClear} style={styles.clearButton}>
                  <Trash2 color={colors.red} size={16} />
                  <Text style={styles.clearText}>Clear completed history</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
  headerGlass: { margin: spacing.sm, marginBottom: 0 },
  headerGlassContent: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  header: { alignItems: "center", flexDirection: "row", minHeight: 48 },
  headerButton: { alignItems: "center", height: 36, justifyContent: "center", width: 36 },
  headerTitleWrap: { alignItems: "center", flex: 1 },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  subtitle: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  error: { color: colors.red, fontSize: 12, marginBottom: spacing.sm },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: 64 },
  emptyTitle: { color: colors.textMuted, fontSize: 14 },
  list: { gap: spacing.sm },
  listRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    padding: spacing.md,
  },
  listText: { flex: 1, minWidth: 0 },
  listTitle: { color: colors.text, fontSize: 14, fontWeight: "600" },
  meta: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  clearButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.md,
  },
  clearText: { color: colors.red, fontSize: 13, fontWeight: "600" },
  spawnCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    padding: spacing.md,
  },
  spawnTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  spawnHint: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  taskInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 132,
    padding: spacing.md,
  },
  spawnButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: colors.softCyan,
    borderColor: colors.softCyanBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  spawnButtonText: { color: colors.cyan, fontSize: 13, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  detailStack: { gap: spacing.md },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
  statusRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  status: { color: colors.textMuted, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  stopButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  stopText: { color: colors.red, fontSize: 12, fontWeight: "600" },
  task: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: spacing.sm },
  section: { gap: spacing.sm },
  sectionLabel: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  activityRow: { flexDirection: "row", gap: spacing.sm },
  activityDot: {
    backgroundColor: colors.textDim,
    borderRadius: 3,
    height: 6,
    marginTop: 6,
    width: 6,
  },
  activityTextWrap: { flex: 1 },
  activityText: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  activityMeta: { color: colors.textDim, fontSize: 10, marginTop: 2 },
  bodyText: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    padding: spacing.md,
  },
  toolCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  toolHeader: { alignItems: "center", flexDirection: "row", gap: spacing.xs, padding: spacing.sm },
  toolName: { color: colors.text, flex: 1, fontFamily: "monospace", fontSize: 12 },
  toolStatus: { color: colors.textDim, fontSize: 10 },
  toolDetail: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  codeText: {
    backgroundColor: colors.background,
    borderRadius: 8,
    color: colors.textMuted,
    fontFamily: "monospace",
    fontSize: 11,
    padding: spacing.sm,
  },
});
