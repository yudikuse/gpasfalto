// FILE: app/api/cron/sigasul-jornadas/route.ts
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type JornadaApi = {
  id_jornada?: number;
  data_inicial?: string;
  data_final?: string;
  nome_motorista?: string;
  id_motorista?: number;
  cartao_motorista?: string;
  id_cliente?: number;
  nome_cliente?: string;
  eventos?: Array<{
    id_evento?: number;
    id_evento_controle?: number;
    data_inicio?: string;
    data_fim?: string;
    id_tipo_evento?: number;
    nome_tipo_evento?: string;
    placa?: string;
    latitude?: string;
    longitude?: string;
  }>;
};

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing_env_${name}`);
  return v;
}

function getBearerFromAuthHeader(auth: string | null): string | null {
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function isCronAuthorized(req: Request, cronSecret: string): boolean {
  const u = new URL(req.url);

  // 1) ?secret=...
  const qsSecret = u.searchParams.get("secret");
  if (qsSecret && qsSecret === cronSecret) return true;

  // 2) Authorization: Bearer <secret>
  const hdrBearer = getBearerFromAuthHeader(req.headers.get("authorization"));
  if (hdrBearer && hdrBearer === cronSecret) return true;

  // 3) x-cron-secret: <secret>
  const x = req.headers.get("x-cron-secret");
  if (x && x === cronSecret) return true;

  return false;
}

async function handler(req: Request): Promise<Response> {
  try {
    const CRON_SECRET = getEnv("CRON_SECRET");
    if (!isCronAuthorized(req, CRON_SECRET)) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const SUPABASE_URL = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const SIGASUL_BASE_URL = normalizeBaseUrl(getEnv("SIGASUL_BASE_URL"));
    const SIGASUL_API_TOKEN = getEnv("SIGASUL_API_TOKEN");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const streamKey = "jornadas_events_v2";

    // lê estado
    const { data: stateRow, error: stErr } = await supabase
      .from("sigasul_jornadas_ingest_state")
      .select("stream_key,last_evento_controle,last_status,last_error,last_run_at")
      .eq("stream_key", streamKey)
      .maybeSingle();

    if (stErr) throw new Error(`state_read_failed:${stErr.message}`);

    const lastEvento = stateRow?.last_evento_controle ?? null;

    // URL conforme doc (primeira chamada sem idevento, depois com /v2/.../{idevento})
    const usedUrl =
      lastEvento && Number(lastEvento) > 0
        ? `${SIGASUL_BASE_URL}/api/v2/jornadas/events/control/${Number(lastEvento)}`
        : `${SIGASUL_BASE_URL}/api/jornadas/events/control`;

    // NÃO reaproveitar req.headers aqui. Header da SigaSul TEM que ser o token dela.
    const sigasulResp = await fetch(usedUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",

        // manda em 2 formatos pra cobrir variações de gateway
        Authorization: `Bearer ${SIGASUL_API_TOKEN}`,
        token: SIGASUL_API_TOKEN,
        "x-api-token": SIGASUL_API_TOKEN,
      },
      cache: "no-store",
    });

    if (!sigasulResp.ok) {
      const txt = await sigasulResp.text().catch(() => "");
      // grava estado com erro
      await supabase
        .from("sigasul_jornadas_ingest_state")
        .upsert(
          {
            stream_key: streamKey,
            last_evento_controle: lastEvento,
            last_run_at: new Date().toISOString(),
            last_status: "error",
            last_error: `sigasul_http_${sigasulResp.status}: ${txt?.slice(0, 500) || ""}`,
          },
          { onConflict: "stream_key" }
        );

      return Response.json(
        {
          ok: false,
          error: `sigasul_http_${sigasulResp.status}`,
          detail: txt?.slice(0, 1000) || null,
          used_url: usedUrl,
          last_evento_controle_before: lastEvento,
        },
        { status: 200 }
      );
    }

    const payload = (await sigasulResp.json()) as JornadaApi[];
    const jornadas = Array.isArray(payload) ? payload : [];

    // flatten eventos
    const rows = jornadas.flatMap((j) =>
      (j.eventos || []).map((e) => ({
        id_evento_controle: e.id_evento_controle ?? null,
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
        latitude: e.latitude ?? null,
        longitude: e.longitude ?? null,

        payload: { jornada: j, evento: e },
      }))
    );

    // filtra sem id_evento_controle (não dá pra controlar incremental sem isso)
    const rowsOk = rows.filter((r) => r.id_evento_controle !== null);

    // calcula max id_evento_controle
    let maxSeen: number | null = lastEvento ? Number(lastEvento) : null;
    for (const r of rowsOk) {
      const n = Number(r.id_evento_controle);
      if (!Number.isNaN(n)) {
        if (maxSeen === null || n > maxSeen) maxSeen = n;
      }
    }

    // upsert em chunks
    const chunkSize = 500;
    let attempted = 0;

    for (let i = 0; i < rowsOk.length; i += chunkSize) {
      const chunk = rowsOk.slice(i, i + chunkSize);
      attempted += chunk.length;

      const { error } = await supabase
        .from("sigasul_jornadas_events_raw")
        .upsert(chunk, { onConflict: "id_evento_controle" });

      if (error) throw new Error(`upsert_failed:${error.message}`);
    }

    // atualiza estado
    await supabase
      .from("sigasul_jornadas_ingest_state")
      .upsert(
        {
          stream_key: streamKey,
          last_evento_controle: maxSeen ?? lastEvento,
          last_run_at: new Date().toISOString(),
          last_status: "ok",
          last_error: null,
        },
        { onConflict: "stream_key" }
      );

    return Response.json({
      ok: true,
      used_url: usedUrl,
      last_evento_controle_before: lastEvento,
      max_id_seen: maxSeen,
      jornadas_recebidas: jornadas.length,
      eventos_recebidos: rowsOk.length,
      rows_attempted_upsert: attempted,
    });
  } catch (err: any) {
    return Response.json(
      {
        ok: false,
        error: err?.message || String(err),
      },
      { status: 200 }
    );
  }
}

export async function GET(req: Request) {
  return handler(req);
}

export async function POST(req: Request) {
  return handler(req);
}
