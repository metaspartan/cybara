import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();
const voice = readFileSync(join(root, "ui", "src", "pages", "Voice.tsx"), "utf8");
const chat = readFileSync(join(root, "ui", "src", "pages", "Chat.tsx"), "utf8");
const app = readFileSync(join(root, "ui", "src", "App.tsx"), "utf8");

describe("voice UI wiring", () => {
  test("voice page records, transcribes, chats, and speaks responses", () => {
    expect(voice).toContain("navigator.mediaDevices.getUserMedia");
    expect(voice).toContain("chatApi.dictate");
    expect(voice).toContain("chatApi.send");
    expect(voice).toContain("chatApi.synthesizeSpeech");
    expect(voice).toContain("appendApiTokenParam");
  });

  test("voice page checks provider readiness and renders the reactive orb", () => {
    expect(voice).toContain("chatApi.getSpeechStatus");
    expect(voice).toContain("Voice setup");
    expect(voice).toContain("Voice output");
    expect(voice).toContain("Transcription");
    expect(voice).toContain("Microphone access");
    expect(voice).toContain("voice-orb");
    expect(voice).toContain("--orb-level");
    expect(voice).toContain("createAnalyser");
    expect(voice).toContain("Hands-free");
    expect(voice).toContain("nextVoiceActivityState");
    expect(voice).toContain('voiceModeRef.current === "hands-free"');
    const css = readFileSync(join(root, "ui", "src", "index.css"), "utf8");
    expect(css).toContain(".voice-orb-body");
    expect(css).toContain("voice-orb-breathe");
    expect(css).toContain("prefers-reduced-motion");
    expect(css).toContain("appearance: none");
    expect(css).toContain("background: transparent");
    expect(voice).toContain('radialGradient id="voice-orb-fill"');
    expect(voice).toContain('circle cx="96" cy="96" r="95"');
    expect(css).toContain("0 0 72px rgba(34, 211, 238, 0.2)");
    expect(css).toContain("display: none");
  });

  test("voice page is routed and assistant messages expose read aloud", () => {
    expect(app).toContain('path="/voice"');
    expect(chat).toContain("handleReadAloud");
    expect(chat).toContain('"Read aloud"');
    expect(chat).toContain('"Stop reading aloud"');
  });
});
