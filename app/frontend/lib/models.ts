// The 8 models from the README results tables. The ids must match the router in notebooks/09_inference_server.ipynb.
export type Kind = "base" | "cot" | "refine" | "review";

export type ModelInfo = {
  id: string;
  label: string;
  size: "4B" | "2B";
  kind: Kind;
  score: number; // MATH-500 accuracy in %, README section 4
  blurb: string;
};

export const MODELS: ModelInfo[] = [
  { id: "4b-review", label: "Self-refine 4B", size: "4B", kind: "review", score: 75.4, blurb: "Two attempts, a review, then the final answer" },
  { id: "4b-cot", label: "CoT 4B", size: "4B", kind: "cot", score: 71.6, blurb: "Conventional step-by-step reasoning" },
  { id: "4b-base", label: "Base 4B", size: "4B", kind: "base", score: 68.2, blurb: "Untouched Qwen3.5-4B-Base" },
  { id: "2b-review-27b", label: "Self-refine 2B (27B teacher)", size: "2B", kind: "review", score: 61.2, blurb: "Reviews written by Qwen3.8-27B" },
  { id: "2b-review-9b", label: "Self-refine 2B (9B teacher)", size: "2B", kind: "review", score: 59.8, blurb: "Reviews written by Qwen3.5-9B" },
  { id: "2b-cot", label: "CoT 2B", size: "2B", kind: "cot", score: 57.4, blurb: "Conventional step-by-step reasoning" },
  { id: "2b-base", label: "Base 2B", size: "2B", kind: "base", score: 55.6, blurb: "Untouched Qwen3.5-2B-Base" },
  { id: "2b-refine", label: "Refine 2B (ablation)", size: "2B", kind: "refine", score: 54.6, blurb: "Rewrites the solution instead of a review" },
];

export const DEFAULT_MODELS = ["4b-review"];
export const COMPARE_MODELS = ["4b-base", "4b-cot", "4b-review"];

export function getModel(id: string): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? { id, label: id, size: "4B", kind: "base", score: 0, blurb: "" };
}
