// FILE: app/api/cron/sigasul-jornadas/route.ts
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JornadaEvento = {
  id_evento?: number;
  id_evento_controle?: number;
  data_inicio?: string;
  data_fim?: string;
  id_tipo_evento?: number;
  nome_tipo_evento?: string;
  placa?: string;
  latitude?: string | number;
  longitude?: string | number;
};

type Jornada = {
  id_jornada?: number;
  data_inicial?: string;
  data_final?: string;
  nome_motorista?: string;
  id_motorista?: number;
  cartao_motorista?: string;
  id_cliente?: number;
  nome_cliente?: string;
  eventos?: JornadaEvento[];
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function getCronSecretFromReq(req: Request): string | null {
  const u = new URL(req.url);
  const qs = u.searchParams.get("secret");
  if (qs) return qs;
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

async function fetchSigaSul(url: string, token: string) {
  // Mantém simples: 1 tentativa (rate limit deles é chato).
  // Se seu outro route funciona, a auth via Bearer deve estar correta.
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return { res, text, data };
}

export async function GET(req: Request) {
  try {
    const CRON_SECRET = process.env.CRON_SECRET || "";
    const gotSecret = getCronSecretFromReq(req);

    if (CRON_SECRET && gotSecret !== CRON_SECRET) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SIGASUL_BASE_URL = (process.env.SIGASUL_BASE_URL || "https://gestao.sigasul.com.br").replace(/\/+$/, "");
    const SIGASUL_API_TOKEN = process.env.SIGASUL_API_TOKEN;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok: false, error: "missing_supabase_env" }, 500);
    }
    if (!SIGASUL_API_TOKEN) {
      return json({ ok: false, error: "missing_sigasul_api_token" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const streamKey = "jornadas_events_v2";

    // 1) lê estado
    let lastEventoControle: number | null = null;
    const st = await supabase
      .from("sigasul_jornadas_ingest_state")
      .select("last_evento_controle")
      .eq("stream_key", streamKey)
      .maybeSingle();

    if (st.error) {
      return json({ ok: false, error: "state_read_failed", detail: st.error.message }, 200);
    }
    lastEventoControle = (st.data?.last_evento_controle ?? null) as number | null;

    // 2) monta URL (usa v2 SEMPRE)
    // Doc: /api/v2/jornadas/events/control/{idevento}
    const idevento = lastEventoControle ?? 0;
    const usedUrl = `${SIGASUL_BASE_URL}/api/v2/jornadas/events/control/${idevento}`;

    // 3) fetch sigasul
    const { res, text, data } = await fetchSigaSul(usedUrl, SIGASUL_API_TOKEN);

    if (!res.ok) {
      // grava erro no state
      await supabase
        .from("sigasul_jornadas_ingest_state")
        .update({
          last_run_at: new Date().toISOString(),
          last_status: `http_${res.status}`,
          last_error: text?.slice(0, 2000) || null,
        })
        .eq("stream_key", streamKey);

      return json(
        {
          ok: false,
          error: `sigasul_http_${res.status}`,
          detail: text,
          used_url: usedUrl,
          last_evento_controle_before: lastEventoControle,
        },
        200
      );
    }

    if (!Array.isArray(data)) {
      return json(
        {
          ok: false,
          error: "unexpected_payload",
          used_url: usedUrl,
          sample: typeof data,
          raw: (text || "").slice(0, 1000),
        },
        200
      );
    }

    const jornadas = data as Jornada[];

    // 4) flatten eventos
    const rows = [];
    let maxEventoControle = lastEventoControle ?? 0;

    for (const j of jornadas) {
      const eventos = Array.isArray(j.eventos) ? j.eventos : [];
      for (const e of eventos) {
        const idc = Number(e.id_evento_controle ?? 0) || 0;
        if (idc > maxEventoControle) maxEventoControle = idc;

        rows.push({
          id_evento_controle: idc,
          id_evento: e.id_evento ?? null,
          id_jornada: j.id_jornada ?? null,
          data_inicial_jornada: j.data_inicial ?? null,
          data_final_jornada: j.data_final ?? null,
          nome_motorista: j.nome_motorista ?? null,
          id_motorista: j.id_motorista ?? null,
          cartao_motorista: j.cartao_motorista ?? null,
          id_cliente: j.id_cliente ?? null,
          nome_cliente: j.nome_cliente ?? null,
          data_inicio: e.data_inicio ?? null,
          data_fim: e.data_fim ?? null,
          id_tipo_evento: e.id_tipo_evento ?? null,
          nome_tipo_evento: e.nome_tipo_evento ?? null,
          placa: e.placa ?? null,
          latitude: e.latitude != null ? String(e.latitude) : null,
          longitude: e.longitude != null ? String(e.longitude) : null,
          payload: { jornada: j, evento: e },
        });
      }
    }

    // 5) upsert
    let attempted = 0;
    for (const c of chunk(rows, 500)) {
      attempted += c.length;
      const up = await supabase
        .from("sigasul_jornadas_events_raw")
        .upsert(c as any, { onConflict: "id_evento_controle", ignoreDuplicates: true });

      if (up.error) {
        await supabase
          .from("sigasul_jornadas_ingest_state")
          .update({
            last_run_at: new Date().toISOString(),
            last_status: "upsert_error",
            last_error: up.error.message,
          })
          .eq("stream_key", streamKey);

        return json(
          {
            ok: false,
            error: "upsert_failed",
            detail: up.error.message,
            used_url: usedUrl,
            rows_received: rows.length,
            rows_attempted_upsert: attempted,
          },
          200
        );
      }
    }

    // 6) atualiza state
    await supabase
      .from("sigasul_jornadas_ingest_state")
      .update({
        last_evento_controle: maxEventoControle,
        last_run_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
      })
      .eq("stream_key", streamKey);

    return json({
      ok: true,
      used_url: usedUrl,
      last_evento_controle_before: lastEventoControle,
      last_evento_controle_after: maxEventoControle,
      jornadas_received: jornadas.length,
      rows_received: rows.length,
      rows_attempted_upsert: attempted,
    });
  } catch (err: any) {
    return json({ ok: false, error: err?.message || String(err) }, 200);
  }
}

export async function POST(req: Request) {
  return GET(req);
}
