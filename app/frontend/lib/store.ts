import type { Chat } from "./types";

// Chat history lives in this browser only (localStorage).
const KEY = "selfrefine.chats.v1";

export function loadChats(): Chat[] {
  try {
    const raw = localStorage.getItem(KEY);
    const chats = raw ? (JSON.parse(raw) as Chat[]) : [];
    // A reload in the middle of an answer leaves it unfinished.
    for (const c of chats)
      for (const t of c.turns)
        for (const r of t.replies) if (r.status === "streaming") r.status = "stopped";
    return chats;
  } catch {
    return [];
  }
}

export function saveChats(chats: Chat[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(chats));
  } catch {
    // storage full or disabled: history just isn't saved
  }
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
