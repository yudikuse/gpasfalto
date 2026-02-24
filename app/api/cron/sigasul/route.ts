// FILE: app/api/cron/sigasul/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

type Cerca = { pos_cerca_id: number; pos_cerca_nome: string };
type Telemetria = Record<string, any>;

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseBRToISO(dt: string | null | undefined, offset = "-03:00") {
  if (!dt) return null;

  // "DD/MM/YYYY HH:MM:SS"
  const m1 = dt.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m1) {
    const [, dd, mm, yyyy, HH, MI, SS] = m1;
    return `${yyyy}-${mm}-${dd}T${HH}:${MI}:${SS}${offset}`;
  }

  // "YYYY-MM-DD HH:MM:SS"
  const m2 = dt.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m2) {
    const [, yyyy, mm, dd, HH, MI, SS] = m2;
    return `${yyyy}-${mm}-${dd}T${HH}:${MI}:${SS}${offset}`;
  }

  return null;
}

function parseUTCToISO(dt: string | null | undefined) {
  if (!dt) return null;

  const m1 = dt.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m1) {
    const [, dd, mm, yyyy, HH, MI, SS] = m1;
    return `${yyyy}-${mm}-${dd}T${HH}:${MI}:${SS}Z`;
  }

  const m2 = dt.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m2) {
    const [, yyyy, mm, dd, HH, MI, SS] = m2;
    return `${yyyy}-${mm}-${dd}T${HH}:${MI}:${SS}Z`;
  }

  return null;
}

function getTele(p: any): Telemetria {
  return (p?.pos_telemetria ?? p?.telemetria ?? p?.tele ?? {}) as Telemetria;
}

function pickObraFromCercas(
  cercas: Cerca[] | null | undefined,
  cercaMap: Map<number, { obra: string; pos_cerca_nome: string }>
) {
  if (!Array.isArray(cercas) || cercas.length === 0) return { cerca_id_ativa: null, cerca_nome_ativa: null, obra: null };

  // Preferir a primeira cerca (menor) que esteja mapeada pra obra
  for (const c of cercas) {
    const hit = cercaMap.get(Number(c.pos_cerca_id));
    if (hit) {
      return { cerca_id_ativa: Number(c.pos_cerca_id), cerca_nome_ativa: c.pos_cerca_nome ?? hit.pos_cerca_nome, obra: hit.obra };
    }
  }

  // Senão, guarda a primeira cerca (mesmo sem obra)
  const first = cercas[0];
  return { cerca_id_ativa: Number(first.pos_cerca_id), cerca_nome_ativa: first.pos_cerca_nome ?? null, obra: null };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // Proteção simples (pra não ficar público)
    const cronSecret = process.env.CRON_SECRET || "";
    if (cronSecret) {
      const secret = url.searchParams.get("secret") || "";
      if (secret !== cronSecret) {
        return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
      }
    }

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const SIGASUL_BASE_URL = process.env.SIGASUL_BASE_URL || "https://gestao.sigasul.com.br";
    const SIGASUL_API_TOKEN = process.env.SIGASUL_API_TOKEN!;
    const TZ_OFFSET = process.env.SIGASUL_TZ_OFFSET || "-03:00";

    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return Response.json({ ok: false, error: "missing_supabase_env" }, { status: 500 });
    }
    if (!SIGASUL_API_TOKEN) {
      return Response.json({ ok: false, error: "missing_sigasul_token" }, { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1) Lê estado
    const { data: state, error: stateErr } = await supabase
      .from("sigasul_ingest_state")
      .select("last_pos_id_ref")
      .eq("stream_key", "positions_controls_v2")
      .maybeSingle();

    if (stateErr) throw stateErr;

    const lastId = state?.last_pos_id_ref ?? null;

    // 2) Carrega mapa de cercas -> obra (ativo)
    const { data: cercasMapRows, error: cercasErr } = await supabase
      .from("sigasul_cerca_map")
      .select("pos_cerca_id, pos_cerca_nome, obra")
      .eq("ativo", true);

    if (cercasErr) throw cercasErr;

    const cercaMap = new Map<number, { obra: string; pos_cerca_nome: string }>();
    for (const r of cercasMapRows || []) {
      cercaMap.set(Number(r.pos_cerca_id), { obra: r.obra, pos_cerca_nome: r.pos_cerca_nome });
    }

    // 3) Busca no SigaSul (tentando alguns formatos; se não existir, cai no default)
    const candidates = [
      lastId ? `${SIGASUL_BASE_URL}/api/v2/positions/controls/all/${lastId}` : null,
      lastId ? `${SIGASUL_BASE_URL}/api/v2/positions/controls/all?last=${lastId}` : null,
      `${SIGASUL_BASE_URL}/api/v2/positions/controls/all/`,
    ].filter(Boolean) as string[];

    let positions: any[] | null = null;
    let usedUrl: string | null = null;

    for (const u of candidates) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 20000);

      const resp = await fetch(u, {
        method: "GET",
        headers: {
          "x-auth-token": SIGASUL_API_TOKEN,
          "accept": "application/json",
        },
        signal: ac.signal,
      }).catch((e) => {
        clearTimeout(t);
        throw e;
      });

      clearTimeout(t);

      if (!resp.ok) continue;

      const json = await resp.json().catch(() => null);
      if (Array.isArray(json)) {
        positions = json;
        usedUrl = u;
        break;
      }
    }

    if (!positions) {
      await supabase
        .from("sigasul_ingest_state")
        .update({ last_run_at: new Date().toISOString(), last_status: "error", last_error: "fetch_failed" })
        .eq("stream_key", "positions_controls_v2");

      return Response.json({ ok: false, error: "fetch_failed" }, { status: 502 });
    }

    // 4) Normaliza e prepara rows
    let maxId = lastId ?? 0;

    const rows = positions
      .map((p) => {
        const pos_id_ref = Number(p?.pos_id_ref);
        if (!pos_id_ref || Number.isNaN(pos_id_ref)) return null;

        if (pos_id_ref > maxId) maxId = pos_id_ref;

        const cercas = (p?.pos_cercas ?? []) as Cerca[];
        const { cerca_id_ativa, cerca_nome_ativa, obra } = pickObraFromCercas(cercas, cercaMap);

        const tele = getTele(p);

        const pos_data_hora_gps = p?.pos_data_hora_gps ?? null;
        const pos_data_hora_gps_utc = p?.pos_data_hora_gps_utc ?? null;
        const pos_data_hora_receb = p?.pos_data_hora_receb ?? null;

        return {
          pos_id_ref,

          pos_equip_id: p?.pos_equip_id ?? null,
          pos_placa: p?.pos_placa ?? null,
          pos_equip_modelo: p?.pos_equip_modelo ?? null,
          pos_nome_motorista: p?.pos_nome_motorista ?? null,
          pos_cliente_id: p?.pos_cliente_id ?? null,
          pos_cliente_nome: p?.pos_cliente_nome ?? null,

          pos_data_hora_gps,
          pos_data_hora_gps_utc,
          pos_data_hora_receb,

          gps_at: parseBRToISO(pos_data_hora_gps, TZ_OFFSET),
          gps_utc_at: parseUTCToISO(pos_data_hora_gps_utc),
          receb_at: parseBRToISO(pos_data_hora_receb, "-03:00"), // receb é Brasília

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
        };
      })
      .filter(Boolean) as any[];

    // 5) Upsert em chunks (dedup por pos_id_ref)
    const chunks = chunk(rows, 500);
    let attempted = 0;

    for (const c of chunks) {
      attempted += c.length;

      const { error } = await supabase
        .from("sigasul_positions_raw")
        .upsert(c, { onConflict: "pos_id_ref", ignoreDuplicates: true });

      if (error) throw error;
    }

    // 6) Atualiza estado
    await supabase
      .from("sigasul_ingest_state")
      .update({
        last_pos_id_ref: maxId || lastId,
        last_run_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
      })
      .eq("stream_key", "positions_controls_v2");

    return Response.json({
      ok: true,
      used_url: usedUrl,
      last_id_before: lastId,
      max_id_seen: maxId,
      rows_received: positions.length,
      rows_attempted_upsert: attempted,
    });
  } catch (err: any) {
    return Response.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
