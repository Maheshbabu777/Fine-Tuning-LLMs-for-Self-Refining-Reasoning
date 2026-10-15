# Stage 1 data: sample K reasoning chains per training problem from a base model, grade each one.
# Output: chains.jsonl  (one row per problem: problem, gold, source, level, chains[{text, pred, ok, finished, n_tokens}])
import subprocess, sys, os, json, time, re
MODEL   = "Qwen/Qwen3.5-2B-Base"
N_MATH  = 1000      # MATH train problems (7500 max)
N_GSM   = 0         # GSM8K train problems (7473 max)
K       = 4         # chains per problem
TEMP    = 0.8
MAXTOK  = 1024
OUT     = "/kaggle/working"
PROMPT  = "Question: {q}\nPlease reason step by step, and put your final answer within \\boxed{{}}.\nAnswer:"
STOPS   = ["\n\nQuestion:", "Question:", "<|endoftext|>", "<|im_end|>"]

def sh(c): print("$", c, flush=True); return subprocess.run(c, shell=True).returncode

def boxed(s):
    i = s.rfind("\\boxed{")
    if i < 0: return None
    j, d = i + 7, 1
    while j < len(s) and d:
        d += {"{": 1, "}": -1}.get(s[j], 0); j += 1
    return s[i+7:j-1] if d == 0 else None

# ---- main: install, build problem list, launch one worker per GPU, merge, report ----
sh("pip install -q -U 'transformers>=4.57' vllm math-verify datasets 2>&1 | tail -2")
from datasets import load_dataset
test_q = set(x["problem"].strip() for x in load_dataset("HuggingFaceH4/MATH-500", split="test"))
probs = []
m = load_dataset("DigitalLearningGmbH/MATH-lighteval", "default", split="train").shuffle(seed=0)
for x in m:
    if len(probs) >= N_MATH: break
    g = boxed(x["solution"])
    if g and x["problem"].strip() not in test_q:
        probs.append({"id": f"math-{len(probs)}", "source": "math", "level": x["level"], "type": x["type"],
                      "problem": x["problem"], "gold": g, "ref_solution": x["solution"]})
if N_GSM:
    gs = load_dataset("openai/gsm8k", "main", split="train").shuffle(seed=0).select(range(N_GSM))
    for i, x in enumerate(gs):
        sol, ans = x["answer"].split("####")
        probs.append({"id": f"gsm-{i}", "source": "gsm8k", "level": "gsm", "type": "gsm",
                      "problem": x["question"], "gold": ans.strip().replace(",", ""), "ref_solution": sol.strip()})
with open(f"{OUT}/problems.jsonl", "w") as f:
    for p in probs: f.write(json.dumps(p) + "\n")
print(f"{len(probs)} problems (MATH-500 overlap removed)", flush=True)

WORKER_SRC = 'import sys, json, time\nMODEL   = "Qwen/Qwen3.5-2B-Base"\nK       = 4         # chains per problem\nTEMP    = 0.8\nMAXTOK  = 1024\nOUT     = "/kaggle/working"\nPROMPT  = "Question: {q}\\nPlease reason step by step, and put your final answer within \\\\boxed{{}}.\\nAnswer:"\nSTOPS   = ["\\n\\nQuestion:", "Question:", "<|endoftext|>", "<|im_end|>"]\n\ndef boxed(s):\n    i = s.rfind("\\\\boxed{")\n    if i < 0: return None\n    j, d = i + 7, 1\n    while j < len(s) and d:\n        d += {"{": 1, "}": -1}.get(s[j], 0); j += 1\n    return s[i+7:j-1] if d == 0 else None\n\ndef worker(shard, nshards):\n    from vllm import LLM, SamplingParams\n    from math_verify import parse, verify\n    rows = [json.loads(l) for l in open(f"{OUT}/problems.jsonl")][shard::nshards]\n    llm = None\n    for eager in (False, True):\n        try:\n            llm = LLM(model=MODEL, dtype="float16", max_model_len=2048, gpu_memory_utilization=0.88,\n                      enforce_eager=eager, limit_mm_per_prompt={"image": 0, "video": 0}, seed=shard); break\n        except Exception as e: print(f"[shard {shard}] eager={eager} failed: {e}", flush=True)\n    if llm is None: raise SystemExit(f\'[shard {shard}] could not start vLLM\')\n    sp = SamplingParams(n=K, temperature=TEMP, top_p=0.95, max_tokens=MAXTOK, stop=STOPS, seed=shard)\n    t = time.time()\n    outs = llm.generate([PROMPT.format(q=r["problem"]) for r in rows], sp)\n    with open(f"{OUT}/chains_shard{shard}.jsonl", "w") as f:\n        for r, o in zip(rows, outs):\n            gold = parse("$" + r["gold"] + "$")\n            ch = []\n            for c in o.outputs:\n                p = boxed(c.text)\n                try: ok = bool(verify(gold, parse(c.text))) if p else False\n                except Exception: ok = False\n                ch.append({"text": c.text, "pred": p, "ok": ok, "finished": c.finish_reason == "stop" and p is not None,\n                           "n_tokens": len(c.token_ids)})\n            r["chains"] = ch; f.write(json.dumps(r) + "\\n")\n    print(f"[shard {shard}] done {len(rows)} problems in {time.time()-t:.0f}s", flush=True)\n\n\nif __name__ == "__main__":\n    worker(int(sys.argv[1]), int(sys.argv[2]))\n'
open(f"{OUT}/worker.py", "w").write(WORKER_SRC)
import torch
ng = max(1, torch.cuda.device_count())
procs = [subprocess.Popen([sys.executable, f"{OUT}/worker.py", str(i), str(ng)], env={**os.environ, "CUDA_VISIBLE_DEVICES": str(i)}) for i in range(ng)]
for p in procs: p.wait()

rows = []
for i in range(ng):
    fn = f"{OUT}/chains_shard{i}.jsonl"
    if os.path.exists(fn): rows += [json.loads(l) for l in open(fn)]
with open(f"{OUT}/chains.jsonl", "w") as f:
    for r in rows: f.write(json.dumps(r) + "\n")
# quick stats: this is what decides how much "self-correction" training data we can build
n = len(rows)
if n == 0: raise SystemExit('no chains produced - check worker logs above')
C = [sum(c["ok"] for c in r["chains"]) for r in rows]
stats = {"model": MODEL, "problems": n, "K": K,
         "chain_acc": sum(C) / (n * K),
         "unfinished_rate": sum(not c["finished"] for r in rows for c in r["chains"]) / (n * K),
         "all_wrong": sum(c == 0 for c in C) / n, "all_right": sum(c == K for c in C) / n,
         "mixed (usable for correction)": sum(0 < c < K for c in C) / n,
         "first_wrong_but_some_right": sum((not r["chains"][0]["ok"]) and c > 0 for r, c in zip(rows, C)) / n,
         "mean_tokens": sum(c["n_tokens"] for r in rows for c in r["chains"]) / (n * K)}
json.dump(stats, open(f"{OUT}/stats.json", "w"), indent=1); print(json.dumps(stats, indent=1)); print("DONE")
