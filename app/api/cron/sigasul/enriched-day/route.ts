// FILE: app/api/cron/sigasul/enriched-day/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayBRT() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return `${brt.getUTCFullYear()}-${pad2(brt.getUTCMonth() + 1)}-${pad2(brt.getUTCDate())}`;
}

function isValidDateYYYYMMDD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    const qs = url.searchParams.get("secret") || "";
    if (auth !== `Bearer ${cronSecret}` && qs !== cronSecret) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return Response.json({ ok: false, error: "missing_supabase_env" }, { status: 500 });
  }

  const targetDate = url.searchParams.get("date") || todayBRT();
  if (!isValidDateYYYYMMDD(targetDate)) {
    return Response.json(
      { ok: false, error: "invalid_date_format_use_YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startedAt = Date.now();

  const { data: state, error: stateErr } = await supabase
    .from("sigasul_ingest_state")
    .select("last_run_at")
    .eq("stream_key", "points_enriched_day_v1")
    .maybeSingle();

  if (stateErr) {
    return Response.json(
      { ok: false, error: `ingest_state_read: ${stateErr.message}` },
      { status: 500 }
    );
  }

  const force = url.searchParams.get("force") === "1";
  const lastRunAt = state?.last_run_at ? new Date(state.last_run_at).getTime() : 0;

  if (!force && lastRunAt && Date.now() - lastRunAt < 40_000) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "too_soon",
      date: targetDate,
    });
  }

  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "populate_sigasul_points_enriched_day",
    { p_target_date: targetDate }
  );

  if (rpcErr) {
    await supabase
      .from("sigasul_ingest_state")
      .upsert(
        {
          stream_key: "points_enriched_day_v1",
          last_run_at: new Date().toISOString(),
          last_status: "error",
          last_error: rpcErr.message,
        },
        { onConflict: "stream_key" }
      );

    return Response.json(
      { ok: false, error: `populate_rpc: ${rpcErr.message}`, date: targetDate },
      { status: 500 }
    );
  }

  const row =
    Array.isArray(rpcData) && rpcData.length > 0
      ? rpcData[0]
      : { inserted_rows: 0, inserted_equips: 0 };

  const { count: totalToday, error: totalErr } = await supabase
    .from("sigasul_points_enriched_day")
    .select("*", { count: "exact", head: true })
    .eq("dia_brt", targetDate);

  if (totalErr) {
    await supabase
      .from("sigasul_ingest_state")
      .upsert(
        {
          stream_key: "points_enriched_day_v1",
          last_run_at: new Date().toISOString(),
          last_status: "error",
          last_error: totalErr.message,
        },
        { onConflict: "stream_key" }
      );

    return Response.json(
      { ok: false, error: `count_today: ${totalErr.message}`, date: targetDate },
      { status: 500 }
    );
  }

  await supabase
    .from("sigasul_ingest_state")
    .upsert(
      {
        stream_key: "points_enriched_day_v1",
        last_run_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
      },
      { onConflict: "stream_key" }
    );

  return Response.json({
    ok: true,
    date: targetDate,
    inserted_rows: Number(row?.inserted_rows || 0),
    inserted_equips: Number(row?.inserted_equips || 0),
    total_today: totalToday || 0,
    elapsed_ms: Date.now() - startedAt,
  });
}

export async function POST(req: Request) {
  return GET(req);
}
