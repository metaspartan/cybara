import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface SpeechWorkerReport {
  autoResolved: {
    type?: string;
    providerId?: string;
  };
  badProviderError: string;
  elevenlabs: {
    provider?: string;
    voice?: string;
    model?: string;
    audioPath: string;
    fileMode: number;
    url: string;
    apiKey?: string | null;
    body: Record<string, unknown>;
  };
  openai: {
    provider?: string;
    voice?: string;
    format?: string;
    url: string;
    authorization?: string | null;
    body: Record<string, unknown>;
    text?: string;
  };
}

const configPath = join(ROOT_DIR, "src", "core", "config.ts").replace(/\\/g, "/");
const providersPath = join(ROOT_DIR, "src", "core", "providers.ts").replace(/\\/g, "/");
const speechPath = join(ROOT_DIR, "src", "core", "speech.ts").replace(/\\/g, "/");

const WORKER_SOURCE = `
import { statSync } from "fs";
import { config } from "${configPath}";
import { providerManager } from "${providersPath}";
import { resolveSpeechTtsProvider, synthesizeSpeech } from "${speechPath}";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJsonBody(body) {
  return typeof body === "string" ? JSON.parse(body) : {};
}

const openaiProvider = providerManager.create({
  provider: "openai",
  name: "OpenAI",
  api_key: "sk-test",
  base_url: "https://api.openai.com/v1",
  is_default: true,
});
const elevenProvider = providerManager.create({
  provider: "elevenlabs",
  name: "ElevenLabs",
  api_key: "eleven-test",
  base_url: "https://api.elevenlabs.io/v1",
  is_default: false,
});

const autoResolved = resolveSpeechTtsProvider({});
assert(autoResolved?.type === "elevenlabs", "auto speech provider should prefer ElevenLabs");

const anthropicProvider = providerManager.create({
  provider: "anthropic",
  name: "Anthropic",
  api_key: "ant-test",
  is_default: false,
});
let badProviderError = "";
try {
  resolveSpeechTtsProvider({ providerId: anthropicProvider.id });
} catch (error) {
  badProviderError = error instanceof Error ? error.message : String(error);
}
assert(badProviderError.includes("ElevenLabs, OpenAI, or OpenAI Codex"), "expected unsupported provider error");

config.setSpeechSettings({
  tts: {
    provider: "auto",
    providerId: "",
    model: "eleven_flash_v2_5",
    voice: "voice-abc",
    outputFormat: "mp3",
    speed: 1.2,
    maxTextLength: 8000,
    fallbackToSystem: false,
  },
  stt: {
    provider: "auto",
    providerId: "",
    model: "",
    language: "",
  },
});

const elevenFetchCalls = [];
globalThis.fetch = (async (input, init) => {
  elevenFetchCalls.push({
    url: String(input),
    body: typeof init?.body === "string" ? init.body : undefined,
    headers: init?.headers || {},
  });
  return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
});

const elevenResult = await synthesizeSpeech({ text: "Hello Cybara" });
const elevenCall = elevenFetchCalls[0];
assert(elevenCall, "expected ElevenLabs fetch call");
const elevenHeaders = new Headers(elevenCall.headers);
const elevenStat = statSync(elevenResult.audioPath);

config.setSpeechSettings({
  tts: {
    provider: "openai",
    providerId: "",
    model: "gpt-4o-mini-tts",
    voice: "nova",
    outputFormat: "mp3",
    speed: 1,
    maxTextLength: 8000,
    fallbackToSystem: false,
  },
  stt: {
    provider: "openai",
    providerId: openaiProvider.id,
    model: "whisper-1",
    language: "en",
  },
});

const openaiFetchCalls = [];
globalThis.fetch = (async (input, init) => {
  openaiFetchCalls.push({
    url: String(input),
    body: typeof init?.body === "string" ? init.body : undefined,
    headers: init?.headers || {},
  });
  return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
});

const openaiResult = await synthesizeSpeech({
  text: "## Hello **OpenAI**\\n\\nUse [Cybara](https://example.com).",
  format: "wav",
});
const openaiCall = openaiFetchCalls[0];
assert(openaiCall, "expected OpenAI fetch call");
const openaiHeaders = new Headers(openaiCall.headers);

console.log("@@REPORT@@" + JSON.stringify({
  autoResolved: {
    type: autoResolved?.type,
    providerId: autoResolved?.provider.id,
  },
  badProviderError,
  elevenlabs: {
    provider: elevenResult.provider,
    voice: elevenResult.voice,
    model: elevenResult.model,
    audioPath: elevenResult.audioPath,
    fileMode: elevenStat.mode & 0o777,
    url: elevenCall.url,
    apiKey: elevenHeaders.get("xi-api-key"),
    body: parseJsonBody(elevenCall.body),
  },
  openai: {
    provider: openaiResult.provider,
    voice: openaiResult.voice,
    format: openaiResult.format,
    url: openaiCall.url,
    authorization: openaiHeaders.get("authorization"),
    body: parseJsonBody(openaiCall.body),
    text: openaiResult.text,
  },
}));
`;

let tempHome = "";
let report: SpeechWorkerReport;

beforeAll(() => {
  tempHome = mkdtempSync(join(tmpdir(), "cybara-speech-test-"));
  const workerPath = join(tempHome, "speech-worker.ts");
  writeFileSync(workerPath, WORKER_SOURCE, "utf8");

  const result = Bun.spawnSync([process.execPath, "run", workerPath], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      CYBARA_HOME: join(tempHome, ".cybara"),
      LOG_LEVEL: "error",
    },
  });
  const stdout = result.stdout.toString();
  if (result.exitCode !== 0) {
    throw new Error(`speech worker failed: ${result.stderr.toString()}\n${stdout}`);
  }
  const line = stdout.split("\n").find((entry) => entry.startsWith("@@REPORT@@"));
  if (!line) throw new Error(`no speech report in worker output:\n${stdout}`);
  report = JSON.parse(line.slice("@@REPORT@@".length)) as SpeechWorkerReport;
});

afterAll(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("speech TTS provider selection", () => {
  test("auto mode prefers configured ElevenLabs before OpenAI", () => {
    expect(report.autoResolved.type).toBe("elevenlabs");
    expect(typeof report.autoResolved.providerId).toBe("string");
  });

  test("explicit providerId must point at a speech-capable provider", () => {
    expect(report.badProviderError).toContain("ElevenLabs, OpenAI, or OpenAI Codex");
  });
});

describe("speech synthesis requests", () => {
  test("synthesizeSpeech builds ElevenLabs TTS requests and writes private audio", () => {
    expect(report.elevenlabs.provider).toBe("elevenlabs");
    expect(report.elevenlabs.voice).toBe("voice-abc");
    expect(report.elevenlabs.model).toBe("eleven_flash_v2_5");
    expect(report.elevenlabs.audioPath).toContain(join(tempHome, ".cybara", "media"));
    expect(report.elevenlabs.fileMode).toBe(0o600);
    expect(report.elevenlabs.url).toContain("/text-to-speech/voice-abc");
    expect(report.elevenlabs.apiKey).toBe("eleven-test");
    expect(report.elevenlabs.body.text).toBe("Hello Cybara");
    expect(report.elevenlabs.body.model_id).toBe("eleven_flash_v2_5");
    expect((report.elevenlabs.body.voice_settings as Record<string, unknown>).speed).toBe(1.2);
  });

  test("synthesizeSpeech builds OpenAI audio speech requests", () => {
    expect(report.openai.provider).toBe("openai");
    expect(report.openai.voice).toBe("nova");
    expect(report.openai.format).toBe("wav");
    expect(report.openai.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(report.openai.authorization).toBe("Bearer sk-test");
    expect(report.openai.body.input).toBe("Hello OpenAI\n\nUse Cybara.");
    expect(report.openai.text).toBe("Hello OpenAI\n\nUse Cybara.");
    expect(report.openai.body.model).toBe("gpt-4o-mini-tts");
    expect(report.openai.body.voice).toBe("nova");
    expect(report.openai.body.response_format).toBe("wav");
  });
});
