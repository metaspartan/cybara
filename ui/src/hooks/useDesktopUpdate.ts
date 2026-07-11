import { useSyncExternalStore } from "react";
import {
  checkForUpdate,
  getUpdateState,
  startUpdateInstall,
  subscribeUpdateState,
  type UpdatePhase,
  type UpdateState,
} from "@/lib/updateStore";

export type { UpdatePhase, UpdateState };

export function useDesktopUpdate() {
  const state = useSyncExternalStore(subscribeUpdateState, getUpdateState, getUpdateState);
  return {
    ...state,
    startUpdate: startUpdateInstall,
    check: checkForUpdate,
  };
}
