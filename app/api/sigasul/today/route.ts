// FILE: app/api/sigasul/today/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sigasul/today?date=2026-03-25
 *
 * Retorna apenas a jornada simplificada do dia.
 * O status em tempo real (online/ignicao/velocidade) vem do
 * sigasul_dashboard_latest via Supabase — não precisa chamar
 * controls/all aqui (o cron já faz isso a cada 1 minuto).
 */

const BASE  = process.env.SIGASUL_BASE_URL  || "https://gestao.sigasul.com.br";
const TOKEN = process.env.SIGASUL_API_TOKEN || "";

function pad2(n: number) { return String(n).padStart(2, "0"); }

function todayBRT() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return `${brt.getUTCFullYear()}-${pad2(brt.getUTCMonth() + 1)}-${pad2(brt.getUTCDate())}`;
}

export async function GET(req: Request) {
  if (!TOKEN) {
    return Response.json({ error: "SIGASUL_API_TOKEN não configurado" }, { status: 500 });
  }

  const url  = new URL(req.url);
  const date = url.searchParams.get("date") || todayBRT();

  const start = `${date} 00:00:00`;
  const end   = `${date} 23:59:59`;

  const sigasulUrl = `${BASE}/api/jornadas/simplificada/${encodeURIComponent(start)}/${encodeURIComponent(end)}`;

  try {
    const res = await fetch(sigasulUrl, {
      headers: { "x-auth-token": TOKEN, "accept": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      return Response.json(
        { error: `Sigasul ${res.status}`, simplificada: [], positions: [] },
        { status: 200 } // retorna 200 pra não quebrar o page
      );
    }

    const data = await res.json();
    return Response.json({
      date,
      simplificada: Array.isArray(data) ? data : [],
      positions: [], // status em tempo real vem do dashboard_latest via Supabase
    }, {
      headers: { "Cache-Control": "no-store" },
    });

  } catch (e: any) {
    return Response.json({
      error: e.message,
      simplificada: [],
      positions: [],
    }, { status: 200 });
  }
}
