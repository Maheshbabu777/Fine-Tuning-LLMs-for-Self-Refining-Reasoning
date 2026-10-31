// Fake Kaggle router for working on the UI without a GPU: replays real outputs from experiments/08_eval_rp.
// Run: node scripts/mock-backend.mjs [port] [4b|2b]   e.g. "9000 4b" and "9001 2b" to copy the two-account setup.
// Then in .env.local: BACKEND_URL_A=http://localhost:9000, BACKEND_URL_B=http://localhost:9001, APP_API_KEY=dev-key
// Tests can change its behaviour with POST /__set {"offline": true, "key": "other", "delay": 40} and POST /__reset.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.argv[2] ?? 9000);
const ONLY = process.argv[3]; // "4b" or "2b", or nothing for all 8 models
const EVAL = path.resolve(import.meta.dirname, "../../../experiments/08_eval_rp");
const ALL = {
  "4b-base": "qwen4b_math500_baseline_rp1.1.json", "4b-cot": "eval_cot_4b_rp1.1.json", "4b-review": "eval_review_4b_rp1.1.json",
  "2b-base": "qwen2b_math500_baseline_rp1.1.json", "2b-cot": "eval_cot_rp1.1.json", "2b-refine": "eval_refine_rp1.1.json",
  "2b-review-9b": "eval_review_rp1.1.json", "2b-review-27b": "eval_review_27b_rp1.1.json",
};
const FILES = Object.fromEntries(Object.entries(ALL).filter(([k]) => !ONLY || k.startsWith(ONLY)));
const rows = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, JSON.parse(fs.readFileSync(path.join(EVAL, f), "utf8"))]));
const DEMO_INDEX = 67; // square-to-rectangle problem: base and CoT wrong, self-refine corrects itself

const DEFAULTS = { offline: false, key: "dev-key", delay: 8 };
let state = { ...DEFAULTS };
let generateCalls = 0;
let aborted = 0;

const server = http.createServer(async (req, res) => {
  if (req.url === "/__set" && req.method === "POST") { state = { ...state, ...JSON.parse(await read(req)) }; return json(res, 200, state); }
  if (req.url === "/__reset" && req.method === "POST") { state = { ...DEFAULTS }; generateCalls = 0; aborted = 0; return json(res, 200, state); }
  if (req.url === "/__stats") return json(res, 200, { generateCalls, aborted });
  if (state.offline) { res.writeHead(502, { "content-type": "text/html" }); return res.end("<html>ngrok: endpoint offline</html>"); }
  if (req.url === "/health") return json(res, 200, { ok: true, models: Object.keys(FILES) });
  if (req.url !== "/generate" || req.method !== "POST") return json(res, 404, { detail: "Not found" });
  if (req.headers.authorization !== `Bearer ${state.key}`) return json(res, 401, { detail: "Wrong or missing API key" });
  const body = JSON.parse(await read(req));
  generateCalls++;
  const row = rows[body.model]?.[DEMO_INDEX];
  if (!row) return json(res, 404, { detail: `Model ${body.model} is not loaded on the server` });

  const text = row.text ?? row.greedy_text;
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  let closed = false;
  res.on("close", () => { if (!res.writableEnded) { closed = true; aborted++; } });
  const start = Date.now();
  for (let i = 0; i < text.length && !closed; i += 6) {
    res.write(`data: ${JSON.stringify({ type: "token", text: text.slice(i, i + 6) })}\n\n`);
    await new Promise((r) => setTimeout(r, state.delay));
  }
  if (closed) return;
  const final = row.final_answer ?? row.greedy_pred ?? null;
  const ok = row.final_ok ?? row.greedy_ok;
  res.write(`data: ${JSON.stringify({
    type: "done", final_answer: final, first_answer: row.first_answer ?? null,
    corrected: !!row.first_answer && !row.first_ok && !!row.final_ok,
    correct: body.reference ? !!ok : null, finished: row.finished ?? true,
    fixed: body.reference ? !!row.first_answer && !row.first_ok && !!row.final_ok : null,
    tokens: row.n_tokens ?? Math.round(text.length / 3.5), latency_ms: Date.now() - start,
  })}\n\n`);
  res.end();
});

const read = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d)); });
const json = (res, code, data) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };

server.listen(PORT, () => console.log(`Mock backend on http://localhost:${PORT} (${ONLY ?? "all"} models, key: dev-key)`));
