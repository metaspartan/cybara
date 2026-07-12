import * as Clipboard from "expo-clipboard";
import {
  CheckCircle2,
  ClipboardCopy,
  Database,
  FileJson,
  FlaskConical,
  Play,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type {
  CybaraMobileApi,
  MobileEvalGolden,
  MobileEvalRun,
  MobileResearchStats,
} from "../lib/api";
import { haptics } from "../lib/haptics";
import { useTheme } from "../theme/ThemeContext";
import { EmptyState, LoadingState } from "./dashboardPrimitives";

export function MobileEvalsPanel({
  accentColor,
  api,
}: {
  accentColor: string;
  api: CybaraMobileApi;
}) {
  const colors = useTheme();
  const [goldens, setGoldens] = useState<MobileEvalGolden[]>([]);
  const [runs, setRuns] = useState<MobileEvalRun[]>([]);
  const [researchStats, setResearchStats] = useState<MobileResearchStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const latestRuns = useMemo(() => {
    const values = new Map<string, MobileEvalRun>();
    for (const run of runs) if (!values.has(run.goldenId)) values.set(run.goldenId, run);
    return values;
  }, [runs]);

  const load = useCallback(async () => {
    try {
      const [response, research] = await Promise.all([api.evals(), api.researchTraces()]);
      setGoldens(response.goldens ?? []);
      setRuns(response.runs ?? []);
      setResearchStats(research.stats);
    } catch (error) {
      Alert.alert("Evals unavailable", error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const replay = async (golden: MobileEvalGolden) => {
    setBusyId(golden.id);
    try {
      const response = await api.replayEval(golden.id);
      if (!response.success) throw new Error(response.error || "Replay failed");
      haptics.success();
      await load();
    } catch (error) {
      Alert.alert("Replay failed", error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  };

  const remove = (golden: MobileEvalGolden) => {
    Alert.alert("Delete golden test?", golden.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setBusyId(golden.id);
          void api
            .deleteEval(golden.id)
            .then(load)
            .catch((error) =>
              Alert.alert("Delete failed", error instanceof Error ? error.message : String(error))
            )
            .finally(() => setBusyId(null));
        },
      },
    ]);
  };

  const copyJsonl = async () => {
    try {
      const exported = await api.exportEvals("jsonl", true);
      await Clipboard.setStringAsync(exported.content);
      Alert.alert(
        "Copied",
        `${exported.count} redacted ${exported.count === 1 ? "trajectory" : "trajectories"} copied as JSONL.`
      );
    } catch (error) {
      Alert.alert("Export failed", error instanceof Error ? error.message : String(error));
    }
  };

  const copyTrainingJsonl = async () => {
    try {
      const exported = await api.exportResearch("trl_sft");
      await Clipboard.setStringAsync(exported.content);
      Alert.alert(
        "Training data copied",
        `${exported.count} redacted ${exported.count === 1 ? "trace" : "traces"} copied as conversational JSONL.`
      );
    } catch (error) {
      Alert.alert("Export failed", error instanceof Error ? error.message : String(error));
    }
  };

  const copySuite = async () => {
    try {
      const exported = await api.exportEvals("bundle", false);
      await Clipboard.setStringAsync(exported.content);
      Alert.alert(
        "Suite backup copied",
        "This replayable backup may contain prompts, workspace paths, and tool output."
      );
    } catch (error) {
      Alert.alert("Export failed", error instanceof Error ? error.message : String(error));
    }
  };

  const importClipboard = async () => {
    try {
      const value = await Clipboard.getStringAsync();
      const response = await api.importEvals(JSON.parse(value) as unknown);
      if (!response.success) throw new Error(response.error || "Import failed");
      await load();
      Alert.alert(
        "Imported",
        `${response.count} golden test${response.count === 1 ? "" : "s"} added.`
      );
    } catch (error) {
      Alert.alert(
        "Import failed",
        error instanceof Error ? error.message : "Clipboard does not contain a suite backup."
      );
    }
  };

  if (loading) return <LoadingState label="Loading evals" />;

  return (
    <View style={styles.section}>
      <View style={styles.statsGrid}>
        <View
          style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Database color={accentColor} size={16} />
          <Text style={[styles.statValue, { color: colors.text }]}>
            {researchStats?.total ?? 0}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Traces</Text>
        </View>
        <View
          style={[styles.stat, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <FlaskConical color={accentColor} size={16} />
          <Text style={[styles.statValue, { color: colors.text }]}>
            {researchStats?.reasoningTraces ?? 0}
          </Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Reasoning</Text>
        </View>
      </View>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: colors.text }]}>Golden tests</Text>
          <Text style={[styles.detail, { color: colors.textDim }]}>
            Replay known-good chat turns after changing models, prompts, or tools.
          </Text>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityLabel="Copy conversational training JSONL"
            onPress={copyTrainingJsonl}
            style={[styles.iconButton, { backgroundColor: colors.inset }]}
          >
            <Database color={colors.textMuted} size={17} />
          </Pressable>
          <Pressable
            accessibilityLabel="Copy replayable eval suite"
            onPress={copySuite}
            style={[styles.iconButton, { backgroundColor: colors.inset }]}
          >
            <FileJson color={colors.textMuted} size={17} />
          </Pressable>
          <Pressable
            accessibilityLabel="Copy redacted eval JSONL"
            onPress={copyJsonl}
            style={[styles.iconButton, { backgroundColor: colors.inset }]}
          >
            <ClipboardCopy color={colors.textMuted} size={17} />
          </Pressable>
          <Pressable
            accessibilityLabel="Import eval suite from clipboard"
            onPress={importClipboard}
            style={[styles.iconButton, { backgroundColor: colors.inset }]}
          >
            <Upload color={colors.textMuted} size={17} />
          </Pressable>
        </View>
      </View>
      {goldens.length === 0 ? (
        <EmptyState
          label="No golden tests"
          detail="Save a completed assistant turn from chat to create one."
        />
      ) : (
        goldens.map((golden) => {
          const run = latestRuns.get(golden.id);
          const passing = run?.status === "passed";
          return (
            <View
              key={golden.id}
              style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
            >
              <View style={styles.row}>
                <FlaskConical color={accentColor} size={17} />
                <View style={styles.copy}>
                  <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
                    {golden.name}
                  </Text>
                  <Text numberOfLines={2} style={[styles.prompt, { color: colors.textDim }]}>
                    {golden.baseline.request.userMessage.content}
                  </Text>
                </View>
                {run ? (
                  passing ? (
                    <CheckCircle2 color={colors.green} size={17} />
                  ) : (
                    <XCircle color={colors.amber} size={17} />
                  )
                ) : null}
              </View>
              <View style={styles.footer}>
                <Text style={[styles.meta, { color: colors.textMuted }]}>
                  {golden.baseline.model || "Current model"} ·{" "}
                  {golden.baseline.structure.tools.length} tools
                  {run?.score !== null && run?.score !== undefined ? ` · ${run.score}%` : ""}
                </Text>
                <View style={styles.actions}>
                  <Pressable
                    accessibilityLabel={`Replay ${golden.name}`}
                    disabled={busyId !== null}
                    onPress={() => void replay(golden)}
                    style={[styles.iconButton, { backgroundColor: colors.inset }]}
                  >
                    {busyId === golden.id ? (
                      <ActivityIndicator color={accentColor} size="small" />
                    ) : (
                      <Play color={colors.textMuted} size={16} />
                    )}
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Delete ${golden.name}`}
                    disabled={busyId !== null}
                    onPress={() => remove(golden)}
                    style={[styles.iconButton, { backgroundColor: colors.inset }]}
                  >
                    <Trash2 color={colors.textMuted} size={16} />
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  statsGrid: { flexDirection: "row", gap: 8 },
  stat: {
    flex: 1,
    minHeight: 72,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 10,
  },
  statValue: { fontSize: 18, fontWeight: "700", marginTop: 5 },
  statLabel: { fontSize: 10, marginTop: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  headerCopy: { flex: 1 },
  title: { fontSize: 16, fontWeight: "700" },
  detail: { fontSize: 12, lineHeight: 18, marginTop: 3 },
  actions: { flexDirection: "row", alignItems: "center", gap: 6 },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 10 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  copy: { flex: 1, gap: 4 },
  name: { fontSize: 14, fontWeight: "600" },
  prompt: { fontSize: 12, lineHeight: 17 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  meta: { fontSize: 11, flex: 1 },
});
