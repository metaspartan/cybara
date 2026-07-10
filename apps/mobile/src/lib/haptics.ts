import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { createHapticPolicy, type HapticEvent } from "./hapticPolicy";

const policy = createHapticPolicy();

function run(
  event: HapticEvent,
  iosAction: () => Promise<void>,
  androidType: Haptics.AndroidHaptics
): void {
  if (!policy.shouldRun(event)) return;
  const action =
    Platform.OS === "android" ? Haptics.performAndroidHapticsAsync(androidType) : iosAction();
  action.catch(() => {});
}

export function setHapticsEnabled(enabled: boolean): void {
  policy.setEnabled(enabled);
}

export const haptics = {
  select(): void {
    run("selection", Haptics.selectionAsync, Haptics.AndroidHaptics.Segment_Tick);
  },
  light(): void {
    run(
      "light",
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      Haptics.AndroidHaptics.Virtual_Key
    );
  },
  medium(): void {
    run(
      "medium",
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
      Haptics.AndroidHaptics.Context_Click
    );
  },
  success(): void {
    run(
      "success",
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      Haptics.AndroidHaptics.Confirm
    );
  },
  warning(): void {
    run(
      "warning",
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
      Haptics.AndroidHaptics.Reject
    );
  },
  agentStarted(): void {
    run(
      "agent_start",
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft),
      Haptics.AndroidHaptics.Gesture_Start
    );
  },
  agentProgress(): void {
    run(
      "agent_progress",
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      Haptics.AndroidHaptics.Segment_Frequent_Tick
    );
  },
  agentCompleted(): void {
    run(
      "agent_complete",
      () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
      Haptics.AndroidHaptics.Confirm
    );
  },
  messageSent(): void {
    run(
      "message_sent",
      () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
      Haptics.AndroidHaptics.Keyboard_Tap
    );
  },
};
