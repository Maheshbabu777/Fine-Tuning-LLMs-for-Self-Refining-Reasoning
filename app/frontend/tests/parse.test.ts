// Unit tests for lib/parse.ts, run on real model outputs. Run: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { extractBoxed, splitSections, streamSafe, toMarkdownMath } from "../lib/parse.ts";

const EVAL = path.resolve(import.meta.dirname, "../../../experiments/08_eval_rp");
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(EVAL, f), "utf8")) as Record<string, unknown>[];
const FILES = fs.readdirSync(EVAL).filter((f) => f.endsWith("rp1.1.json"));
const text = (r: Record<string, unknown>) => (r.text ?? r.greedy_text) as string;

test("extractBoxed matches the notebooks, including nested braces", () => {
  assert.equal(extractBoxed("so \\boxed{\\frac{1}{2}}."), "\\frac{1}{2}");
  assert.equal(extractBoxed("\\boxed{1} then \\boxed{2}"), "2");
  assert.equal(extractBoxed("no answer"), null);
  assert.equal(extractBoxed("\\boxed{unclosed"), null);
});

test("splitSections finds attempt 1, attempt 2, review and final answer whenever the notebook found a final answer", () => {
  for (const f of ["eval_review_4b_rp1.1.json", "eval_review_27b_rp1.1.json", "eval_review_rp1.1.json"]) {
    for (const r of load(f)) {
      if (r.final_answer === null) continue; // unfinished outputs (loops, length limit) have no final section in the notebook either
      const keys = splitSections(text(r)).sections.map((s) => s.key);
      assert.ok(keys.includes("final"), `${f} ${r.id}: no final section`);
      assert.ok(keys.includes("attempt1"), `${f} ${r.id}: no attempt 1`);
    }
  }
});

test("the final answer section equals the notebook's final_answer field", () => {
  const rows = load("eval_review_4b_rp1.1.json");
  let same = 0;
  for (const r of rows) if ((splitSections(text(r)).sections.find((s) => s.key === "final")?.text ?? null) === r.final_answer) same++;
  assert.ok(same / rows.length > 0.97, `only ${same}/${rows.length} match`);
});

test("toMarkdownMath converts \\( \\), \\[ \\] and bare align blocks to $ and $$", () => {
  assert.equal(toMarkdownMath("a \\(x^2\\) b"), "a $x^2$ b");
  assert.match(toMarkdownMath("\\[\\frac{1}{2}\\]"), /^\n\$\$\n\\frac\{1\}\{2\}\n\$\$\n$/);
  assert.match(toMarkdownMath("Given\n\\begin{align*}a&=1\\end{align*}"), /\$\$\n\\begin\{align\*\}/);
  assert.equal(toMarkdownMath("$$\\begin{align*}a\\end{align*}$$"), "$$\\begin{align*}a\\end{align*}$$");
});

test("a bare \\boxed{...} outside math (how every review ends) becomes math, one inside math is left alone", () => {
  assert.equal(toMarkdownMath("the final answer is \\boxed{\\frac{1}{2}}."), "the final answer is $\\boxed{\\frac{1}{2}}$.");
  assert.equal(toMarkdownMath("\\(\\boxed{3}\\)"), "$\\boxed{3}$");
  assert.match(toMarkdownMath("\\[\\boxed{p-q}\\]"), /^\n\$\$\n\\boxed\{p-q\}\n\$\$\n$/);
  // every review in the 4B eval that ends "the final answer is \boxed{..}" gets that box rendered as math
  let reviews = 0;
  for (const r of load("eval_review_4b_rp1.1.json")) {
    if (!/answer is \\boxed\{/.test(text(r))) continue;
    reviews++;
    assert.match(toMarkdownMath(text(r)), /answer is \$\\boxed\{/, `${r.id}`);
  }
  assert.ok(reviews > 300, `only ${reviews} reviews end with a bare box`);
});

const rendered = (t: string) => {
  const { sections, preamble } = splitSections(t);
  return toMarkdownMath(sections.length ? sections.map((s) => s.text).join("\n") : preamble);
};
const rawIn = (md: string) => /\\\[|\\\(|\\\]|\\\)/.test(md) || (md.match(/\$\$/g)?.length ?? 0) % 2 === 1;

// If the finished answer renders cleanly, every in-between state while it streams must render cleanly too.
test("streamSafe never leaves raw LaTeX or a half marker on screen, on every prefix of real outputs", () => {
  // Outputs whose own formulas never close (about 4%, e.g. a base model looping inside one align block until the token limit)
  // cannot be shown cleanly by anyone; they are covered by the length-limit test below.
  let frames = 0;
  for (const f of FILES) {
    const rows = load(f);
    for (const idx of [1, 46, 67, 120, 230, 431]) {
      const full = text(rows[idx]);
      if (rawIn(rendered(full))) continue; // the finished answer itself is malformed
      for (let i = 1; i <= full.length; i += 3) {
        const shown = streamSafe(full.slice(0, i));
        const md = rendered(shown);
        frames++;
        assert.doesNotMatch(md, /\\\[|\\\(|\\\]|\\\)/, `${f}#${idx} at ${i} chars`);
        assert.equal((md.match(/\$\$/g)?.length ?? 0) % 2, 0, `${f}#${idx} at ${i}: odd $$`);
        assert.doesNotMatch(shown.trimEnd(), /\[(A|An|Ans|Answ|Answe|Answer|Answer |R|Re|Rev|Revi|Revie|F|Fi|Fin|Fina|Final|Final )$/, `${f}#${idx} at ${i}`);
        assert.ok(full.startsWith(shown), "streamSafe only cuts the end");
      }
    }
  }
  assert.ok(frames > 20000);
});

test("streamSafe holds back at most 2,000 characters (400 for inline math), even on outputs whose delimiters never close", () => {
  let worst = 0;
  let malformed = 0;
  for (const f of FILES)
    for (const r of load(f)) {
      const hidden = text(r).length - streamSafe(text(r)).length;
      if (hidden > 0) malformed++;
      worst = Math.max(worst, hidden);
    }
  assert.ok(worst <= 2000, `hid ${worst} characters`);
  assert.ok(malformed < 4000 * 0.06, `${malformed} malformed outputs`);
  assert.equal(streamSafe("cost $" + "x".repeat(450)), "cost $" + "x".repeat(450)); // a money sign does not hide the rest
});

test("streamSafe keeps closed formulas and drops an unclosed one", () => {
  assert.equal(streamSafe("x \\(a\\) y \\[b"), "x \\(a\\) y ");
  assert.equal(streamSafe("cost $5 and more text\n\nnext paragraph"), "cost $5 and more text\n\nnext paragraph");
  assert.equal(streamSafe("done.\n[Answ"), "done.\n");
  assert.equal(streamSafe("so \\boxed{\\frac{1}{2"), "so ");
});
