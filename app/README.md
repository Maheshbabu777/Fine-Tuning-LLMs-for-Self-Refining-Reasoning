# Chat app: run the trained models in a browser

A ChatGPT-style site where anyone can ask a math question to the trained models, watch the answer stream in, and compare Base, CoT and Self-refine side by side. Four models are live at a time (one per Kaggle T4); the other four from the README tables are listed but greyed out.

```
Browser ──> Vercel (Next.js, app/frontend)
              /api/generate adds the secret key and picks the server that has the model
                 │                                   │
                 ▼                                   ▼
     ngrok URL A (free)                    ngrok URL B (free)
                 │                                   │
                 ▼                                   ▼
   Kaggle account A, notebook 09          Kaggle account B, notebook 09
   2x T4                                  2x T4
   GPU 0: 4b-review (merged)              GPU 0: 4b-base
   GPU 1: 4b-cot (merged)                 GPU 1: 2b-review-27b (merged)
```

- **Base model + adapter, merged:** the notebook downloads the public base model from Hugging Face, merges the LoRA adapter into it (exactly as notebook 07 did for the evaluation) and serves the merged model with vLLM. "4b-base" is the base with no adapter.
- **Why not LoRA on top in vLLM:** tested on 2026-10-31 with vLLM 0.32. It loads the Qwen3.5 adapters without an error but does not apply them: the fine-tuned models answered like the base model (0 to 5 of 20 MATH-500 answers the same as the eval, base 17 to 18 of 20). Merged models give 12 of 12 the same for Self-refine 4B and CoT 4B. `"mode": "lora"` is still in the notebook (it would serve all 8) for when vLLM supports these adapters.
- **Same settings as the evaluation:** same prompts (notebook 01 for base, `[Question] ...` for fine-tunes), greedy decoding, `repetition_penalty=1.1`, fp16, max 3072 new tokens (2048 + stop words for base, as in notebook 01).
- **Cost:** 0. Each Kaggle account gives about 30 GPU hours a week and a run lasts at most 12 hours, so switch the servers on for demos.
- **If one account is off,** the site still works for the other account's models; the rest are greyed out in the picker.
- **Each message is answered on its own.** The models were trained on single questions, so chat history is not sent.

## Already done

- Private dataset `selfrefine-adapters` (6 adapters + eval outputs) uploaded to both Kaggle accounts.
- `app/kaggle/accounts.local.json` created with a random `app_api_key` (gitignored, never commit it).

## One-time setup (about 30 minutes)

### 1. Two free ngrok accounts (one fixed public URL per Kaggle account)

The free plan gives one fixed domain per ngrok account, and the two Kaggle servers run at the same time, so you need two ngrok accounts (two different emails).

For each one:
1. Sign up at https://dashboard.ngrok.com/signup.
2. **Your Authtoken** page: copy the token.
3. **Domains** page: copy the free dev domain, for example `something-random.ngrok-free.app`.

Open `app/kaggle/accounts.local.json` and fill `ngrok_authtoken` and `ngrok_domain` (without `https://`) for account `a` with ngrok account 1, and account `b` with ngrok account 2.

### 2. First start

From the repo root in PowerShell:

```powershell
.\app\kaggle\push.ps1
```

This, for each Kaggle account:
1. uploads a private dataset `selfrefine-server-config` with that account's settings (key, ngrok token and domain, which models);
2. pushes `notebooks/09_inference_server.ipynb` as a private GPU notebook and starts a background run (like "Save & Run All").

After 10 to 15 minutes:

```powershell
.\app\kaggle\push.ps1 status
```

Both accounts should say `online, models: ...`. The first time, also open the logs (links printed by the script, log in to that Kaggle account) and check:
- "GPU 0 ... ready" and "GPU 1 ... ready"
- the check table: each model mostly **same as eval** (measured on the live run: Self-refine 4B and CoT 4B 12/12, Base 4B 11/12, Self-refine 2B 8/12 on 12 problems)
- the streamed test answer ending with `'correct': True`

`"mode": "merged"` (the default in `accounts.example.json`) serves 4B self-refine and 4B CoT on account A, 4B base and 2B self-refine 27B on account B, one model per GPU. Compare mode uses all three 4B models.

To check the live servers end to end: `node app/kaggle/live-check.mjs` (each model directly) and `node app/kaggle/live-check.mjs --site https://your-site.vercel.app` (through the website).

### 3. Deploy the website to Vercel

Needs a free Vercel account (sign in with GitHub). From `app/frontend`:

```powershell
cd app/frontend
npm install
npx vercel login
npx vercel link                                # create a new project, keep the suggested settings
npx vercel env add BACKEND_URL_A production    # paste https:// + ngrok domain of account a
npx vercel env add BACKEND_URL_B production    # paste https:// + ngrok domain of account b
npx vercel env add APP_API_KEY production      # paste app_api_key from accounts.local.json
npx vercel --prod
```

The last command prints your site URL, for example `https://selfrefine.vercel.app`. That is the link for your lecturer. It never changes, because the ngrok domains never change.

## Every time you want the site live

```powershell
.\app\kaggle\push.ps1           # start both servers
.\app\kaggle\push.ps1 status    # after 10 to 15 minutes: both "online"
```

The site's top right shows **GPU online**. The servers run until you cancel the runs on Kaggle (each account's notebook page) or Kaggle's 12-hour limit. A run uses GPU quota even when nobody asks anything, so start shortly before a demo. When the servers are off, the site still opens and shows "GPU offline".

## Work on the UI without Kaggle

The mock servers replay real saved answers from `experiments/08_eval_rp` (always the same problem); no model runs.

```powershell
cd app/frontend
# .env.local: BACKEND_URL_A=http://localhost:9000, BACKEND_URL_B=http://localhost:9001, APP_API_KEY=dev-key
node scripts/mock-backend.mjs 9000 4b    # terminal 1: pretends to be account A
node scripts/mock-backend.mjs 9001 2b    # terminal 2: pretends to be account B
npm run dev                              # terminal 3: open http://localhost:3000
```

## Files

| File | What it does |
|---|---|
| `notebooks/09_inference_server.ipynb` | Reads its settings, starts one vLLM per GPU, writes and starts `router.py`, checks answers against the eval, opens the ngrok tunnel |
| `app/kaggle/push.ps1` | Starts notebook 09 on both Kaggle accounts, or shows their status |
| `app/kaggle/accounts.example.json` | Template for `accounts.local.json` (key, ngrok tokens, which account serves which models) |
| `app/frontend/lib/backends.ts` | Asks both servers which models they have, picks the right one per question |
| `app/frontend/app/api/generate/route.ts` | Server-side proxy: adds the key, streams the answer to the browser |
| `app/frontend/app/api/health/route.ts` | Tells the page which models are online |
| `app/frontend/components/ChatApp.tsx` | Chat state, history (browser localStorage), sending questions, compare mode |
| `app/frontend/components/ReplyView.tsx` | One answer: reasoning block (Attempt 1, Attempt 2, Review), final answer, badges |
| `app/frontend/lib/parse.ts` | Splits the output at `[Answer 1]`, `[Answer 2]`, `[Review]`, `[Final answer]` |
| `app/frontend/lib/models.ts` | The 8 models with their MATH-500 scores |
| `app/kaggle/live-check.mjs` | Live test of the real servers or the deployed site |
| `app/frontend/e2e/chat.spec.ts` | 18 browser tests against mock servers (`npm run test:e2e`) |
| `app/frontend/tests/parse.test.ts` | Unit tests of the answer parsing on real eval outputs (`npm test`) |
| `app/kaggle/tests/test_router.py` | Tests of the Kaggle router taken from notebook 09 (`python -m pytest app/kaggle/tests`) |
| `app/frontend/scripts/mock-backend.mjs` | Fake server for local UI work |

## Badges

- **Correct / Wrong**: only for the example questions, graded with `math_verify` exactly like notebook 07.
- **Fixed its first answer**: example questions where Attempt 1 was wrong and the final answer is right.
- **Changed its answer after review**: your own questions where the final answer differs from Attempt 1 (no known answer to grade against).

## Security

- The API key is in `accounts.local.json` (gitignored), the private Kaggle config datasets and Vercel env vars. Never in the browser or in git.
- The ngrok tokens are stored in a private Kaggle dataset on each account so the notebook can run without the Kaggle secrets UI. Anyone with access to that Kaggle account can read them; that is acceptable for free ngrok tokens. Rotate them on the ngrok dashboard after the viva if you want.
- The router rejects requests without the key (401), unknown models (404) and questions over 3,000 characters (422), and runs at most 8 answers at once per account.
- Logs record model, question length, tokens and time, never the question text.
- Anyone with the website link can use it while the GPUs are on. That is fine for a short demo; cancel the runs afterwards.
