// FILE: app/api/cron/sigasul-jornadas/route.ts
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type JornadaApiEvent = {
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

type JornadaApiItem = {
  id_jornada?: number;
  data_inicial?: string;
  data_final?: string;
  nome_motorista?: string;
  id_motorista?: number;
  cartao_motorista?: string;
  id_cliente?: number;
  nome_cliente?: string;
  eventos?: JornadaApiEvent[];
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function getIncomingSecret(req: Request): string | null {
  const url = new URL(req.url);
  const qp = url.searchParams.get("secret");
  if (qp && qp.trim()) return qp.trim();

  const auth = req.headers.get("authorization");
  if (auth && auth.trim()) {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    return (m ? m[1] : auth).trim();
  }

  const x = req.headers.get("x-cron-secret");
  if (x && x.trim()) return x.trim();

  return null;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing env: ${name}`);
  return v.trim();
}

function normalizeBearer(token: string): string {
  const t = token.trim();
  if (!t) return "";
  return /^bearer\s+/i.test(t) ? t : `Bearer ${t}`;
}

function toNumberOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toTextOrNull(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function handler(req: Request) {
  // 1) Auth do CRON (Vercel/Supabase)
  const expectedSecret = (process.env.CRON_SECRET || "").trim();
  if (!expectedSecret) {
    return json({ ok: false, error: "missing_cron_secret_env" }, 500);
  }
  const incomingSecret = getIncomingSecret(req);
  if (!incomingSecret || incomingSecret !== expectedSecret) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // 2) Supabase client
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim() ||
    "";
  if (!supabaseUrl) return json({ ok: false, error: "missing_supabase_url_env" }, 500);

  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceRoleKey) return json({ ok: false, error: "missing_service_role_key_env" }, 500);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // 3) SigaSul config
  let baseUrl: string;
  let apiToken: string;
  try {
    baseUrl = requireEnv("SIGASUL_BASE_URL").replace(/\/+$/, "");
    apiToken = requireEnv("SIGASUL_API_TOKEN");
  } catch (e: any) {
    return json({ ok: false, error: "missing_env", detail: e?.message || String(e) }, 500);
  }

  const streamKey = "jornadas_events_v2";

  // 4) Lê/garante state
  const { data: stateRow, error: stateErr } = await supabase
    .from("sigasul_jornadas_ingest_state")
    .select("stream_key,last_evento_controle,last_status,last_error,last_run_at")
    .eq("stream_key", streamKey)
    .maybeSingle();

  if (stateErr) {
    return json({ ok: false, error: "supabase_state_read_failed", detail: stateErr.message }, 500);
  }

  if (!stateRow) {
    const { error: initErr } = await supabase
      .from("sigasul_jornadas_ingest_state")
      .insert({ stream_key: streamKey, last_evento_controle: null, last_status: "init" });
    if (initErr) {
      return json({ ok: false, error: "supabase_state_init_failed", detail: initErr.message }, 500);
    }
  }

  const lastBefore = toNumberOrNull(stateRow?.last_evento_controle) ?? 0;

  // 5) Busca eventos
  // Endpoint v2 com cursor (id_evento_controle)
  const usedUrl = `${baseUrl}/api/v2/jornadas/events/control/${lastBefore}`;

  // manda 2 formas de auth ao mesmo tempo (pra matar o 401):
  // - Authorization: Bearer <token>
  // - token: <token>
  const authBearer = normalizeBearer(apiToken);
  const rawToken = apiToken.trim().replace(/^bearer\s+/i, "");

  let payload: JornadaApiItem[] = [];
  let httpStatus: number | null = null;
  let httpText: string | null = null;

  try {
    const resp = await fetch(usedUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: authBearer, // funciona no módulo de rastreamento; pode funcionar aqui também
        token: rawToken, // alguns endpoints usam header próprio
      },
      // evita cache em ambiente serverless
      cache: "no-store",
    });

    httpStatus = resp.status;
    httpText = await resp.text();

    if (!resp.ok) {
      // guarda erro no state e retorna
      await supabase
        .from("sigasul_jornadas_ingest_state")
        .update({
          last_run_at: new Date().toISOString(),
          last_status: `http_${resp.status}`,
          last_error: httpText?.slice(0, 2000) || null,
        })
        .eq("stream_key", streamKey);

      return json(
        {
          ok: false,
          error: "sigasul_http_error",
          sigasul_status: resp.status,
          used_url: usedUrl,
          detail: httpText?.slice(0, 2000) || null,
          last_evento_controle_before: lastBefore,
        },
        200
      );
    }

    // ok -> parse JSON
    const parsed = JSON.parse(httpText || "[]");
    payload = Array.isArray(parsed) ? (parsed as JornadaApiItem[]) : [];
  } catch (e: any) {
    await supabase
      .from("sigasul_jornadas_ingest_state")
      .update({
        last_run_at: new Date().toISOString(),
        last_status: "fetch_error",
        last_error: (e?.message || String(e)).slice(0, 2000),
      })
      .eq("stream_key", streamKey);

    return json(
      {
        ok: false,
        error: "fetch_failed",
        used_url: usedUrl,
        detail: e?.message || String(e),
        last_evento_controle_before: lastBefore,
      },
      200
    );
  }

  // 6) Flatten e upsert
  const rows: any[] = [];
  let maxSeen = lastBefore;

  for (const j of payload) {
    const idJornada = toNumberOrNull(j.id_jornada);
    const dataInicialJornada = toTextOrNull(j.data_inicial);
    const dataFinalJornada = toTextOrNull(j.data_final);

    const baseRow = {
      id_jornada: idJornada,
      data_inicial_jornada: dataInicialJornada,
      data_final_jornada: dataFinalJornada,
      nome_motorista: toTextOrNull(j.nome_motorista),
      id_motorista: toNumberOrNull(j.id_motorista),
      cartao_motorista: toTextOrNull(j.cartao_motorista),
      id_cliente: toNumberOrNull(j.id_cliente),
      nome_cliente: toTextOrNull(j.nome_cliente),
    };

    const eventos = Array.isArray(j.eventos) ? j.eventos : [];
    for (const ev of eventos) {
      const idControle = toNumberOrNull(ev.id_evento_controle);
      if (!idControle) continue;

      if (idControle > maxSeen) maxSeen = idControle;

      rows.push({
        id_evento_controle: idControle,
        id_evento: toNumberOrNull(ev.id_evento),
        ...baseRow,
        data_inicio: toTextOrNull(ev.data_inicio),
        data_fim: toTextOrNull(ev.data_fim),
        id_tipo_evento: toNumberOrNull(ev.id_tipo_evento),
        nome_tipo_evento: toTextOrNull(ev.nome_tipo_evento),
        placa: toTextOrNull(ev.placa),
        latitude: toTextOrNull(ev.latitude),
        longitude: toTextOrNull(ev.longitude),
        payload: {
          jornada: j,
          evento: ev,
        },
      });
    }
  }

  let attempted = rows.length;
  let upsertedBatches = 0;

  if (rows.length > 0) {
    const batches = chunk(rows, 500);
    for (const b of batches) {
      const { error: upErr } = await supabase
        .from("sigasul_jornadas_events_raw")
        .upsert(b, { onConflict: "id_evento_controle", ignoreDuplicates: true });

      if (upErr) {
        await supabase
          .from("sigasul_jornadas_ingest_state")
          .update({
            last_run_at: new Date().toISOString(),
            last_status: "upsert_error",
            last_error: upErr.message,
          })
          .eq("stream_key", streamKey);

        return json(
          {
            ok: false,
            error: "supabase_upsert_failed",
            detail: upErr.message,
            used_url: usedUrl,
            last_evento_controle_before: lastBefore,
            max_id_seen: maxSeen,
            rows_attempted_upsert: attempted,
            sigasul_status: httpStatus,
          },
          200
        );
      }

      upsertedBatches += 1;
    }
  }

  // 7) Atualiza state
  await supabase
    .from("sigasul_jornadas_ingest_state")
    .update({
      last_evento_controle: maxSeen,
      last_run_at: new Date().toISOString(),
      last_status: "ok",
      last_error: null,
    })
    .eq("stream_key", streamKey);

  return json({
    ok: true,
    used_url: usedUrl,
    sigasul_status: httpStatus,
    last_evento_controle_before: lastBefore,
    max_id_seen: maxSeen,
    jornadas_received: payload.length,
    rows_attempted_upsert: attempted,
    upsert_batches: upsertedBatches,
  });
}

export async function GET(req: Request) {
  return handler(req);
}

export async function POST(req: Request) {
  return handler(req);
}
