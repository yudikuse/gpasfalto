// FILE: app/api/cron/sigasul-jornadas/route.ts
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type JornadaEvent = {
  id_evento?: number | string | null;
  id_evento_controle?: number | string | null;
  data_inicio?: string | null;
  data_fim?: string | null;
  id_tipo_evento?: number | string | null;
  nome_tipo_evento?: string | null;
  placa?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
};

type Jornada = {
  id_jornada?: number | string | null;
  data_inicial?: string | null;
  data_final?: string | null;
  nome_motorista?: string | null;
  id_motorista?: number | string | null;
  cartao_motorista?: string | null;
  id_cliente?: number | string | null;
  nome_cliente?: string | null;
  eventos?: JornadaEvent[] | null;
};

function toStr(v: unknown) {
  if (v === null || v === undefined) return null;
  return String(v);
}

function pickAuthHeader(apiToken: string) {
  // Se o env já vier "Bearer xxx", usa como está; senão prefixa.
  return /^Bearer\s+/i.test(apiToken) ? apiToken : `Bearer ${apiToken}`;
}

function jsonError(error: unknown) {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret") ?? "";

  const CRON_SECRET = process.env.CRON_SECRET ?? "";
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const SIGASUL_BASE_URL = (process.env.SIGASUL_BASE_URL ?? "").replace(/\/$/, "");
  const SIGASUL_API_TOKEN = process.env.SIGASUL_API_TOKEN ?? "";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      { ok: false, error: "missing_supabase_env" },
      { status: 500 }
    );
  }
  if (!SIGASUL_BASE_URL || !SIGASUL_API_TOKEN) {
    return Response.json(
      { ok: false, error: "missing_sigasul_env" },
      { status: 500 }
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const streamKey = "jornadas_events_v2";

  // 1) Lê o estado (último id_evento_controle processado)
  let lastEventoControle: string | null = null;
  try {
    const { data: st, error: stErr } = await supabase
      .from("sigasul_jornadas_ingest_state")
      .select("last_evento_controle")
      .eq("stream_key", streamKey)
      .maybeSingle();

    if (stErr) throw stErr;
    lastEventoControle = st?.last_evento_controle ? String(st.last_evento_controle) : null;
  } catch (e) {
    // se não conseguiu ler estado, ainda tenta o endpoint base, mas registra erro no retorno
    lastEventoControle = null;
  }

  // 2) Monta URL
  // - Primeira vez: /api/jornadas/events/control
  // - Incremental: /api/v2/jornadas/events/control/{idevento}
  const usedUrl = lastEventoControle
    ? `${SIGASUL_BASE_URL}/api/v2/jornadas/events/control/${encodeURIComponent(lastEventoControle)}`
    : `${SIGASUL_BASE_URL}/api/jornadas/events/control`;

  // 3) Busca na SigaSul
  let jornadas: Jornada[] = [];
  try {
    const resp = await fetch(usedUrl, {
      method: "GET",
      headers: {
        Authorization: pickAuthHeader(SIGASUL_API_TOKEN),
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      // Atualiza estado com erro
      await supabase
        .from("sigasul_jornadas_ingest_state")
        .update({
          last_run_at: new Date().toISOString(),
          last_status: "error",
          last_error: `sigasul_http_${resp.status}: ${body}`.slice(0, 5000),
        })
        .eq("stream_key", streamKey);

      return Response.json(
        {
          ok: false,
          error: `sigasul_http_${resp.status}`,
          detail: body || "Unauthorized",
          used_url: usedUrl,
          last_evento_controle_before: lastEventoControle,
        },
        { status: 502 }
      );
    }

    const json = (await resp.json()) as unknown;
    if (!Array.isArray(json)) {
      throw new Error("unexpected_sigasul_response_not_array");
    }
    jornadas = json as Jornada[];
  } catch (e) {
    await supabase
      .from("sigasul_jornadas_ingest_state")
      .update({
        last_run_at: new Date().toISOString(),
        last_status: "error",
        last_error: `fetch_failed: ${jsonError(e)}`.slice(0, 5000),
      })
      .eq("stream_key", streamKey);

    return Response.json(
      { ok: false, error: "fetch_failed", detail: jsonError(e), used_url: usedUrl },
      { status: 502 }
    );
  }

  // 4) Flatten (1 row por evento)
  const rows: any[] = [];
  let maxIdEventoControle: string | null = null;

  for (const j of jornadas) {
    const eventos = Array.isArray(j.eventos) ? j.eventos : [];
    for (const ev of eventos) {
      const idEventoControle = toStr(ev.id_evento_controle);

      if (idEventoControle) {
        if (!maxIdEventoControle) maxIdEventoControle = idEventoControle;
        else {
          // compara como número se possível; senão compara string
          const a = Number(maxIdEventoControle);
          const b = Number(idEventoControle);
          if (!Number.isNaN(a) && !Number.isNaN(b)) {
            if (b > a) maxIdEventoControle = idEventoControle;
          } else {
            if (idEventoControle > maxIdEventoControle) maxIdEventoControle = idEventoControle;
          }
        }
      }

      rows.push({
        id_evento_controle: idEventoControle, // PK
        id_evento: toStr(ev.id_evento),
        id_jornada: toStr(j.id_jornada),

        data_inicial_jornada: j.data_inicial ?? null,
        data_final_jornada: j.data_final ?? null,
        nome_motorista: j.nome_motorista ?? null,
        id_motorista: toStr(j.id_motorista),
        cartao_motorista: j.cartao_motorista ?? null,
        id_cliente: toStr(j.id_cliente),
        nome_cliente: j.nome_cliente ?? null,

        data_inicio: ev.data_inicio ?? null,
        data_fim: ev.data_fim ?? null,
        id_tipo_evento: toStr(ev.id_tipo_evento),
        nome_tipo_evento: ev.nome_tipo_evento ?? null,
        placa: ev.placa ?? null,
        latitude: toStr(ev.latitude),
        longitude: toStr(ev.longitude),

        payload: {
          jornada: j,
          evento: ev,
        },
      });
    }
  }

  // 5) Upsert no Supabase (por id_evento_controle)
  let attempted = 0;
  try {
    if (rows.length > 0) {
      // faz em chunks para não estourar payload
      const chunkSize = 500;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        attempted += chunk.length;

        const { error: upErr } = await supabase
          .from("sigasul_jornadas_events_raw")
          .upsert(chunk, { onConflict: "id_evento_controle", ignoreDuplicates: true });

        if (upErr) throw upErr;
      }
    }
  } catch (e) {
    await supabase
      .from("sigasul_jornadas_ingest_state")
      .update({
        last_run_at: new Date().toISOString(),
        last_status: "error",
        last_error: `upsert_failed: ${jsonError(e)}`.slice(0, 5000),
      })
      .eq("stream_key", streamKey);

    return Response.json(
      {
        ok: false,
        error: "upsert_failed",
        detail: jsonError(e),
        used_url: usedUrl,
        jornadas_received: jornadas.length,
        eventos_attempted_upsert: attempted,
        max_evento_controle_seen: maxIdEventoControle,
      },
      { status: 500 }
    );
  }

  // 6) Atualiza state (somente se veio algum evento com id_evento_controle)
  try {
    await supabase
      .from("sigasul_jornadas_ingest_state")
      .update({
        last_evento_controle: maxIdEventoControle ?? lastEventoControle,
        last_run_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
      })
      .eq("stream_key", streamKey);
  } catch {
    // não derruba a execução
  }

  return Response.json({
    ok: true,
    used_url: usedUrl,
    last_evento_controle_before: lastEventoControle,
    max_evento_controle_seen: maxIdEventoControle,
    jornadas_received: jornadas.length,
    eventos_attempted_upsert: attempted,
  });
}

export async function POST(req: Request) {
  return GET(req);
}
