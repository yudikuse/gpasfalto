// FILE: app/api/cron/sigasul/daily/route.ts
// Roda às 23:50 BRT (02:50 UTC) — consolida o dia:
// 1. Totais por equip (km, tempo, primeira/última ignição) → sigasul_daily_summary
// 2. Eventos de entrada/saída por obra                    → sigasul_geofence_events

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.SIGASUL_BASE_URL || "https://gestao.sigasul.com.br";
const TOKEN = process.env.SIGASUL_API_TOKEN || "";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayBRT() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return `${brt.getUTCFullYear()}-${pad2(brt.getUTCMonth() + 1)}-${pad2(brt.getUTCDate())}`;
}

function hhmmssToSec(s: string): number {
  if (!s || !s.match(/^\d{2}:\d{2}:\d{2}$/)) return 0;
  const [h, m, sec] = s.split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (sec || 0);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type GfEventRow = {
  pos_equip_id: string;
  codigo_equipamento: string;
  placa: string | null;
  evento_at: string;
  hora_brt: string | null;
  evento: string;
  obra: string | null;
  obra_origem: string | null;
  obra_destino: string | null;
  motorista: string | null;
  velocidade: number | null;
  tensao: number | null;
  pos_id_ref: number | null;
};

type DailyAgg = {
  km_metros: number;
  tempo_ligado_sec: number;
  primeira_ignicao: string | null;
  ultima_ignicao: string | null;
  trabalhou: boolean;
};

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
  if (!TOKEN) {
    return Response.json({ ok: false, error: "missing_sigasul_token" }, { status: 500 });
  }

  const targetDate = url.searchParams.get("date") || todayBRT();
  const start = `${targetDate} 00:00:00`;
  const end = `${targetDate} 23:59:59`;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 1. Cadastro base por código/placa ────────────────────────────
  const { data: placaCodigos, error: placaErr } = await supabase
    .from("sigasul_placa_codigo")
    .select("pos_placa, codigo");

  if (placaErr) {
    return Response.json({ ok: false, error: `placa_codigo: ${placaErr.message}` }, { status: 500 });
  }

  const codigoToPlaca = new Map<string, string>();
  for (const r of placaCodigos ?? []) {
    if (r.codigo && r.pos_placa) {
      codigoToPlaca.set(String(r.codigo), String(r.pos_placa));
    }
  }

  // ── 2. Mapear codigo -> pos_equip_id atual (1 por código) ───────
  const { data: latestRows, error: latestErr } = await supabase
    .from("sigasul_dashboard_latest")
    .select("pos_equip_id, codigo_equipamento, pos_placa");

  if (latestErr) {
    return Response.json({ ok: false, error: `dashboard_latest: ${latestErr.message}` }, { status: 500 });
  }

  const codigoToEquipId = new Map<string, string>();
  const codigoToLatestPlaca = new Map<string, string>();

  for (const r of latestRows ?? []) {
    const codigo = r.codigo_equipamento ? String(r.codigo_equipamento) : null;
    const equipId = r.pos_equip_id ? String(r.pos_equip_id) : null;
    const placa = r.pos_placa ? String(r.pos_placa) : null;
    if (!codigo || !equipId) continue;

    if (!codigoToEquipId.has(codigo)) {
      codigoToEquipId.set(codigo, equipId);
    }
    if (placa && !codigoToLatestPlaca.has(codigo)) {
      codigoToLatestPlaca.set(codigo, placa);
    }
  }

  // ── 3. Obra principal do dia usando BASE NOVA enriquecida ───────
  const { data: enrichedRows, error: enrichedErr } = await supabase
    .from("sigasul_points_enriched_day")
    .select("codigo_equipamento, obra_norm")
    .eq("dia_brt", targetDate);

  if (enrichedErr) {
    return Response.json({ ok: false, error: `points_enriched_day: ${enrichedErr.message}` }, { status: 500 });
  }

  const obraCountByCodigo = new Map<string, Map<string, number>>();

  for (const row of enrichedRows ?? []) {
    const codigo = row.codigo_equipamento ? String(row.codigo_equipamento) : null;
    const obra = row.obra_norm ? String(row.obra_norm).trim() : null;
    if (!codigo || !obra) continue;

    if (!obraCountByCodigo.has(codigo)) {
      obraCountByCodigo.set(codigo, new Map<string, number>());
    }

    const obraMap = obraCountByCodigo.get(codigo)!;
    obraMap.set(obra, (obraMap.get(obra) ?? 0) + 1);
  }

  function obraPrincipalPorCodigo(codigo: string): string {
    const obraMap = obraCountByCodigo.get(codigo);
    if (!obraMap || obraMap.size === 0) return "SEM OBRA";
    return [...obraMap.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  // ── 4. Simplificada → totais do dia por PLACA ────────────────────
  const sigasulUrl = `${BASE}/api/jornadas/simplificada/${encodeURIComponent(start)}/${encodeURIComponent(end)}`;

  let simplificada: any[] = [];
  try {
    const res = await fetch(sigasulUrl, {
      headers: { "x-auth-token": TOKEN, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) simplificada = data;
    }
  } catch (e) {
    console.error("simplificada:", e);
  }

  const byPlaca = new Map<string, DailyAgg>();

  for (const v of simplificada) {
    const placa = (v.placa as string | undefined)?.toUpperCase()?.trim();
    if (!placa || !Array.isArray(v.eventos) || v.eventos.length === 0) continue;

    const ev = v.eventos as any[];
    byPlaca.set(placa, {
      km_metros: ev.reduce((a: number, e: any) => a + Math.max(0, Number(e.distancia ?? 0)), 0),
      tempo_ligado_sec: ev.reduce((a: number, e: any) => a + hhmmssToSec(String(e.tempoLigado ?? "")), 0),
      primeira_ignicao: ev[0]?.data_hora_inicial?.split(" ")[1] ?? null,
      ultima_ignicao: ev[ev.length - 1]?.data_hora_final?.split(" ")[1] ?? null,
      trabalhou: true,
    });
  }

  // ── 5. Montar 1 resumo por CÓDIGO (não por pos_equip_id) ────────
  const allCodigos = Array.from(
    new Set([
      ...Array.from(codigoToPlaca.keys()),
      ...Array.from(codigoToEquipId.keys()),
      ...Array.from(obraCountByCodigo.keys()),
    ])
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const summaryRows = allCodigos.map((codigo) => {
    const placa =
      codigoToPlaca.get(codigo) ??
      codigoToLatestPlaca.get(codigo) ??
      null;

    const agg =
      (placa ? byPlaca.get(placa.toUpperCase()) : undefined) ?? {
        km_metros: 0,
        tempo_ligado_sec: 0,
        primeira_ignicao: null,
        ultima_ignicao: null,
        trabalhou: false,
      };

    return {
      dia: targetDate,
      pos_equip_id: codigoToEquipId.get(codigo) ?? codigo,
      codigo,
      placa,
      obra: obraPrincipalPorCodigo(codigo),
      km_metros: agg.km_metros,
      tempo_ligado_sec: agg.tempo_ligado_sec,
      primeira_ignicao: agg.primeira_ignicao,
      ultima_ignicao: agg.ultima_ignicao,
      trabalhou: agg.trabalhou,
    };
  });

  const { error: summaryErr } = await supabase
    .from("sigasul_daily_summary")
    .upsert(summaryRows, { onConflict: "dia,codigo" });

  if (summaryErr) {
    return Response.json({ ok: false, error: `summary: ${summaryErr.message}` }, { status: 500 });
  }

  // ── 6. Geofence events do dia via view nova (em lotes) ───────────
  const codigoList = summaryRows
    .map((r) => r.codigo)
    .filter((v): v is string => !!v)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  const batches = chunkArray(codigoList, 12);

  let geofenceOk = true;
  let geofenceError: string | null = null;
  let geofenceEventsTotal = 0;
  let geofenceBatchesOk = 0;
  let geofenceBatchesFail = 0;

  for (const batch of batches) {
    const { data: gfEvents, error: gfErr } = await supabase
      .from("sigasul_geofence_events_v")
      .select(
        "pos_equip_id,codigo_equipamento,placa,evento_at,hora_brt,evento,obra,obra_origem,obra_destino,motorista,velocidade,tensao,pos_id_ref"
      )
      .eq("dia_brt", targetDate)
      .in("codigo_equipamento", batch);

    if (gfErr) {
      geofenceOk = false;
      geofenceBatchesFail += 1;
      geofenceError = gfErr.message;
      console.error(`geofence_events_v batch [${batch.join(", ")}]:`, gfErr.message);
      continue;
    }

    const rows = (gfEvents ?? []) as GfEventRow[];
    geofenceEventsTotal += rows.length;
    geofenceBatchesOk += 1;

    if (rows.length === 0) continue;

    const gfRows = rows.map((e) => ({
      dia: targetDate,
      pos_equip_id: e.pos_equip_id,
      codigo: e.codigo_equipamento,
      placa: e.placa,
      evento_at: e.evento_at,
      hora_brt: e.hora_brt,
      evento: e.evento,
      obra: e.obra,
      obra_origem: e.obra_origem,
      obra_destino: e.obra_destino,
      motorista: e.motorista,
      velocidade: e.velocidade,
      tensao: e.tensao,
      pos_id_ref: e.pos_id_ref,
    }));

    const { error: gfUpsertErr } = await supabase
      .from("sigasul_geofence_events")
      .upsert(gfRows, { onConflict: "pos_id_ref,evento" });

    if (gfUpsertErr) {
      geofenceOk = false;
      geofenceBatchesFail += 1;
      geofenceError = gfUpsertErr.message;
      console.error(`geofence upsert batch [${batch.join(", ")}]:`, gfUpsertErr.message);
    }
  }

  return Response.json({
    ok: true,
    dia: targetDate,
    summary_ok: true,
    geofence_ok: geofenceOk,
    geofence_error: geofenceError,
    geofence_events: geofenceEventsTotal,
    geofence_batches_ok: geofenceBatchesOk,
    geofence_batches_fail: geofenceBatchesFail,
    equips_total: summaryRows.length,
    equips_trabalharam: summaryRows.filter((r) => r.trabalhou).length,
  });
}

export async function POST(req: Request) {
  return GET(req);
}
