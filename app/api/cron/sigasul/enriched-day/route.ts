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

  // opcional: trava simples por frequência mínima
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

  const sql = `
with all_equips as (
  select
    dl.pos_equip_id,
    dl.codigo_equipamento,
    dl.pos_placa
  from public.sigasul_dashboard_latest dl
  where dl.codigo_equipamento is not null
),
raw as (
  select
    r.pos_id_ref,
    r.pos_equip_id,
    e.codigo_equipamento,
    coalesce(r.pos_placa, e.pos_placa) as placa,
    coalesce(r.gps_at, r.receb_at, r.ingested_at) as ponto_at,
    ((coalesce(r.gps_at, r.receb_at, r.ingested_at) at time zone 'America/Sao_Paulo'))::date as dia_brt,
    r.pos_latitude,
    r.pos_longitude,
    r.pos_ignicao,
    r.pos_online,
    r.pos_velocidade,
    r.pos_tensao,
    r.pos_nome_motorista
  from public.sigasul_positions_raw r
  join all_equips e
    on e.pos_equip_id = r.pos_equip_id
  where coalesce(r.gps_at, r.receb_at, r.ingested_at) is not null
    and r.pos_latitude is not null
    and r.pos_longitude is not null
    and ((coalesce(r.gps_at, r.receb_at, r.ingested_at) at time zone 'America/Sao_Paulo'))::date = $1::date
    and not exists (
      select 1
      from public.sigasul_points_enriched_day d
      where d.pos_id_ref = r.pos_id_ref
    )
),
nearest_obra as (
  select
    r.pos_id_ref,
    near.id as obra_id,
    near.obra,
    near.cidade,
    near.uf,
    near.lat as obra_lat,
    near.lng as obra_lng,
    near.raio_usado_m,
    near.distancia_m
  from raw r
  left join lateral (
    select
      o.id,
      o.obra,
      o.cidade,
      o.uf,
      o.lat,
      o.lng,
      coalesce(o.raio_m, 500)::double precision as raio_usado_m,
      (6371000.0 * 2.0)::double precision *
      asin(
        sqrt(
          power(sin(radians((r.pos_latitude - o.lat) / 2.0)), 2.0) +
          cos(radians(r.pos_latitude)) *
          cos(radians(o.lat)) *
          power(sin(radians((r.pos_longitude - o.lng) / 2.0)), 2.0)
        )
      ) as distancia_m
    from public.obras o
    where o.ativo = true
      and o.lat is not null
      and o.lng is not null
    order by distancia_m, o.id
    limit 1
  ) near on true
),
ins as (
  insert into public.sigasul_points_enriched_day (
    dia_brt,
    pos_id_ref,
    pos_equip_id,
    codigo_equipamento,
    placa,
    ponto_at,
    pos_latitude,
    pos_longitude,
    pos_ignicao,
    pos_online,
    pos_velocidade,
    pos_tensao,
    pos_nome_motorista,
    obra_id,
    obra_proxima,
    obra_cidade,
    obra_uf,
    obra_lat,
    obra_lng,
    raio_usado_m,
    distancia_m,
    obra_calc,
    obra_norm
  )
  select
    r.dia_brt,
    r.pos_id_ref,
    r.pos_equip_id,
    r.codigo_equipamento,
    r.placa,
    r.ponto_at,
    r.pos_latitude,
    r.pos_longitude,
    r.pos_ignicao,
    r.pos_online,
    r.pos_velocidade,
    r.pos_tensao,
    r.pos_nome_motorista,
    no.obra_id,
    no.obra as obra_proxima,
    no.cidade as obra_cidade,
    no.uf as obra_uf,
    no.obra_lat,
    no.obra_lng,
    no.raio_usado_m,
    no.distancia_m,
    case
      when no.distancia_m is not null and no.distancia_m <= no.raio_usado_m then no.obra
      else null
    end as obra_calc,
    case
      when no.distancia_m is not null and no.distancia_m <= no.raio_usado_m then btrim(no.obra)
      else null
    end as obra_norm
  from raw r
  left join nearest_obra no
    on no.pos_id_ref = r.pos_id_ref
  on conflict (pos_id_ref) do nothing
  returning pos_id_ref, codigo_equipamento
)
select
  count(*)::int as inserted_rows,
  count(distinct codigo_equipamento)::int as inserted_equips
from ins;
`;

  const { data, error } = await supabase.rpc("exec_sql", {
    sql,
    params: [targetDate],
  } as never);

  if (error) {
    await supabase
      .from("sigasul_ingest_state")
      .upsert(
        {
          stream_key: "points_enriched_day_v1",
          last_run_at: new Date().toISOString(),
          last_status: "error",
          last_error: error.message,
        },
        { onConflict: "stream_key" }
      );

    return Response.json(
      { ok: false, error: `exec_sql: ${error.message}`, date: targetDate },
      { status: 500 }
    );
  }

  const row =
    Array.isArray(data) && data.length > 0
      ? data[0]
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
