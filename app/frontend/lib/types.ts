export type ReplyStatus = "streaming" | "done" | "stopped" | "error";

export type Reply = {
  model: string;
  text: string;
  status: ReplyStatus;
  error?: string;
  tokens?: number;
  latencyMs?: number;
  finalAnswer?: string | null;
  corrected?: boolean;
  correct?: boolean | null;
  fixed?: boolean | null;
  finished?: boolean;
};

// One question and its answers. Each turn is answered on its own (decisions.md 2026-10-16).
export type Turn = {
  id: string;
  question: string;
  reference?: string; // known answer when the question came from the examples
  replies: Reply[];
  createdAt: number;
};

export type Chat = {
  id: string;
  title: string;
  models: string[]; // one model, or three in compare mode
  turns: Turn[];
  createdAt: number;
  updatedAt: number;
};

// Events sent by the router on Kaggle (notebooks/09_inference_server.ipynb).
export type StreamEvent =
  | { type: "token"; text: string }
  | {
      type: "done";
      final_answer: string | null;
      first_answer: string | null;
      corrected: boolean;
      correct: boolean | null;
      fixed: boolean | null; // first answer wrong, final right (only when the known answer was sent)
      finished: boolean;
      tokens: number;
      latency_ms: number;
    }
  | { type: "error"; message: string };
