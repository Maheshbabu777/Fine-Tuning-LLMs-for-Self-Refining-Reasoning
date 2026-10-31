"use client";

import { useEffect, useRef, useState } from "react";
import { COMPARE_MODELS, MODELS, getModel } from "@/lib/models";

type Props = { value: string[]; onChange: (models: string[]) => void; available: string[] | null };

const Check = () => (
  <svg className="check" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function ModelPicker({ value, onChange, available }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const compare = value.length > 1;

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const pick = (models: string[]) => {
    onChange(models);
    setOpen(false);
  };
  const off = (id: string) => available !== null && !available.includes(id);

  return (
    <div className="picker" ref={ref}>
      <button className="picker-button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-controls="model-menu">
        {compare ? "Compare 4B models" : getModel(value[0]).label}
        <svg className={`chev-down ${open ? "up" : ""}`} width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="menu-surface picker-menu" id="model-menu" role="menu">
          <button role="menuitemradio" aria-checked={compare} className="picker-item" onClick={() => pick(COMPARE_MODELS)} disabled={COMPARE_MODELS.some(off)}>
            <span className="picker-text">
              <span className="picker-title">Compare side by side</span>
              <span className="picker-sub">One question to Base, CoT and Self-refine 4B</span>
            </span>
            {compare && <Check />}
          </button>
          {(["4B", "2B"] as const).map((size) => (
            <div key={size} role="group" aria-label={`Qwen3.5-${size}`}>
              <div className="picker-group">Qwen3.5-{size}</div>
              {MODELS.filter((m) => m.size === size).map((m) => {
                const selected = !compare && value[0] === m.id;
                return (
                  <button
                    key={m.id}
                    role="menuitemradio"
                    aria-checked={selected}
                    className="picker-item"
                    onClick={() => pick([m.id])}
                    disabled={off(m.id)}
                    title={off(m.id) ? "Not loaded on the server right now" : undefined}
                  >
                    <span className="picker-text">
                      <span className="picker-title">{m.label}<span className="picker-score">{m.score}%</span></span>
                      <span className="picker-sub">{off(m.id) ? "Offline right now" : m.blurb}</span>
                    </span>
                    {selected && <Check />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
