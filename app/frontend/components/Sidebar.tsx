"use client";

import type { Chat } from "@/lib/types";

type Props = {
  chats: Chat[];
  activeId: string | null;
  open: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export function Sidebar({ chats, activeId, open, onNew, onSelect, onDelete, onClose }: Props) {
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <span className="logo">∑</span> Self-Refine
        </div>
        <button className="new-chat" onClick={onNew}>+ New chat</button>
        <div className="history-label">Chats</div>
        <nav className="history">
          {sorted.length === 0 && <div className="muted small pad">No chats yet</div>}
          {sorted.map((c) => (
            <div key={c.id} className={`history-item ${c.id === activeId ? "active" : ""}`}>
              <button className="history-title" onClick={() => onSelect(c.id)} title={c.title}>
                {c.title}
              </button>
              <button
                className="history-delete"
                aria-label={`Delete chat ${c.title}`}
                onClick={() => confirm("Delete this chat?") && onDelete(c.id)}
              >
                ×
              </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          Fine-Tuning LLMs for Self-Refining Reasoning
          <br />
          <a href="https://github.com/Maheshbabu777/Fine-Tuning-LLMs-for-Self-Refining-Reasoning" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </aside>
      {open && <div className="scrim" onClick={onClose} />}
    </>
  );
}
