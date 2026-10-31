# Tests for router.py, the server notebook 09 writes and runs on Kaggle.
# The router code is taken straight out of the notebook, so these tests check exactly what runs on the GPU.
# Run from the repo root:  python -m pytest app/kaggle/tests -q   (needs app/kaggle/requirements-test.txt)
import importlib.util
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
NOTEBOOK = ROOT / "notebooks" / "09_inference_server.ipynb"
EVAL = ROOT / "experiments" / "08_eval_rp"
KEY = "test-key"
FAKE_VLLM_PORT = 8765


def router_source() -> str:
    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    for cell in nb["cells"]:
        src = "".join(cell["source"])
        if src.startswith("%%writefile /kaggle/working/router.py"):
            return src.split("\n", 1)[1]
    raise AssertionError("router cell not found in notebook 09")


@pytest.fixture(scope="session")
def router(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("router")
    routes = {
        "4b-review": {"port": FAKE_VLLM_PORT, "served": "4b-review", "kind": "review"},
        "4b-base": {"port": FAKE_VLLM_PORT, "served": "4b-base", "kind": "base"},
        "4b-cot": {"port": FAKE_VLLM_PORT, "served": "4b-cot", "kind": "cot"},
    }
    (tmp / "routes.json").write_text(json.dumps(routes))
    (tmp / "router.py").write_text(router_source(), encoding="utf-8")
    os.environ["ROUTES_FILE"] = str(tmp / "routes.json")
    os.environ["APP_API_KEY"] = KEY
    spec = importlib.util.spec_from_file_location("router", tmp / "router.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["router"] = module
    spec.loader.exec_module(module)
    if sys.platform == "win32":
        # math_verify's timeout uses a subprocess on Windows, which fails under pytest here; on Kaggle (Linux) it uses a signal.
        import math_verify

        module.parse = lambda s: math_verify.parse(s, parsing_timeout=None)
        module.verify = lambda a, b: math_verify.verify(a, b, timeout_seconds=None)
    return module


def load(name: str) -> list:
    return json.loads((EVAL / name).read_text(encoding="utf-8"))


# ---------- prompts and decoding are exactly the evaluation's ----------

def test_base_prompt_is_notebook_01(router):
    assert router.format_prompt("base", "1+1?") == (
        "Question: 1+1?\nPlease reason step by step, and put your final answer within \\boxed{}.\nAnswer:"
    )


def test_finetune_prompt_is_notebook_07(router):
    for kind in ("cot", "review", "refine"):
        assert router.format_prompt(kind, "1+1?") == "[Question] 1+1?\n"


def test_decoding_is_greedy_with_repetition_penalty(router):
    base = router.sampling("base")
    tuned = router.sampling("review")
    assert base["temperature"] == 0.0 and tuned["temperature"] == 0.0
    assert base["repetition_penalty"] == 1.1 and tuned["repetition_penalty"] == 1.1
    assert base["max_tokens"] == 2048 and tuned["max_tokens"] == 3072
    assert base["stop"] == ["\n\nQuestion:", "Question:", "<|endoftext|>", "<|im_end|>"]
    assert "stop" not in tuned


# ---------- grading reproduces the README numbers ----------

README = {
    "qwen4b_math500_baseline_rp1.1.json": ("base", 68.2),
    "eval_cot_4b_rp1.1.json": ("cot", 71.6),
    "eval_review_4b_rp1.1.json": ("review", 75.4),
    "qwen2b_math500_baseline_rp1.1.json": ("base", 55.6),
    "eval_cot_rp1.1.json": ("cot", 57.4),
    "eval_refine_rp1.1.json": ("refine", 54.6),
    "eval_review_rp1.1.json": ("review", 59.8),
    "eval_review_27b_rp1.1.json": ("review", 61.2),
}


@pytest.mark.parametrize("name", list(README))
def test_router_grading_matches_readme_accuracy(router, name):
    kind, readme = README[name]
    rows = load(name)
    right = sum(router.is_correct(router.final_answer(kind, r.get("text") or r.get("greedy_text")), r["gold"]) for r in rows)
    accuracy = 100 * right / len(rows)
    # base models: notebook 01 graded the whole text, the router grades the boxed answer, so allow 1 point
    assert abs(accuracy - readme) <= 1.0, f"{name}: router {accuracy:.1f}% vs README {readme}%"


def test_first_answer_matches_notebook_07(router):
    rows = load("eval_review_4b_rp1.1.json")
    same = sum(router.get_first_answer(r["text"]) == r["first_answer"] for r in rows)
    assert same == len(rows)


# ---------- HTTP behaviour against a fake vLLM ----------

class FakeVLLM(BaseHTTPRequestHandler):
    text = load("eval_review_4b_rp1.1.json")[67]["text"]  # problem 67, answer 10
    last_body: dict = {}

    def log_message(self, *args):
        pass

    def do_POST(self):
        FakeVLLM.last_body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        pieces = [self.text[i:i + 17] for i in range(0, len(self.text), 17)]
        for i, piece in enumerate(pieces):
            choice = {"index": 0, "text": piece, "finish_reason": "stop" if i == len(pieces) - 1 else None}
            self.wfile.write(f"data: {json.dumps({'choices': [choice], 'usage': None})}\n\n".encode())
        self.wfile.write(f"data: {json.dumps({'choices': [], 'usage': {'completion_tokens': 731}})}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")


@pytest.fixture(scope="session")
def client(router):
    from fastapi.testclient import TestClient

    server = ThreadingHTTPServer(("127.0.0.1", FAKE_VLLM_PORT), FakeVLLM)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield TestClient(router.app)
    server.shutdown()


AUTH = {"Authorization": f"Bearer {KEY}"}


def events(response) -> list:
    return [json.loads(line[6:]) for line in response.text.split("\n") if line.startswith("data: ")]


def test_health_lists_models_without_a_key(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"ok": True, "models": ["4b-review", "4b-base", "4b-cot"]}


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": KEY}])
def test_generate_needs_the_key(client, headers):
    assert client.post("/generate", json={"model": "4b-review", "question": "x"}, headers=headers).status_code == 401


def test_unknown_model_is_404(client):
    assert client.post("/generate", json={"model": "nope", "question": "x"}, headers=AUTH).status_code == 404


@pytest.mark.parametrize("question", ["", "   ", "x" * 3001])
def test_bad_question_is_422(client, question):
    assert client.post("/generate", json={"model": "4b-review", "question": question}, headers=AUTH).status_code == 422


def test_stream_passes_text_through_and_ends_with_graded_done(client):
    r = client.post("/generate", json={"model": "4b-review", "question": "Q?", "reference": "10"}, headers=AUTH)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    ev = events(r)
    assert "".join(e["text"] for e in ev if e["type"] == "token") == FakeVLLM.text
    done = ev[-1]
    assert done["type"] == "done"
    assert done["final_answer"] == "10" and done["correct"] is True
    assert done["first_answer"] == "10\\%"
    assert done["fixed"] is False  # "10\%" already counts as 10 for math_verify
    assert done["finished"] is True and done["tokens"] == 731
    # what reached vLLM: the eval prompt, the eval decoding, the right model
    sent = FakeVLLM.last_body
    assert sent["model"] == "4b-review" and sent["prompt"] == "[Question] Q?\n"
    assert sent["temperature"] == 0.0 and sent["repetition_penalty"] == 1.1 and sent["max_tokens"] == 3072


def test_no_reference_means_no_grade(client):
    done = events(client.post("/generate", json={"model": "4b-cot", "question": "Q?"}, headers=AUTH))[-1]
    assert done["correct"] is None and done["fixed"] is None


def test_base_model_gets_the_base_prompt(client):
    client.post("/generate", json={"model": "4b-base", "question": "Q?"}, headers=AUTH)
    assert FakeVLLM.last_body["prompt"].startswith("Question: Q?\n") and FakeVLLM.last_body["max_tokens"] == 2048
