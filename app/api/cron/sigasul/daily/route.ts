// FILE: app/api/cron/sigasul/daily/route.ts
// Roda às 23:50 BRT (02:50 UTC) — consolida o dia:
// 1. Totais por equip (km, tempo, primeira/última ignição) → sigasul_daily_summary
// 2. Eventos de entrada/saída por obra                    → sigasul_geofence_events

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

const BASE  = process.env.SIGASUL_BASE_URL  || "https://gestao.sigasul.com.br";
const TOKEN = process.env.SIGASUL_API_TOKEN || "";

function pad2(n: number) { return String(n).padStart(2, "0"); }

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

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!SUPABASE_URL || !SERVICE_ROLE) return Response.json({ ok: false, error: "missing_supabase_env" }, { status: 500 });
  if (!TOKEN) return Response.json({ ok: false, error: "missing_sigasul_token" }, { status: 500 });

  const targetDate = url.searchParams.get("date") || todayBRT();
  const start = `${targetDate} 00:00:00`;
  const end   = `${targetDate} 23:59:59`;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 1. Equipamentos cadastrados ──────────────────────────────────
  const { data: placaCodigos } = await supabase
    .from("sigasul_placa_codigo")
    .select("pos_placa, codigo");

  const allEquips = new Map<string, string>();
  for (const r of placaCodigos ?? []) allEquips.set(r.pos_placa, r.codigo);

  const { data: equipsRaw } = await supabase
    .from("sigasul_positions_raw")
    .select("pos_equip_id, pos_placa")
    .in("pos_placa", Array.from(allEquips.keys()));

  const placaToEquipId = new Map<string, string>();
  for (const r of equipsRaw ?? []) {
    if (r.pos_equip_id && r.pos_placa) placaToEquipId.set(r.pos_placa, r.pos_equip_id);
  }

  // ── 2. Obra mais frequente por equipamento ───────────────────────
  const { data: posicoesDia } = await supabase
    .from("sigasul_positions_raw")
    .select("pos_equip_id, obra")
    .gte("last_seen_at", `${targetDate}T00:00:00-03:00`)
    .lte("last_seen_at", `${targetDate}T23:59:59-03:00`);

  const obraCount = new Map<string, Map<string, number>>();
  for (const p of posicoesDia ?? []) {
    if (!p.pos_equip_id || !p.obra) continue;
    if (!obraCount.has(p.pos_equip_id)) obraCount.set(p.pos_equip_id, new Map());
    const m = obraCount.get(p.pos_equip_id)!;
    m.set(p.obra, (m.get(p.obra) ?? 0) + 1);
  }

  function obraPrincipal(equip_id: string): string {
    const m = obraCount.get(equip_id);
    if (!m || m.size === 0) return "SEM OBRA";
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  // ── 3. Simplificada → totais do dia ─────────────────────────────
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
  } catch (e) { console.error("simplificada:", e); }

  type Agg = { km_metros: number; tempo_ligado_sec: number; primeira_ignicao: string | null; ultima_ignicao: string | null; trabalhou: boolean; };
  const byPlaca = new Map<string, Agg>();

  for (const v of simplificada) {
    const placa = (v.placa as string)?.toUpperCase();
    if (!placa || !v.eventos?.length) continue;
    const ev = v.eventos as any[];
    byPlaca.set(placa, {
      km_metros:        ev.reduce((a: number, e: any) => a + Math.max(0, e.distancia ?? 0), 0),
      tempo_ligado_sec: ev.reduce((a: number, e: any) => a + hhmmssToSec(e.tempoLigado), 0),
      primeira_ignicao: ev[0]?.data_hora_inicial?.split(" ")[1] ?? null,
      ultima_ignicao:   ev[ev.length - 1]?.data_hora_final?.split(" ")[1] ?? null,
      trabalhou:        true,
    });
  }

  // ── 4. Upsert daily_summary ──────────────────────────────────────
  const summaryRows = Array.from(allEquips.entries()).map(([placa, codigo]) => {
    const equip_id = placaToEquipId.get(placa) ?? placa;
    const agg = byPlaca.get(placa.toUpperCase()) ?? { km_metros: 0, tempo_ligado_sec: 0, primeira_ignicao: null, ultima_ignicao: null, trabalhou: false };
    return {
      dia: targetDate, pos_equip_id: equip_id, codigo, placa,
      obra: obraPrincipal(equip_id),
      km_metros:        agg.km_metros,
      tempo_ligado_sec: agg.tempo_ligado_sec,
      primeira_ignicao: agg.primeira_ignicao,
      ultima_ignicao:   agg.ultima_ignicao,
      trabalhou:        agg.trabalhou,
    };
  });

  const { error: summaryErr } = await supabase
    .from("sigasul_daily_summary")
    .upsert(summaryRows, { onConflict: "dia,pos_equip_id" });

  if (summaryErr) return Response.json({ ok: false, error: `summary: ${summaryErr.message}` }, { status: 500 });

  // ── 5. Geofence events do dia via view ───────────────────────────
  const { data: gfEvents, error: gfErr } = await supabase
    .from("sigasul_geofence_events_v")
    .select("pos_equip_id,codigo_equipamento,placa,evento_at,hora_brt,evento,obra,obra_origem,obra_destino,motorista,velocidade,tensao,pos_id_ref")
    .eq("dia_brt", targetDate);

  if (gfErr) {
    console.error("geofence_events_v:", gfErr.message);
    // Não falha o cron — salva o summary e avisa
    return Response.json({
      ok: true,
      dia: targetDate,
      summary_ok: true,
      geofence_ok: false,
      geofence_error: gfErr.message,
      equips_total: summaryRows.length,
      equips_trabalharam: summaryRows.filter((r) => r.trabalhou).length,
    });
  }

  // Upsert geofence events
  if (gfEvents && gfEvents.length > 0) {
    const gfRows = gfEvents.map((e: any) => ({
      dia:         targetDate,
      pos_equip_id: e.pos_equip_id,
      codigo:      e.codigo_equipamento,
      placa:       e.placa,
      evento_at:   e.evento_at,
      hora_brt:    e.hora_brt,
      evento:      e.evento,
      obra:        e.obra,
      obra_origem: e.obra_origem,
      obra_destino:e.obra_destino,
      motorista:   e.motorista,
      velocidade:  e.velocidade,
      tensao:      e.tensao,
      pos_id_ref:  e.pos_id_ref,
    }));

    const { error: gfUpsertErr } = await supabase
      .from("sigasul_geofence_events")
      .upsert(gfRows, { onConflict: "pos_id_ref,evento" });

    if (gfUpsertErr) console.error("geofence upsert:", gfUpsertErr.message);
  }

  return Response.json({
    ok: true,
    dia: targetDate,
    equips_total:         summaryRows.length,
    equips_trabalharam:   summaryRows.filter((r) => r.trabalhou).length,
    geofence_events:      gfEvents?.length ?? 0,
  });
}

export async function POST(req: Request) { return GET(req); }
