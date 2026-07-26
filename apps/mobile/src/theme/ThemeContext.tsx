import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { palettes, setActiveScheme, type ColorScheme, type Palette } from "./liquidGlass";

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "cybara.appearance";

interface ThemeContextValue {
  scheme: ColorScheme;
  colors: Palette;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  scheme: "dark",
  colors: palettes.dark,
  mode: "system",
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (mounted && (stored === "light" || stored === "dark" || stored === "system")) {
          setModeState(stored);
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  };

  const scheme: ColorScheme =
    mode === "system" ? (systemScheme === "light" ? "light" : "dark") : mode;

  const appliedScheme = useRef<ColorScheme | null>(null);
  if (appliedScheme.current !== scheme) {
    setActiveScheme(scheme);
    appliedScheme.current = scheme;
  }

  const value = useMemo<ThemeContextValue>(
    () => ({ scheme, colors: palettes[scheme], mode, setMode }),
    [scheme, mode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Palette {
  return useContext(ThemeContext).colors;
}

export function useThemeControls(): {
  scheme: ColorScheme;
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
} {
  const { scheme, mode, setMode } = useContext(ThemeContext);
  return { scheme, mode, setMode };
}
