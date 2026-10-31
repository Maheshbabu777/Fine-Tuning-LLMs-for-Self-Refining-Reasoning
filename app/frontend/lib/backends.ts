// Server-side only. Two Kaggle accounts each run notebook 09: A serves the 4B models, B the 2B models.
// The site asks each one which models it has, so a model can move between accounts without changing this code.
export type Backend = { url: string; online: boolean; models: string[] };

const HEADERS = { "ngrok-skip-browser-warning": "1" }; // skip ngrok's free-plan warning page

export function backendUrls(): string[] {
  return [process.env.BACKEND_URL_A, process.env.BACKEND_URL_B, process.env.BACKEND_URL]
    .filter((u): u is string => !!u)
    .map((u) => u.replace(/\/$/, ""));
}

async function check(url: string): Promise<Backend> {
  try {
    const res = await fetch(`${url}/health`, { headers: HEADERS, cache: "no-store", signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return { url, online: res.ok && data.ok === true, models: Array.isArray(data.models) ? data.models : [] };
  } catch {
    return { url, online: false, models: [] };
  }
}

// Cached for 20 s so each question doesn't wait for two health checks.
let cache: { at: number; backends: Backend[] } | null = null;

export async function getBackends(fresh = false): Promise<Backend[]> {
  if (!fresh && cache && Date.now() - cache.at < 20000) return cache.backends;
  const backends = await Promise.all(backendUrls().map(check));
  cache = { at: Date.now(), backends };
  return backends;
}

export async function findBackend(model: string): Promise<Backend | null> {
  const pick = (bs: Backend[]) => bs.find((b) => b.online && b.models.includes(model)) ?? null;
  return pick(await getBackends()) ?? pick(await getBackends(true)); // retry once in case a server just came online
}
