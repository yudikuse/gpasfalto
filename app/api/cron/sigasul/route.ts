// FILE: app/api/cron/sigasul/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

type Cerca = { pos_cerca_id: number; pos_cerca_nome: string };

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseBRToISO(dt: string | null | undefined, offset = "-03:00") {
  if (!dt) return null;
  const m1 = dt.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m1) { const [,dd,mm,yyyy,HH,MI,SS] = m1; return `${yyyy}-${mm}-${dd}T${HH}:${MI}:${SS}${offset}`; }
  const m2 = dt.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m2) { const [,yyyy,mm,dd,HH,MI,SS] = m2; return `${yyyy}-${mm}-${dd}T${HH}:${MI}:${SS}${offset}`; }
  return null;
}

function parseUTCToISO(dt: string | null | undefined) {
  if (!dt) return null;
  const m1 = dt.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m1) { const [,dd,mm,yyyy,HH,MI,SS] = m1; return `${yyyy}-${mm}-${dd}T${HH}:${MI}:${SS}Z`; }
  const m2 = dt.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m2) { const [,yyyy,mm,dd,HH,MI,SS] = m2; return `${yyyy}-${mm}-${dd}T${HH}:${MI}:${SS}Z`; }
  return null;
}

function getTele(p: any): Record<string, any> {
  return (p?.pos_telemetria ?? p?.telemetria ?? p?.tele ?? {}) as Record<string, any>;
}

function pickObraFromCercas(
  cercas: Cerca[] | null | undefined,
  cercaMap: Map<number, { obra: string; pos_cerca_nome: string }>
) {
  if (!Array.isArray(cercas) || cercas.length === 0) return { cerca_id_ativa: null, cerca_nome_ativa: null, obra: null };
  for (const c of cercas) {
    const hit = cercaMap.get(Number(c.pos_cerca_id));
    if (hit) return { cerca_id_ativa: Number(c.pos_cerca_id), cerca_nome_ativa: c.pos_cerca_nome ?? hit.pos_cerca_nome, obra: hit.obra };
  }
  const first = cercas[0];
  return { cerca_id_ativa: Number(first.pos_cerca_id), cerca_nome_ativa: first.pos_cerca_nome ?? null, obra: null };
}

function extractPositions(json: any): any[] | null {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json?.positions)) return json.positions;
  if (Array.isArray(json?.itens)) return json.itens;
  return null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";

    const cronSecret = process.env.CRON_SECRET || "";
    if (cronSecret) {
      const authHeader = req.headers.get("authorization") || "";
      const secretQS = url.searchParams.get("secret") || "";
      if (authHeader !== `Bearer ${cronSecret}` && secretQS !== cronSecret) {
        return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
    }

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const SIGASUL_BASE_URL = process.env.SIGASUL_BASE_URL || "https://gestao.sigasul.com.br";
    const SIGASUL_API_TOKEN = process.env.SIGASUL_API_TOKEN!;
    const TZ_OFFSET = process.env.SIGASUL_TZ_OFFSET || "-03:00";

    if (!SUPABASE_URL || !SERVICE_ROLE) return Response.json({ ok: false, error: "missing_supabase_env" }, { status: 500 });
    if (!SIGASUL_API_TOKEN) return Response.json({ ok: false, error: "missing_sigasul_token" }, { status: 500 });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: state, error: stateErr } = await supabase
      .from("sigasul_ingest_state")
      .select("last_pos_id_ref,last_run_at")
      .eq("stream_key", "positions_controls_v2")
      .maybeSingle();

    if (stateErr) throw stateErr;

    const lastId = state?.last_pos_id_ref ?? null;
    const lastRunAt = state?.last_run_at ? new Date(state.last_run_at).getTime() : 0;

    if (Date.now() - lastRunAt < 35_000) {
      return Response.json({ ok: true, skipped: true, reason: "too_soon" });
    }

    const { data: cercasMapRows } = await supabase
      .from("sigasul_cerca_map")
      .select("pos_cerca_id,pos_cerca_nome,obra")
      .eq("ativo", true);

    const cercaMap = new Map<number, { obra: string; pos_cerca_nome: string }>();
    for (const r of cercasMapRows || []) {
      cercaMap.set(Number(r.pos_cerca_id), { obra: r.obra, pos_cerca_nome: r.pos_cerca_nome });
    }

    const endpoint = `${SIGASUL_BASE_URL}/api/v2/positions/controls/all/`;
    const now = new Date().toISOString();
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20000);

    try {
      const resp = await fetch(endpoint, {
        method: "GET",
        headers: { "x-auth-token": SIGASUL_API_TOKEN, accept: "application/json" },
        signal: ac.signal,
      });

      const status = resp.status;
      const text = await resp.text();
      const json = (() => { try { return JSON.parse(text); } catch { return null; } })();

      if (status === 400 && typeof json === "string" && json.toLowerCase().includes("limite excedido")) {
        await supabase.from("sigasul_ingest_state")
          .update({ last_run_at: now, last_status: "rate_limited", last_error: "rate_limited" })
          .eq("stream_key", "positions_controls_v2");
        return Response.json({ ok: true, rate_limited: true });
      }

      const arr = extractPositions(json);
      if (!Array.isArray(arr)) {
        await supabase.from("sigasul_ingest_state")
          .update({ last_run_at: now, last_status: "error", last_error: `bad_response_${status}` })
          .eq("stream_key", "positions_controls_v2");
        return Response.json({ ok: false, error: "bad_response", status }, { status: 502 });
      }

      let maxId = lastId ?? 0;

      const rows = arr.map((p) => {
        const pos_id_ref = Number(p?.pos_id_ref);
        if (!pos_id_ref || Number.isNaN(pos_id_ref)) return null;
        if (pos_id_ref > maxId) maxId = pos_id_ref;

        const cercas = (p?.pos_cercas ?? []) as Cerca[];
        const { cerca_id_ativa, cerca_nome_ativa, obra } = pickObraFromCercas(cercas, cercaMap);
        const tele = getTele(p);

        return {
          pos_id_ref,
          pos_equip_id: p?.pos_equip_id ?? null,
          pos_placa: p?.pos_placa ?? null,
          pos_equip_modelo: p?.pos_equip_modelo ?? null,
          pos_nome_motorista: p?.pos_nome_motorista ?? null,
          pos_cliente_id: p?.pos_cliente_id ?? null,
          pos_cliente_nome: p?.pos_cliente_nome ?? null,
          pos_data_hora_gps: p?.pos_data_hora_gps ?? null,
          pos_data_hora_gps_utc: p?.pos_data_hora_gps_utc ?? null,
          pos_data_hora_receb: p?.pos_data_hora_receb ?? null,
          gps_at: parseBRToISO(p?.pos_data_hora_gps, TZ_OFFSET),
          gps_utc_at: parseUTCToISO(p?.pos_data_hora_gps_utc),
          receb_at: parseBRToISO(p?.pos_data_hora_receb, "-03:00"),
          pos_latitude: p?.pos_latitude ?? null,
          pos_longitude: p?.pos_longitude ?? null,
          pos_ignicao: p?.pos_ignicao ?? null,
          pos_online: p?.pos_online ?? null,
          pos_tensao: p?.pos_tensao ?? null,
          pos_qt_satelites: p?.pos_qt_satelites ?? null,
          pos_velocidade: p?.pos_velocidade ?? null,
          pos_odometro: p?.pos_odometro ?? null,
          pos_odometro_calc: p?.pos_odometro_calc ?? null,
          cerca_id_ativa,
          cerca_nome_ativa,
          obra,
          tele_odometro: tele?.tele_odometro ?? null,
          tele_horimetro: tele?.tele_horimetro ?? null,
          tele_rpm: tele?.tele_rpm ?? null,
          tele_velocidade: tele?.tele_velocidade ?? null,
          tele_combustivel_vida: tele?.tele_combustivel_vida ?? null,
          tele_percent_combustivel: tele?.tele_percent_combustivel ?? null,
          payload: p,
          // ← NOVO: sempre atualiza quando o veículo aparece no controls/all
          last_seen_at: now,
        };
      }).filter(Boolean) as any[];

      // ← MUDANÇA: ignoreDuplicates: false + DO UPDATE para last_seen_at
      for (const c of chunk(rows, 500)) {
        const { error } = await supabase
          .from("sigasul_positions_raw")
          .upsert(c, {
            onConflict: "pos_id_ref",
            ignoreDuplicates: false, // ← permite atualizar last_seen_at
          });
        if (error) throw error;
      }

      await supabase.from("sigasul_ingest_state")
        .update({ last_pos_id_ref: maxId || lastId, last_run_at: now, last_status: "ok", last_error: null })
        .eq("stream_key", "positions_controls_v2");

      return Response.json({
        ok: true,
        used_url: endpoint,
        rows_received: arr.length,
        rows_upserted: rows.length,
        debug: debug ? { sample: rows[0] } : undefined,
      });

    } catch (e: any) {
      await supabase.from("sigasul_ingest_state")
        .update({ last_run_at: now, last_status: "error", last_error: "fetch_failed" })
        .eq("stream_key", "positions_controls_v2");
      return Response.json({ ok: false, error: "fetch_failed", detail: e?.message }, { status: 502 });
    } finally {
      clearTimeout(t);
    }
  } catch (err: any) {
    return Response.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) { return GET(req); }
