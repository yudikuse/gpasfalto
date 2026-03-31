// FILE: app/api/cron/sigasul/daily/backfill/route.ts
// Chama o daily para um range de datas
// Uso: /api/cron/sigasul/daily/backfill?from=2026-03-24&to=2026-03-30&secret=XXX

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);

  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    const qs   = url.searchParams.get("secret") || "";
    if (auth !== `Bearer ${cronSecret}` && qs !== cronSecret) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");

  if (!from || !to) {
    return Response.json({
      ok: false,
      error: "Informe ?from=YYYY-MM-DD&to=YYYY-MM-DD",
    }, { status: 400 });
  }

  const secret = url.searchParams.get("secret") || "";
  const baseUrl = `${url.protocol}//${url.host}`;

  const results: any[] = [];
  const current = new Date(from + "T12:00:00Z");
  const end     = new Date(to   + "T12:00:00Z");

  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10);

    try {
      const res = await fetch(
        `${baseUrl}/api/cron/sigasul/daily?date=${dateStr}&secret=${secret}`,
        { signal: AbortSignal.timeout(30000) }
      );
      const data = await res.json();
      results.push({ date: dateStr, ...data });
    } catch (e: any) {
      results.push({ date: dateStr, ok: false, error: e.message });
    }

    // Aguarda 2s entre chamadas para não bater rate limit da Sigasul
    await new Promise((r) => setTimeout(r, 2000));

    current.setUTCDate(current.getUTCDate() + 1);
  }

  const ok    = results.filter((r) => r.ok).length;
  const fail  = results.filter((r) => !r.ok).length;

  return Response.json({ ok: true, total: results.length, ok_count: ok, fail_count: fail, results });
}
