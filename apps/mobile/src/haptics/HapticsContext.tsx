import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { setHapticsEnabled } from "../lib/haptics";

const STORAGE_KEY = "cybara.haptics.enabled";

interface HapticsContextValue {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

const HapticsContext = createContext<HapticsContextValue>({
  enabled: true,
  setEnabled: () => {},
});

export function HapticsProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(true);

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!mounted) return;
        const next = stored !== "false";
        setEnabledState(next);
        setHapticsEnabled(next);
      })
      .catch(() => {
        if (mounted) setHapticsEnabled(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    setHapticsEnabled(next);
    AsyncStorage.setItem(STORAGE_KEY, String(next)).catch(() => {});
  }, []);

  const value = useMemo(() => ({ enabled, setEnabled }), [enabled, setEnabled]);

  return <HapticsContext.Provider value={value}>{children}</HapticsContext.Provider>;
}

export function useHapticsControls(): HapticsContextValue {
  return useContext(HapticsContext);
}
