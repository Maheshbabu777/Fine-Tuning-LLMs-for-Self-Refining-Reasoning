// Splits a model output into its self-refining sections, same markers as notebooks 05 and 07.
const MARKERS = [
  { tag: "[Answer 1]", key: "attempt1", label: "Attempt 1" },
  { tag: "[Answer 2]", key: "attempt2", label: "Attempt 2" },
  { tag: "[Review]", key: "review", label: "Review" },
  { tag: "[Refined answer]", key: "refined", label: "Refined answer" },
  { tag: "[Final answer]", key: "final", label: "Final answer" },
] as const;

export type SectionKey = (typeof MARKERS)[number]["key"];
export type Section = { key: SectionKey; label: string; text: string };

export function splitSections(text: string): { preamble: string; sections: Section[] } {
  const found = MARKERS.map((m) => ({ ...m, at: text.indexOf(m.tag) }))
    .filter((m) => m.at !== -1)
    .sort((a, b) => a.at - b.at);
  const preamble = found.length ? text.slice(0, found[0].at) : text;
  const sections = found.map((m, i) => ({
    key: m.key,
    label: m.label,
    text: text.slice(m.at + m.tag.length, i + 1 < found.length ? found[i + 1].at : text.length).trim(),
  }));
  return { preamble: preamble.trim(), sections };
}

// Same as extract_boxed in the notebooks: content of the last \boxed{...}, or null.
export function extractBoxed(text: string): string | null {
  const start = text.lastIndexOf("\\boxed{");
  if (start === -1) return null;
  let i = start + "\\boxed{".length;
  let depth = 1;
  while (i < text.length && depth > 0) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    i++;
  }
  return depth === 0 ? text.slice(start + "\\boxed{".length, i - 1) : null;
}

// Label for the part being written right now, shown while streaming.
export function currentStep(text: string): string {
  const { sections } = splitSections(text);
  const last = sections[sections.length - 1];
  if (!last) return "Thinking";
  return { attempt1: "Writing attempt 1", attempt2: "Writing attempt 2", review: "Reviewing both attempts", refined: "Refining the answer", final: "Final answer" }[last.key];
}

// While streaming, the end of the text is often half-written: a formula without its closing \] or a marker like "[Answ".
// Those would flash as raw LaTeX, so we show the text only up to the last point where everything is complete.
// About 6% of real outputs never close a delimiter (a "$" used for money, a forgotten \]), so a formula that stays open
// past a section marker, a blank line (inline math only) or its length limit is treated as plain text instead of hiding the rest.
// Display blocks (\[ \], $$, align) can be long multi-line derivations, so they get a bigger limit than inline math.
const HOLD_INLINE = 400;
const HOLD_DISPLAY = 2000;
const holdLimit = (close: string) => (close === "$" || close === "\\)" ? HOLD_INLINE : HOLD_DISPLAY);

export function streamSafe(text: string): string {
  let i = 0;
  let open: { at: number; close: string } | null = null;
  while (i < text.length) {
    if (open) {
      if (text.startsWith(open.close, i)) {
        i += open.close.length;
        open = null;
      } else if ((holdLimit(open.close) === HOLD_INLINE && text.startsWith("\n\n", i)) || MARKERS.some((m) => text.startsWith(m.tag, i)) || i - open.at > holdLimit(open.close)) {
        i = open.at + 1; // never closed: give up on it and carry on after the opening character
        open = null;
      } else i += text[i] === "\\" && !text.startsWith(open.close, i) ? 2 : 1;
      continue;
    }
    const env = /^\\begin\{([a-z]+\*?)\}/.exec(text.slice(i, i + 24));
    if (text.startsWith("\\[", i)) open = { at: i, close: "\\]" };
    else if (text.startsWith("\\(", i)) open = { at: i, close: "\\)" };
    else if (text.startsWith("\\$", i)) { i += 2; continue; }
    else if (text.startsWith("$$", i)) open = { at: i, close: "$$" };
    else if (text[i] === "$") open = { at: i, close: "$" };
    else if (env) open = { at: i, close: `\\end{${env[1]}}` };
    else if (text.startsWith("\\boxed{", i)) {
      let depth = 0;
      let j = i + "\\boxed".length;
      for (; j < text.length; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}" && --depth === 0) break;
      }
      if (j >= text.length && text.length - i <= HOLD_INLINE) return trimPartialMarker(text.slice(0, i));
      i = j >= text.length ? i + 1 : j + 1;
      continue;
    }
    if (open) i += open.close === "$" ? 1 : open.close === "$$" ? 2 : env ? env[0].length : 2;
    else i++;
  }
  return trimPartialMarker(open && text.length - open.at <= holdLimit(open.close) ? text.slice(0, open.at) : text);
}

function trimPartialMarker(text: string): string {
  const m = /(\\|\[[A-Za-z ]{0,15}\d?)$/.exec(text);
  if (!m) return text;
  const partial = m[0];
  const isPrefix = partial === "\\" || MARKERS.some((mk) => mk.tag.startsWith(partial));
  return isPrefix ? text.slice(0, text.length - partial.length) : text;
}

// Reviews end with "the final answer is \boxed{10}." outside any math delimiters; wrap such a bare \boxed{...} in $...$.
function wrapBareBoxed(text: string): string {
  let out = "";
  let i = 0;
  let inMath: string | null = null; // "$" or "$$" while inside math
  while (i < text.length) {
    if (text.startsWith("\\$", i)) { out += "\\$"; i += 2; continue; }
    if (text.startsWith("$$", i)) { inMath = inMath === "$$" ? null : inMath ?? "$$"; out += "$$"; i += 2; continue; }
    if (text[i] === "\n" && inMath === "$") inMath = null; // inline math never spans lines here
    if (text[i] === "$" && !inMath) {
      const lineEnd = text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i);
      if (text.indexOf("$", i + 1) === -1 || text.indexOf("$", i + 1) > lineEnd) { out += "$"; i++; continue; } // a money sign, not math
    }
    if (text[i] === "$") { inMath = inMath === "$" ? null : inMath ?? "$"; out += "$"; i++; continue; }
    if (!inMath && text.startsWith("\\boxed{", i)) {
      let depth = 0;
      let j = i + "\\boxed".length;
      for (; j < text.length; j++) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}" && --depth === 0) break;
      }
      if (j < text.length) {
        out += `$${text.slice(i, j + 1)}$`;
        i = j + 1;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out;
}

// Models write \( \) and \[ \]; remark-math only understands $ and $$.
export function toMarkdownMath(text: string): string {
  return wrapBareBoxed(toDollars(text));
}

function toDollars(text: string): string {
  return text
    // MATH problems use bare \begin{align*}...\end{align*} outside any $...$
    .replace(/(?<!(?:\$|\\\[)\s*)\\begin\{(align\*?|aligned|equation\*?|gather\*?)\}([\s\S]*?)\\end\{\1\}/g, (m) => `\n$$\n${m}\n$$\n`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, m) => `$${m.trim()}$`);
}
