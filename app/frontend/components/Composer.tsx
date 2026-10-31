"use client";

import { useEffect, useRef, useState } from "react";

type Props = { busy: boolean; disabled: boolean; onSend: (text: string) => void; onStop: () => void };

export function Composer({ busy, disabled, onSend, onStop }: Props) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [text]);

  const send = () => {
    if (!text.trim() || busy || disabled) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <div className="composer-wrap">
      <div className="composer">
        <textarea
          ref={ref}
          value={text}
          rows={1}
          placeholder="Ask a math question. Use $...$ for LaTeX."
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="Question"
        />
        {busy ? (
          <button className="send stop" onClick={onStop} aria-label="Stop generating">■</button>
        ) : (
          <button className="send" onClick={send} disabled={!text.trim() || disabled} aria-label="Send">↑</button>
        )}
      </div>
      <div className="composer-note">Each question is answered on its own; earlier messages are not sent to the model.</div>
    </div>
  );
}
