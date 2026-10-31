// Live end-to-end check of the real Kaggle servers (run after push.ps1, when status says online).
// For every model each server reports: asks one MATH-500 problem with a known answer, streams the answer,
// and checks the self-refining format, the final answer and the grade. Also checks the key is enforced.
// Run from the repo root:  node app/kaggle/live-check.mjs  [--site https://your-site.vercel.app]
import fs from "node:fs";
import path from "node:path";

const cfg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "accounts.local.json"), "utf8"));
const siteArg = process.argv.indexOf("--site");
const SITE = siteArg > 0 ? process.argv[siteArg + 1].replace(/\/$/, "") : null;
const H = { "ngrok-skip-browser-warning": "1" };
// MATH-500 test/prealgebra/1233.json: in the eval, base and CoT 4B got it wrong, self-refine 4B fixed its first attempt
const PROBLEM = "The lengths of two opposite sides of a square are decreased by $40\\%$ while the lengths of the other two sides are increased by $50\\%$ to form a rectangle. By what percent does the square's area decrease?";
const ANSWER = "10";

let failures = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) failures++; };

async function ask(url, headers, model) {
  const start = Date.now();
  const res = await fetch(url, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ model, question: PROBLEM, reference: ANSWER }) });
  if (!res.ok) return { status: res.status, body: await res.text() };
  let text = "", done = null, first = null, buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop();
    for (const p of parts) {
      if (!p.startsWith("data: ")) continue;
      const e = JSON.parse(p.slice(6));
      if (e.type === "token") { text += e.text; first ??= Date.now() - start; }
      else if (e.type === "done") done = e;
      else if (e.type === "error") done = { error: e.message };
    }
  }
  return { status: res.status, text, done, firstTokenMs: first, totalMs: Date.now() - start };
}

function report(model, r) {
  if (r.status !== 200) return check(false, `${model}: HTTP ${r.status} ${String(r.body).slice(0, 120)}`);
  if (!r.done || r.done.error) return check(false, `${model}: no done event ${r.done?.error ?? ""}`);
  const d = r.done;
  const speed = d.tokens / (d.latency_ms / 1000);
  console.log(`  ${model}: ${d.tokens} tokens in ${(d.latency_ms / 1000).toFixed(1)} s (${speed.toFixed(1)} tok/s), first text after ${(r.firstTokenMs / 1000).toFixed(1)} s, final answer ${JSON.stringify(d.final_answer)}`);
  const selfRefining = /review|refine/.test(model);
  if (selfRefining) {
    const markers = ["[Answer 1]", "[Answer 2]", model.includes("refine") ? "[Refined answer]" : "[Review]", "[Final answer]"];
    check(markers.every((m) => r.text.includes(m)), `${model}: writes ${markers.join(" ")}`);
  } else if (model.includes("cot")) {
    check(r.text.includes("[Final answer]"), `${model}: writes a [Final answer] line`);
  } else {
    check(/\\boxed\{/.test(r.text), `${model}: puts its answer in \\boxed{}`);
  }
  check(d.finished === true, `${model}: stopped by itself (not cut off at the length limit)`);
  check(d.final_answer !== null, `${model}: has a final answer`);
  console.log(`        graded ${d.correct ? "correct" : "wrong"}${d.fixed ? ", fixed its first answer" : ""} (MATH-500 eval: ${model.startsWith("4b-review") ? "correct" : "see README"})`);
}

for (const a of SITE ? [] : cfg.accounts) {
  const base = `https://${a.ngrok_domain}`;
  console.log(`\n=== Account ${a.shard} (${a.username}) ${base}`);
  let health;
  try {
    health = await (await fetch(`${base}/health`, { headers: H, signal: AbortSignal.timeout(10000) })).json();
  } catch {
    console.log("  offline, skipped");
    continue;
  }
  check(health.ok === true, `health: models ${health.models.join(", ")}`);
  const noKey = await fetch(`${base}/generate`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ model: health.models[0], question: "1+1" }) });
  check(noKey.status === 401, `request without the key is refused (${noKey.status})`);
  const results = await Promise.all(health.models.map((m) => ask(`${base}/generate`, { ...H, authorization: `Bearer ${cfg.app_api_key}` }, m).then((r) => [m, r])));
  for (const [m, r] of results) report(m, r);
}

if (SITE) {
  console.log(`\n=== Website ${SITE}`);
  const health = await (await fetch(`${SITE}/api/health`)).json();
  check(health.online === true, `site sees models: ${health.models.join(", ")}`);
  const r = await ask(`${SITE}/api/generate`, {}, health.models.includes("4b-review") ? "4b-review" : health.models[0]);
  report("site → " + (health.models.includes("4b-review") ? "4b-review" : health.models[0]), r);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
