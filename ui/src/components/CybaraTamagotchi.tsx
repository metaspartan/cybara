import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type PetCareAction,
  type PetGameState,
  applyPetCareAction,
  decayPetGameState,
  parsePetGameState,
  petLevel,
  petMood,
  petMoodLabel,
  petStage,
  resetPetGameState,
  serializePetGameState,
} from "../../../shared/pet-game";
import { PET_SPRITE_PALETTE, petSpriteRows, petSpriteSize } from "../../../shared/pet-sprite";

const PET_GAME_STORAGE_KEY = "cybara.pet.game";
const TICK_MS = 15_000;
const BLINK_MS = 4_200;
const SCREEN_SCALE = 4;

function readStoredState(): PetGameState {
  try {
    return parsePetGameState(window.localStorage.getItem(PET_GAME_STORAGE_KEY));
  } catch {
    return parsePetGameState(null);
  }
}

function StatPip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <span className="flex items-center gap-1" title={`${label} ${value}%`}>
      <span className="text-[8px] uppercase text-[var(--text-muted)]">{label}</span>
      <span className="h-1 w-7 overflow-hidden rounded-full bg-[var(--surface-border)]">
        <span
          className="block h-full rounded-full"
          style={{ background: tone, width: `${value}%` }}
        />
      </span>
    </span>
  );
}

export function CybaraTamagotchi({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<PetGameState>(() => readStoredState());
  const [blink, setBlink] = useState(false);
  const [cue, setCue] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const mood = petMood(state);
  const stage = petStage(state);
  const hatched = stage !== "egg" && stage !== "hatching";

  useEffect(() => {
    try {
      window.localStorage.setItem(PET_GAME_STORAGE_KEY, serializePetGameState(state));
    } catch {
      return;
    }
  }, [state]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setState((current) => decayPetGameState(current, Date.now())),
      TICK_MS
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBlink(true);
      window.setTimeout(() => setBlink(false), 160);
    }, BLINK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rows = petSpriteRows(stage, mood, blink);
    const { width, height } = petSpriteSize(rows);
    if (canvas.width !== width * SCREEN_SCALE || canvas.height !== height * SCREEN_SCALE) {
      canvas.width = width * SCREEN_SCALE;
      canvas.height = height * SCREEN_SCALE;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < rows.length; y += 1) {
      const row = rows[y] ?? "";
      for (let x = 0; x < row.length; x += 1) {
        const color = PET_SPRITE_PALETTE[row[x] ?? "."];
        if (!color) continue;
        context.fillStyle = color;
        context.fillRect(x * SCREEN_SCALE, y * SCREEN_SCALE, SCREEN_SCALE, SCREEN_SCALE);
      }
    }
  }, [blink, mood, stage]);

  const care = useCallback((action: PetCareAction, message: string) => {
    setState((current) => applyPetCareAction(current, action));
    setCue(message);
    window.setTimeout(() => setCue(null), 1200);
  }, []);

  const reset = useCallback(() => {
    setState(resetPetGameState());
    setMenuOpen(false);
    setCue("reset");
    window.setTimeout(() => setCue(null), 1200);
  }, []);

  const status = !hatched
    ? stage === "egg"
      ? "Care for the egg"
      : "Something stirs"
    : petMoodLabel(mood);

  return (
    <div className="relative mx-auto w-[164px] rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-raised)] p-2 shadow-sm">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[8px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
          {hatched ? `Lv ${petLevel(state)}` : "Egg"}
        </span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Pet options"
            onClick={() => setMenuOpen((value) => !value)}
            className="rounded p-0.5 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
          >
            <Settings2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label="Close pet game"
            onClick={onClose}
            className="rounded px-1 text-[10px] leading-none text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
          >
            ×
          </button>
        </span>
      </div>

      <div className="relative flex items-center justify-center rounded-lg border border-[var(--surface-border)] bg-[var(--surface-backdrop)] py-1">
        <canvas
          ref={canvasRef}
          aria-label="Pixel art Cybara"
          className="h-[64px] w-auto"
          role="img"
          style={{ imageRendering: "pixelated" }}
        />
        {cue ? (
          <span className="absolute right-1 top-0.5 rounded bg-[var(--surface-raised)] px-1 text-[8px] text-[var(--text-primary)]">
            {cue}
          </span>
        ) : null}
      </div>

      <div className="mt-1 flex items-center justify-between">
        <StatPip label="fd" value={state.hunger} tone="#F58220" />
        <StatPip label="rs" value={state.energy} tone="#7CA9E8" />
        <StatPip label="jy" value={state.joy} tone="#4CAF50" />
      </div>

      <div className="mt-1 text-center text-[8px] text-[var(--text-muted)]">{status}</div>

      <div className="mt-1 grid grid-cols-3 gap-1">
        {(
          [
            ["feed", "Feed", "yum"],
            ["play", "Play", "wheee"],
            ["rest", "Rest", "zzz"],
          ] as const
        ).map(([action, label, message]) => (
          <button
            key={action}
            type="button"
            onClick={() => care(action, message)}
            className="rounded-md border border-[var(--surface-border)] py-0.5 text-[9px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            {label}
          </button>
        ))}
      </div>

      {menuOpen ? (
        <div className="absolute right-2 top-7 z-10 rounded-lg border border-[var(--surface-border)] bg-[var(--surface-raised)] p-1 shadow-md">
          <button
            type="button"
            onClick={reset}
            className="block w-full rounded px-2 py-1 text-left text-[9px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            Start over
          </button>
        </div>
      ) : null}
    </div>
  );
}
