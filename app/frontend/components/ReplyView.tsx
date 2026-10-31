"use client";

import { useState } from "react";
import { getModel } from "@/lib/models";
import { currentStep, extractBoxed, splitSections, streamSafe } from "@/lib/parse";
import type { Reply } from "@/lib/types";
import { MathAnswer, Markdown } from "./Markdown";

const KIND = { base: "Base model", cot: "Chain of thought", refine: "Rewrite ablation", review: "Self-refine" };

export function ReplyView({ reply }: { reply: Reply }) {
  const model = getModel(reply.model);
  const streaming = reply.status === "streaming";
  // While streaming, show only the part whose formulas and markers are complete (no raw LaTeX flashes).
  const text = streaming ? streamSafe(reply.text) : reply.text;
  const { preamble, sections } = splitSections(text);
  const selfRefining = model.kind === "review" || model.kind === "refine";
  const reasoning = sections.filter((s) => s.key !== "final");
  const finalSection = sections.find((s) => s.key === "final");
  const final = reply.finalAnswer ?? (model.kind === "base" ? (streaming ? null : extractBoxed(text)) : finalSection?.text) ?? null;
  const [open, setOpen] = useState<boolean | null>(null); // null = follow the streaming state
  const isOpen = open ?? streaming;
  const [copied, setCopied] = useState(false);
  const step = currentStep(text);

  return (
    <article className={`reply ${streaming ? "is-streaming" : ""}`} aria-busy={streaming}>
      <header className="reply-head">
        <span className="reply-name">{model.label}</span>
        <span className="reply-meta">{KIND[model.kind]} · {model.score}% on MATH-500</span>
      </header>

      {!text && streaming && (
        <div className="thinking"><span className="spinner" aria-hidden /> Thinking</div>
      )}

      {/* Self-refining models: attempts and review in a collapsible block, final answer below it. */}
      {selfRefining && reasoning.length > 0 && (
        <section className={`reasoning ${isOpen ? "open" : ""}`}>
          <button className="reasoning-toggle" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen}>
            <svg className="chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {streaming && !finalSection ? (
              <span key={step} className="step-label"><span className="spinner" aria-hidden /> {step}</span>
            ) : (
              <span className="step-label">Reasoning <span className="muted">· {reasoning.map((s) => s.label.toLowerCase()).join(", ")}</span></span>
            )}
          </button>
          <div className="reasoning-body" hidden={!isOpen}>
            {reasoning.map((s, i) => {
              const boxed = s.key !== "review" ? extractBoxed(s.text) : null;
              const writing = streaming && !finalSection && i === reasoning.length - 1;
              return (
                <div key={s.key} className="step">
                  <div className="step-head">
                    <span>{s.label}</span>
                    {boxed && <span className="step-answer"><MathAnswer answer={boxed} /></span>}
                  </div>
                  <Markdown text={s.text} caret={writing} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* CoT shows its single solution; base shows its whole text. */}
      {!selfRefining && text && (
        <Markdown text={model.kind === "base" ? text : reasoning.map((s) => s.text).join("\n\n") || preamble} caret={streaming && !finalSection} />
      )}
      {selfRefining && preamble && reasoning.length === 0 && <Markdown text={preamble} caret={streaming} />}

      {final && (
        <div className="final">
          <div className="final-label">Final answer</div>
          <div className="final-value"><MathAnswer answer={final} /></div>
          <div className="chips">
            {reply.fixed === true && <span className="chip">↻ Fixed its first answer</span>}
            {reply.fixed == null && reply.corrected && <span className="chip">↻ Changed its answer after review</span>}
            {reply.correct === true && <span className="chip chip-strong">✓ Correct</span>}
            {reply.correct === false && <span className="chip">✗ Wrong</span>}
          </div>
        </div>
      )}

      {reply.status === "error" && <div className="notice" role="alert">{reply.error}</div>}
      {reply.status === "stopped" && <div className="reply-foot">Stopped</div>}
      {reply.status === "done" && reply.finished === false && (
        <div className="reply-foot">The model hit the length limit before it finished.</div>
      )}

      {reply.status === "done" && (
        <div className="reply-foot">
          {reply.tokens !== undefined && <span>{reply.tokens.toLocaleString()} tokens</span>}
          {reply.latencyMs !== undefined && <span>{(reply.latencyMs / 1000).toFixed(1)} s</span>}
          <button
            className="text-button"
            onClick={() => {
              navigator.clipboard.writeText(reply.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </article>
  );
}
