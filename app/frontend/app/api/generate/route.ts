import { backendUrls, findBackend } from "@/lib/backends";

// Proxy to the Kaggle server that has the model. Backend URLs and the key stay on the server, the browser never sees them.
export const maxDuration = 300; // Vercel Hobby maximum; a long self-refine answer takes 1 to 3 minutes on a T4

const OFFLINE = "This model's server is offline right now. It runs on a free Kaggle GPU that is switched on for demos.";

export async function POST(req: Request) {
  const key = process.env.APP_API_KEY;
  if (!key || backendUrls().length === 0)
    return Response.json({ error: "Server is not configured (BACKEND_URL_A, BACKEND_URL_B, APP_API_KEY)." }, { status: 500 });

  const body = await req.json().catch(() => null);
  const { model, question, reference } = body ?? {};
  if (typeof model !== "string" || typeof question !== "string" || !question.trim())
    return Response.json({ error: "Send a model and a question." }, { status: 400 });
  if (question.length > 3000) return Response.json({ error: "Question is too long (max 3,000 characters)." }, { status: 422 });

  const backend = await findBackend(model);
  if (!backend) return Response.json({ error: OFFLINE }, { status: 503 });

  let upstream: Response;
  try {
    upstream = await fetch(`${backend.url}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "ngrok-skip-browser-warning": "1" },
      body: JSON.stringify({ model, question, reference: typeof reference === "string" ? reference : undefined }),
      signal: req.signal, // Stop in the browser cancels the generation on the GPU
    });
  } catch {
    return Response.json({ error: OFFLINE }, { status: 503 });
  }

  if (!upstream.ok || !upstream.body) {
    const data = await upstream.json().catch(() => null);
    if (data?.detail) return Response.json({ error: String(data.detail) }, { status: upstream.status });
    return Response.json({ error: OFFLINE }, { status: 503 }); // ngrok answers with an HTML page when the tunnel is down
  }

  return new Response(upstream.body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}
