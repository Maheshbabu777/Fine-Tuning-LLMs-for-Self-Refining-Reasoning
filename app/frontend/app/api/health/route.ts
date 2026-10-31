import { getBackends } from "@/lib/backends";

// Tells the UI which models are online right now, across both Kaggle servers.
export async function GET() {
  const backends = await getBackends(true);
  const models = [...new Set(backends.filter((b) => b.online).flatMap((b) => b.models))];
  return Response.json({ online: models.length > 0, models, servers: backends.map((b) => b.online) });
}
