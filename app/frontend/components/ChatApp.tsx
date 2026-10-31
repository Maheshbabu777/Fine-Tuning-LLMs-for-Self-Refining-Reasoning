"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import examples from "@/lib/examples.json";
import { DEFAULT_MODELS, getModel } from "@/lib/models";
import { loadChats, newId, saveChats } from "@/lib/store";
import { streamGenerate } from "@/lib/stream";
import type { Chat, Reply, Turn } from "@/lib/types";
import { Composer } from "./Composer";
import { Markdown } from "./Markdown";
import { ModelPicker } from "./ModelPicker";
import { ReplyView } from "./ReplyView";
import { Sidebar } from "./Sidebar";

type Health = { online: boolean; models: string[] } | null;

function makeTurn(question: string, reference: string | undefined, models: string[]): Turn {
  return {
    id: newId(),
    question,
    reference,
    createdAt: Date.now(),
    replies: models.map((m) => ({ model: m, text: "", status: "streaming" })),
  };
}

export function ChatApp() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftModels, setDraftModels] = useState<string[]>(DEFAULT_MODELS); // models for a chat not started yet
  const [health, setHealth] = useState<Health>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const controllers = useRef(new Map<string, AbortController>()); // turn id -> controller
  const thread = useRef<HTMLDivElement>(null);
  const follow = useRef(true); // keep the newest text in view until the user scrolls up to read
  const [atBottom, setAtBottom] = useState(true);

  const active = chats.find((c) => c.id === activeId) ?? null;
  const models = active?.models ?? draftModels;
  const busy = !!active?.turns.some((t) => t.replies.some((r) => r.status === "streaming"));

  useEffect(() => {
    // localStorage only exists in the browser, so history is loaded after the first render
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChats(loadChats());
    setLoaded(true);
  }, []);

  // Save when nothing is streaming, so we don't write to storage on every token.
  useEffect(() => {
    if (loaded && !chats.some((c) => c.turns.some((t) => t.replies.some((r) => r.status === "streaming")))) saveChats(chats);
  }, [chats, loaded]);

  useEffect(() => {
    const check = () =>
      fetch("/api/health")
        .then((r) => r.json())
        .then(setHealth)
        .catch(() => setHealth({ online: false, models: [] }));
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  // Follow the answer as it streams in.
  useEffect(() => {
    const el = thread.current;
    if (!el) return;
    if (!activeId) el.scrollTop = 0; // the start screen opens at the top
    else if (follow.current) el.scrollTop = el.scrollHeight;
  }, [chats, activeId]);

  const onScroll = () => {
    const el = thread.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    follow.current = near;
    setAtBottom(near);
  };

  const jumpToLatest = () => {
    follow.current = true;
    setAtBottom(true);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  };

  const updateReply = useCallback((chatId: string, turnId: string, model: string, patch: (r: Reply) => Reply) => {
    setChats((cs) =>
      cs.map((c) =>
        c.id !== chatId
          ? c
          : {
              ...c,
              turns: c.turns.map((t) => (t.id !== turnId ? t : { ...t, replies: t.replies.map((r) => (r.model === model ? patch(r) : r)) })),
            },
      ),
    );
  }, []);

  const ask = (question: string, reference?: string) => {
    let chatId = activeId;
    const turn = makeTurn(question, reference, models);
    follow.current = true;
    setAtBottom(true);
    if (!active) {
      chatId = newId();
      const title = question.replace(/\s+/g, " ").slice(0, 48);
      const at = turn.createdAt;
      setChats((cs) => [...cs, { id: chatId!, title, models, turns: [turn], createdAt: at, updatedAt: at }]);
      setActiveId(chatId);
    } else {
      setChats((cs) => cs.map((c) => (c.id === chatId ? { ...c, turns: [...c.turns, turn], updatedAt: turn.createdAt } : c)));
    }

    const controller = new AbortController();
    controllers.current.set(turn.id, controller);
    const runs = models.map((model) =>
      streamGenerate(
        { model, question, reference },
        (e) => {
          if (e.type === "token") updateReply(chatId!, turn.id, model, (r) => ({ ...r, text: r.text + e.text }));
          else if (e.type === "done")
            updateReply(chatId!, turn.id, model, (r) => ({
              ...r,
              status: "done",
              finalAnswer: e.final_answer,
              corrected: e.corrected,
              correct: e.correct,
              fixed: e.fixed,
              finished: e.finished,
              tokens: e.tokens,
              latencyMs: e.latency_ms,
            }));
          else updateReply(chatId!, turn.id, model, (r) => ({ ...r, status: "error", error: e.message }));
        },
        controller.signal,
      )
        .then(() => updateReply(chatId!, turn.id, model, (r) => (r.status === "streaming" ? { ...r, status: "stopped" } : r)))
        .catch((err: Error) =>
          updateReply(chatId!, turn.id, model, (r) =>
            controller.signal.aborted ? { ...r, status: "stopped" } : { ...r, status: "error", error: err.message },
          ),
        ),
    );
    Promise.allSettled(runs).then(() => controllers.current.delete(turn.id));
  };

  const stop = () => {
    for (const t of active?.turns ?? []) controllers.current.get(t.id)?.abort();
  };

  const setModels = (m: string[]) => {
    if (active) setChats((cs) => cs.map((c) => (c.id === active.id ? { ...c, models: m } : c)));
    else setDraftModels(m);
  };

  const newChat = () => {
    setActiveId(null);
    setDraftModels(DEFAULT_MODELS);
    setSidebarOpen(false);
  };

  const offline = health !== null && !health.online;

  return (
    <div className="app">
      <Sidebar
        chats={chats}
        activeId={activeId}
        open={sidebarOpen}
        onNew={newChat}
        onSelect={(id) => {
          setActiveId(id);
          setSidebarOpen(false);
        }}
        onDelete={(id) => {
          setChats((cs) => cs.filter((c) => c.id !== id));
          if (id === activeId) setActiveId(null);
        }}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main">
        <header className="topbar">
          <button className="menu" onClick={() => setSidebarOpen(true)} aria-label="Open chats">☰</button>
          <ModelPicker value={models} onChange={setModels} available={health?.online ? health.models : null} />
          <span className={`status ${health === null ? "" : health.online ? "on" : "off"}`} role="status">
            <span className="status-dot" aria-hidden /> <span className="status-text">{health === null ? "Checking" : health.online ? "GPU online" : "GPU offline"}</span>
          </span>
        </header>

        {offline && (
          <div className="notice banner" role="status">
            The model servers are offline. They run on free Kaggle GPUs that are switched on for demos, so answers are not available right now.
          </div>
        )}

        <div className="thread" ref={thread} onScroll={onScroll}>
          {!active && (
            <div className="empty">
              <h1>Can a small model check its own work?</h1>
              <p className="muted">
                Qwen3.5 fine-tuned to write two attempts, review them, and give a refined final answer.
                Try an example from MATH-500 or ask your own question.
              </p>
              <div className="examples">
                {examples.map((ex) => (
                  <button key={ex.id} className="example" onClick={() => ask(ex.problem, ex.answer)} disabled={offline}>
                    <div className="example-meta">{ex.subject} · Level {ex.level}</div>
                    <div className="example-text"><Markdown text={ex.problem} /></div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {active?.turns.map((t) => (
            <div key={t.id} className="turn">
              <div className="user-msg">
                <div className="bubble"><Markdown text={t.question} /></div>
              </div>
              <div className={`replies ${t.replies.length > 1 ? "grid" : ""}`}>
                {t.replies.map((r) => (
                  <ReplyView key={r.model} reply={r} />
                ))}
              </div>
              {t.reference && (
                <div className="reference">
                  Known answer <Markdown text={`$${t.reference}$`} />
                </div>
              )}
            </div>
          ))}
        </div>

        {!atBottom && active && (
          <button className="jump" onClick={jumpToLatest}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M8 3v10M4 9l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {busy ? "Jump to latest" : "Back to bottom"}
          </button>
        )}

        <Composer busy={busy} disabled={offline} onSend={(q) => ask(q)} onStop={stop} />
        <div className="sr-only" aria-live="polite">{busy ? `${getModel(models[0]).label} is answering` : ""}</div>
      </main>
    </div>
  );
}
