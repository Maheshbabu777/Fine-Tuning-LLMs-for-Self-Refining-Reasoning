import sys, json, time
MODEL   = "Qwen/Qwen3.5-2B-Base"
K       = 4         # chains per problem
TEMP    = 0.8
MAXTOK  = 1024
OUT     = "/kaggle/working"
PROMPT  = "Question: {q}\nPlease reason step by step, and put your final answer within \\boxed{{}}.\nAnswer:"
STOPS   = ["\n\nQuestion:", "Question:", "<|endoftext|>", "<|im_end|>"]

def boxed(s):
    i = s.rfind("\\boxed{")
    if i < 0: return None
    j, d = i + 7, 1
    while j < len(s) and d:
        d += {"{": 1, "}": -1}.get(s[j], 0); j += 1
    return s[i+7:j-1] if d == 0 else None

def worker(shard, nshards):
    from vllm import LLM, SamplingParams
    from math_verify import parse, verify
    rows = [json.loads(l) for l in open(f"{OUT}/problems.jsonl")][shard::nshards]
    llm = None
    for eager in (False, True):
        try:
            llm = LLM(model=MODEL, dtype="float16", max_model_len=2048, gpu_memory_utilization=0.88,
                      enforce_eager=eager, limit_mm_per_prompt={"image": 0, "video": 0}, seed=shard); break
        except Exception as e: print(f"[shard {shard}] eager={eager} failed: {e}", flush=True)
    if llm is None: raise SystemExit(f'[shard {shard}] could not start vLLM')
    sp = SamplingParams(n=K, temperature=TEMP, top_p=0.95, max_tokens=MAXTOK, stop=STOPS, seed=shard)
    t = time.time()
    outs = llm.generate([PROMPT.format(q=r["problem"]) for r in rows], sp)
    with open(f"{OUT}/chains_shard{shard}.jsonl", "w") as f:
        for r, o in zip(rows, outs):
            gold = parse("$" + r["gold"] + "$")
            ch = []
            for c in o.outputs:
                p = boxed(c.text)
                try: ok = bool(verify(gold, parse(c.text))) if p else False
                except Exception: ok = False
                ch.append({"text": c.text, "pred": p, "ok": ok, "finished": c.finish_reason == "stop" and p is not None,
                           "n_tokens": len(c.token_ids)})
            r["chains"] = ch; f.write(json.dumps(r) + "\n")
    print(f"[shard {shard}] done {len(rows)} problems in {time.time()-t:.0f}s", flush=True)


if __name__ == "__main__":
    worker(int(sys.argv[1]), int(sys.argv[2]))
