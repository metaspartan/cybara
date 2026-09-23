import { providerManager } from "../src/core/providers";
const p = providerManager.getWithCredentials("10b64063-8fdb-4c65-936f-b136157574f9")!;
const url = `${p.base_url!.replace(/\/+$/, "")}/chat/completions`;
const prompt = "A train leaves at 09:17 and travels 283 km at 74 km/h, then stops 11 minutes, then travels 152 km at 91 km/h. At what time (HH:MM, rounded to the nearest minute) does it arrive? Answer with just the time.";
const variants: Array<[string, Record<string, unknown>]> = [
  ["none sent", {}],
  ["effort low", { reasoning_effort: "low" }],
  ["effort medium", { reasoning_effort: "medium" }],
  ["effort high", { reasoning_effort: "high" }],
  ["enable_thinking only", { enable_thinking: true }],
  ["thinking disabled", { thinking: { type: "disabled" } }],
];
for (const [label, extra] of variants) {
  const samples: number[] = []; let answer = ""; let ms = 0;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.api_key}` }, body: JSON.stringify({ model: "glm-5.3-flash", messages: [{ role: "user", content: prompt }], ...extra }) });
    const d = await r.json() as any; ms += performance.now() - t;
    if (!r.ok) { answer = `HTTP ${r.status} ${JSON.stringify(d).slice(0, 80)}`; break; }
    samples.push(d.usage?.completion_tokens ?? -1); answer = (d.choices?.[0]?.message?.content ?? "").trim().slice(0, 12);
  }
  console.log(label.padEnd(22), "completion tokens:", samples.join("/").padEnd(16), "avg ms:", Math.round(ms / 3), "answer:", answer);
}
