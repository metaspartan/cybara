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
  serializePetGameState,
} from "../../../shared/pet-game";
import { PET_SPRITE_PALETTE, petSpriteRows, petSpriteSize } from "../../../shared/pet-sprite";

const PET_GAME_STORAGE_KEY = "cybara.pet.game";
const TICK_MS = 15_000;
const BLINK_MS = 4_200;

function readStoredState(): PetGameState {
  try {
    return parsePetGameState(window.localStorage.getItem(PET_GAME_STORAGE_KEY));
  } catch {
    return parsePetGameState(null);
  }
}

function StatBar({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-9 shrink-0 text-[9px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </span>
      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-border)]">
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
          style={{ background: tone, width: `${value}%` }}
        />
      </span>
    </div>
  );
}

export function CybaraTamagotchi({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<PetGameState>(() => readStoredState());
  const [blink, setBlink] = useState(false);
  const [cue, setCue] = useState<string | null>(null);

  const mood = petMood(state);
  const level = petLevel(state);
  const stage = petStage(state);

  useEffect(() => {
    try {
      window.localStorage.setItem(PET_GAME_STORAGE_KEY, serializePetGameState(state));
    } catch {
      return;
    }
  }, [state]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setState((current) => decayPetGameState(current, Date.now()));
    }, TICK_MS);
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
    const scale = 5;
    if (canvas.width !== width * scale || canvas.height !== height * scale) {
      canvas.width = width * scale;
      canvas.height = height * scale;
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
        context.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }, [blink, mood, stage]);

  const care = useCallback((action: PetCareAction, message: string) => {
    setState((current) => applyPetCareAction(current, action));
    setCue(message);
    window.setTimeout(() => setCue(null), 1400);
  }, []);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-raised)] p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          {stage === "egg" || stage === "hatching" ? "Cybara · Egg" : `Cybara · Lv ${level}`}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
        >
          close
        </button>
      </div>

      <div className="relative flex items-center justify-center rounded-lg bg-[var(--surface-backdrop)] py-2">
        <canvas
          ref={canvasRef}
          aria-label="Pixel art Cybara"
          className="h-[120px] w-auto"
          role="img"
          style={{ imageRendering: "pixelated" }}
        />
        {cue ? (
          <span className="absolute right-2 top-1 rounded bg-[var(--surface-raised)] px-1.5 py-0.5 text-[10px] text-[var(--text-primary)]">
            {cue}
          </span>
        ) : null}
      </div>

      <span className="text-center text-[10px] text-[var(--text-muted)]">
        {stage === "egg"
          ? "An egg. Care for it to hatch."
          : stage === "hatching"
            ? "Something is stirring..."
            : petMoodLabel(mood)}
      </span>

      <div className="flex flex-col gap-1">
        <StatBar label="Food" value={state.hunger} tone="#F58220" />
        <StatBar label="Rest" value={state.energy} tone="#7CA9E8" />
        <StatBar label="Joy" value={state.joy} tone="#4CAF50" />
      </div>

      <div className="grid grid-cols-3 gap-1">
        <button
          type="button"
          onClick={() => care("feed", "yum")}
          className="rounded-lg border border-[var(--surface-border)] py-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        >
          Feed
        </button>
        <button
          type="button"
          onClick={() => care("play", "wheee")}
          className="rounded-lg border border-[var(--surface-border)] py-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        >
          Play
        </button>
        <button
          type="button"
          onClick={() => care("rest", "zzz")}
          className="rounded-lg border border-[var(--surface-border)] py-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
        >
          Rest
        </button>
      </div>
    </div>
  );
}
