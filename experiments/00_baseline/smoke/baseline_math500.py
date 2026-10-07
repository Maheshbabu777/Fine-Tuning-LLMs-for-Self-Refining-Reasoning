# Baseline: Qwen3.5 Base models on MATH-500 (pass@1 greedy + maj@4 sampled)
import subprocess, sys, json, os, time, re, collections, traceback
def sh(c): print("$", c, flush=True); return subprocess.run(c, shell=True)
OUT = "/kaggle/working"
log = {"start": time.ctime()}
sh("nvidia-smi --query-gpu=name,memory.total,compute_cap --format=csv")
sh("pip install -q -U 'transformers>=4.57' accelerate math-verify datasets 2>&1 | tail -2")
USE_VLLM = sh("pip install -q -U vllm 2>&1 | tail -2").returncode == 0
import torch
from datasets import load_dataset
from math_verify import parse, verify
ds = load_dataset("HuggingFaceH4/MATH-500", split="test")
N = int(os.environ.get("N", 30))
ds = ds.select(range(N))
PROMPT = "Question: {q}\nPlease reason step by step, and put your final answer within \\boxed{{}}.\nAnswer:"
STOPS = ["\n\nQuestion:", "Question:", "<|endoftext|>", "<|im_end|>"]
prompts = [PROMPT.format(q=x["problem"]) for x in ds]

def boxed(s):
    i = s.rfind("\\boxed{")
    if i < 0: return None
    j, d = i + 7, 1
    while j < len(s) and d:
        d += {"{": 1, "}": -1}.get(s[j], 0); j += 1
    return s[i+7:j-1] if d == 0 else None

def correct(pred_text, gold):
    try: return bool(verify(parse("$" + gold + "$"), parse(pred_text)))
    except Exception: return False

def gen_vllm(model_id, n, temp):
    from vllm import LLM, SamplingParams
    global llm
    if llm is None or llm_id[0] != model_id:
        llm = LLM(model=model_id, dtype="float16", max_model_len=4096, gpu_memory_utilization=0.85,
                  enforce_eager=True, limit_mm_per_prompt={"image": 0, "video": 0})
        llm_id[0] = model_id
    sp = SamplingParams(n=n, temperature=temp, top_p=0.95 if temp > 0 else 1.0, max_tokens=2048, stop=STOPS, seed=0)
    outs = llm.generate(prompts, sp)
    return [[c.text for c in o.outputs] for o in outs]

def gen_hf(model_id, n, temp):
    from transformers import AutoTokenizer, AutoModelForCausalLM
    tok = AutoTokenizer.from_pretrained(model_id); tok.padding_side = "left"
    if tok.pad_token is None: tok.pad_token = tok.eos_token
    m = AutoModelForCausalLM.from_pretrained(model_id, torch_dtype=torch.float16, device_map="cuda")
    res = []
    for b in range(0, len(prompts), 16):
        batch = prompts[b:b+16]
        enc = tok(batch, return_tensors="pt", padding=True).to("cuda")
        g = m.generate(**enc, max_new_tokens=1024, do_sample=temp > 0, temperature=temp or None, top_p=0.95 if temp else None,
                       num_return_sequences=n, pad_token_id=tok.pad_token_id, stop_strings=STOPS, tokenizer=tok)
        texts = tok.batch_decode(g[:, enc["input_ids"].shape[1]:], skip_special_tokens=True)
        for k in range(len(batch)): res.append(texts[k*n:(k+1)*n])
        print(f"  hf batch {b}", flush=True)
    del m; torch.cuda.empty_cache()
    return res

llm, llm_id = None, [None]
results = {}
for model_id in os.environ.get("MODELS", "Qwen/Qwen3.5-0.8B-Base").split(","):
    r = {}
    for backend in (["vllm", "hf"] if USE_VLLM else ["hf"]):
        try:
            gen = gen_vllm if backend == "vllm" else gen_hf
            t = time.time(); greedy = gen(model_id, 1, 0.0); r["t_greedy_s"] = time.time() - t
            t = time.time(); samp = gen(model_id, 4, 0.7); r["t_samp_s"] = time.time() - t
            r["backend"] = backend; break
        except Exception as e:
            print(f"!! {backend} failed for {model_id}: {e}"); traceback.print_exc(); r[f"{backend}_error"] = str(e)[:500]
            llm = None; torch.cuda.empty_cache()
    else:
        results[model_id] = r; continue
    rows, lvl = [], collections.defaultdict(lambda: [0, 0, 0])
    for x, g, s in zip(ds, greedy, samp):
        c1 = correct(g[0], x["answer"])
        answers = [boxed(t) for t in s]
        votes = collections.Counter(a.strip() for a in answers if a)
        maj = votes.most_common(1)[0][0] if votes else None
        cm = correct("\\boxed{" + maj + "}", x["answer"]) if maj else False
        per = [correct(t, x["answer"]) for t in s]
        rows.append({"id": x["unique_id"], "level": x["level"], "gold": x["answer"], "greedy_pred": boxed(g[0]),
                     "greedy_ok": c1, "maj_pred": maj, "maj_ok": cm, "sample_ok": per,
                     "greedy_text": g[0], "sample_texts": s,
                     "no_box": boxed(g[0]) is None})
        L = lvl[x["level"]]; L[0] += 1; L[1] += c1; L[2] += cm
    n = len(rows)
    r.update({"n": n, "pass@1_greedy": sum(z["greedy_ok"] for z in rows) / n,
              "maj@4": sum(z["maj_ok"] for z in rows) / n,
              "mean_sample_acc": sum(sum(z["sample_ok"]) for z in rows) / (4 * n),
              "pass@4_any": sum(any(z["sample_ok"]) for z in rows) / n,
              "greedy_no_boxed_rate": sum(z["no_box"] for z in rows) / n,
              "by_level": {k: {"n": v[0], "greedy": v[1] / v[0], "maj4": v[2] / v[0]} for k, v in sorted(lvl.items())}})
    results[model_id] = r
    print(json.dumps({model_id: r}, indent=1), flush=True)
    with open(f"{OUT}/{model_id.split('/')[1]}_rows.jsonl", "w") as f:
        for z in rows: f.write(json.dumps(z) + "\n")
    json.dump(results, open(f"{OUT}/summary.json", "w"), indent=1)
    llm = None; torch.cuda.empty_cache()
log["end"] = time.ctime(); results["_log"] = log
json.dump(results, open(f"{OUT}/summary.json", "w"), indent=1)
print("DONE")
