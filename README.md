# Fine-Tuning LLMs for Self-Refining Reasoning

Small language models answer in one pass: whatever their first line of reasoning says becomes the answer. This project teaches a small model to **check its own work**. Qwen3.5 base models (2B and 4B) are fine-tuned to write two attempts at a math problem, review both, and only then give a final answer.

On the MATH-500 benchmark, the self-refining 4B model reaches **75.4%**, ahead of the base model (68.2%) and of conventional chain-of-thought fine-tuning (71.6%). Both gains are statistically significant.

**Live demo:** [finetuning-ochre.vercel.app](https://finetuning-ochre.vercel.app)
The models run on free Kaggle GPUs that are switched on for demos. When they are off, the site shows "GPU offline".

---

## How it works

The model learns to write every answer in this format:

```
[Question]      a math problem
[Answer 1]      first attempt, step by step, ending in \boxed{...}
[Answer 2]      second attempt, step by step, ending in \boxed{...}
[Review]        which attempt is right, and the exact step where the other one goes wrong
[Final answer]  the refined answer
```

The training data is built from the model's **own** mistakes, so it learns to catch the errors it really makes:

1. **Collect attempts.** The base model solves about 7,500 MATH training problems four times each. Every attempt is graded automatically.
2. **Pick pairs.** Two attempts per problem: wrong then right, right then wrong, or both right.
3. **Write reviews.** A larger teacher model (Qwen3.8-27B) reads both attempts and writes the review in the student's voice. Reviews that reach the wrong answer are thrown away.
4. **Fine-tune.** LoRA fine-tuning on these examples. Two comparison models are trained on the same problems: **CoT** (one correct solution, the conventional approach) and **Refine** (rewrites the whole solution instead of reviewing it).
5. **Evaluate.** All models answer the 500 MATH-500 problems with the same settings (greedy decoding), graded with `math_verify`.

## Results

| Model | 2B | 4B |
|---|---|---|
| Base model, no fine-tuning | 55.6% | 68.2% |
| CoT fine-tuning (conventional) | 57.4% | 71.6% |
| Refine fine-tuning (rewrite instead of review) | 54.6% | |
| **Self-refine fine-tuning (this project)** | **61.2%** | **75.4%** |

What the results show:

- **Self-refinement can be learned.** It beats the base model at both sizes (p = 0.009 at 2B, p = 0.0002 at 4B, McNemar test).
- **It beats conventional reasoning at 4B** (75.4% vs 71.6%, p = 0.048). At 2B the gap points the same way but is not significant.
- **The model really reconsiders.** At 4B its final answer is 7.2 points better than its own first attempt. When the two attempts disagree, it picks the right one 83% of the time, where guessing would give 50%.
- **Reviewing works, rewriting does not.** The Refine model ends up worse than its own first attempt.
- **Hard problems gain the most.** On the hardest level: 52.2% for self-refine, 43.3% for CoT and 38.1% for the base model (4B).

Full tables, per-level accuracy and every significance test are in `notebooks/08_results_analysis.ipynb`.

## Live demo

The website works like ChatGPT: pick a model, ask a question, and watch the answer stream in. For self-refining models, the two attempts and the review sit in a collapsible "Reasoning" block above the final answer. **Compare mode** sends one question to the base, CoT and self-refine 4B models side by side, so the difference between conventional and self-refining reasoning is visible directly.

```
Browser  ->  Website on Vercel  ->  Kaggle GPU servers (2 accounts, 4 T4 GPUs)  ->  answer streams back
```

- The servers use exactly the evaluation's prompts and decoding settings. On test problems, the live self-refine and CoT 4B models gave the same final answers as the evaluation (12 of 12).
- Four models are live at a time, one per GPU: self-refine 4B, CoT 4B, base 4B and self-refine 2B.
- A self-refine answer takes about 50 to 100 seconds on a T4. Text starts appearing within a second.
- The website and servers are covered by unit, browser and live end-to-end tests.

## Built with

| Area | Tools |
|---|---|
| Models | Qwen3.5-2B-Base, Qwen3.5-4B-Base, Qwen3.8-27B (teacher) |
| Training | Hugging Face Transformers, PEFT (LoRA), TRL |
| Evaluation and serving | vLLM, math-verify, FastAPI, ngrok |
| Compute | Kaggle notebooks (2x NVIDIA T4, free tier) |
| Website | Next.js, TypeScript, KaTeX, Vercel |
| Testing | Playwright, Node test runner, pytest |

## Folder structure

```
notebooks/          the full pipeline, 01 to 09, run in order
                    (baseline, attempts, pairs, reviews, training data, training, evaluation, analysis, serving)
datasets/           attempt pairs, teacher reviews and the training files
experiments/        logs and outputs of every Kaggle run; 08_eval_rp/ holds the final evaluation results
models/             adapter configs and training logs (the weights are not stored in git)
app/frontend/       the chat website and its tests
app/kaggle/         scripts that start the GPU servers on Kaggle, and the live tests
archive_v1_phi2/    the first attempt with Phi-2, kept for reference
```

## Running it

- **Training and evaluation:** run the notebooks in order on Kaggle (GPU T4 x2, internet on). Notebooks 03, 05 and 08 also run on a laptop. Each notebook starts with a note on how it was run.
- **Live demo:** `.\app\kaggle\push.ps1` starts the GPU servers on both Kaggle accounts (ready in about 20 minutes), and `.\app\kaggle\push.ps1 status` shows whether they are online. The Kaggle and ngrok keys are kept out of git; `app/kaggle/accounts.example.json` shows the expected settings.
- **Website on a laptop:** in `app/frontend`, run `npm install` and `npm run dev`. `scripts/mock-backend.mjs` replays saved model outputs so the site works without a GPU.

## Limitations

- **One benchmark.** All results are on competition math (MATH-500).
- **Longer answers.** Two attempts plus a review cost about 2.3 times the tokens of a CoT answer.
- **Close result.** The 4B win over CoT (p = 0.048) is near the significance threshold.
- **Informed teacher.** The teacher sees the correct answer while writing reviews, so its reviews are better informed than anything the model can write on its own at test time.

## Project history

The first version (`archive_v1_phi2/`) fine-tuned Phi-2, but its answers never stopped, because the training examples were missing an end-of-text token. The project was rebuilt on Qwen3.5-2B, then improved with a stronger teacher, scaled to 4B, and finally served as a live chat website.

---

**Author:** Mahesh Babu Vishnumolakala, B.Tech CSE, Lovely Professional University
