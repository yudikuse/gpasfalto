// FILE: app/api/sigasul/today/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sigasul/today?date=2026-03-24
 *
 * Retorna dados combinados para o dashboard:
 * - jornadas/simplificada → KM e tempo ligado acumulados do dia
 * - v2/positions/controls/all → status atual de cada veículo
 */

const BASE  = process.env.SIGASUL_BASE_URL  || "https://gestao.sigasul.com.br";
const TOKEN = process.env.SIGASUL_API_TOKEN || "";

function pad2(n: number) { return String(n).padStart(2, "0"); }

function todayBRT() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return `${brt.getUTCFullYear()}-${pad2(brt.getUTCMonth() + 1)}-${pad2(brt.getUTCDate())}`;
}

async function fetchSigasul(url: string) {
  const res = await fetch(url, {
    headers: { "x-auth-token": TOKEN, "accept": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Sigasul ${res.status}: ${url}`);
  return res.json();
}

export async function GET(req: Request) {
  if (!TOKEN) {
    return Response.json({ error: "SIGASUL_API_TOKEN não configurado" }, { status: 500 });
  }

  const url  = new URL(req.url);
  const date = url.searchParams.get("date") || todayBRT();

  const start = `${date} 00:00:00`;
  const end   = `${date} 23:59:59`;

  // Chama as duas APIs em paralelo
  const [simplificada, positions] = await Promise.allSettled([
    fetchSigasul(`${BASE}/api/jornadas/simplificada/${encodeURIComponent(start)}/${encodeURIComponent(end)}`),
    fetchSigasul(`${BASE}/api/v2/positions/controls/all/`),
  ]);

  return Response.json({
    date,
    simplificada: simplificada.status === "fulfilled" ? simplificada.value : [],
    positions:    positions.status    === "fulfilled" ? positions.value    : [],
    errors: {
      simplificada: simplificada.status === "rejected" ? simplificada.reason?.message : null,
      positions:    positions.status    === "rejected" ? positions.reason?.message    : null,
    },
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
