// FILE: app/api/cron/sigasul-jornadas/route.ts
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const STREAM_KEY = "jornadas_events_v2";

function getProvidedSecret(req: Request) {
  const url = new URL(req.url);

  const q =
    url.searchParams.get("secret") ||
    url.searchParams.get("token") ||
    url.searchParams.get("cron_secret") ||
    "";

  const auth = req.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";

  // Prioriza query se veio; senão, Bearer
  return (q || bearer || "").trim();
}

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`missing_env:${name}`);
  return v;
}

function apiUrl(path: string) {
  const base = requireEnv("SIGASUL_BASE_URL"); // ex: https://gestao.sigasul.com.br
  return new URL(path, base).toString();
}

type JornadaEvent = {
  id_evento?: number | string;
  id_evento_controle?: number | string;
  data_inicio?: string;
  data_fim?: string;
  id_tipo_evento?: number | string;
  nome_tipo_evento?: string;
  placa?: string;
  latitude?: string | number;
  longitude?: string | number;
};

type Jornada = {
  id_jornada?: number | string;
  data_inicial?: string;
  data_final?: string;
  nome_motorista?: string;
  id_motorista?: number | string;
  cartao_motorista?: string;
  id_cliente?: number | string;
  nome_cliente?: string;
  eventos?: JornadaEvent[];
};

async function handler(req: Request) {
  const expected = (process.env.CRON_SECRET || "").trim();
  const provided = getProvidedSecret(req);

  if (!expected) {
    return Response.json(
      { ok: false, error: "missing_CRON_SECRET" },
      { status: 500 }
    );
  }
  if (!provided || provided !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const token = requireEnv("SIGASUL_API_TOKEN");

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const startedAt = new Date().toISOString();

  // garante state row e pega last_evento_controle
  const { data: st0, error: stErr0 } = await supabase
    .from("sigasul_jornadas_ingest_state")
    .select("stream_key,last_evento_controle")
    .eq("stream_key", STREAM_KEY)
    .maybeSingle();

  if (stErr0) {
    return Response.json(
      { ok: false, error: `state_read_failed:${stErr0.message}` },
      { status: 500 }
    );
  }

  if (!st0) {
    const { error: insStateErr } = await supabase
      .from("sigasul_jornadas_ingest_state")
      .insert({ stream_key: STREAM_KEY, last_evento_controle: null, last_status: "init" });

    if (insStateErr) {
      return Response.json(
        { ok: false, error: `state_init_failed:${insStateErr.message}` },
        { status: 500 }
      );
    }
  }

  const last = st0?.last_evento_controle ? String(st0.last_evento_controle) : null;

  // preferimos o endpoint v2 com cursor quando já temos last; senão pega o "control" inicial
  const usedUrl = last
    ? apiUrl(`/api/v2/jornadas/events/control/${encodeURIComponent(last)}`)
    : apiUrl(`/api/jornadas/events/control`);

  let jornadas: Jornada[] = [];
  try {
    const r = await fetch(usedUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      await supabase
        .from("sigasul_jornadas_ingest_state")
        .update({
          last_run_at: startedAt,
          last_status: `http_${r.status}`,
          last_error: txt?.slice(0, 500) || null,
        })
        .eq("stream_key", STREAM_KEY);

      return Response.json(
        { ok: false, error: `fetch_failed_http_${r.status}`, used_url: usedUrl },
        { status: 500 }
      );
    }

    const json = await r.json();
    if (!Array.isArray(json)) {
      return Response.json(
        { ok: false, error: "unexpected_response_shape", used_url: usedUrl },
        { status: 500 }
      );
    }
    jornadas = json as Jornada[];
  } catch (e: any) {
    const msg = e?.message || String(e);
    await supabase
      .from("sigasul_jornadas_ingest_state")
      .update({
        last_run_at: startedAt,
        last_status: "fetch_error",
        last_error: msg?.slice(0, 500) || null,
      })
      .eq("stream_key", STREAM_KEY);

    return Response.json({ ok: false, error: "fetch_error", details: msg }, { status: 500 });
  }

  // flatten em linhas (1 linha por evento)
  const rows: any[] = [];
  let maxIdControle: bigint | null = null;

  for (const j of jornadas) {
    const eventos = Array.isArray(j.eventos) ? j.eventos : [];
    for (const ev of eventos) {
      const idCtrlRaw = ev?.id_evento_controle;
      if (idCtrlRaw === undefined || idCtrlRaw === null) continue;

      // bigint seguro
      let idCtrlBig: bigint | null = null;
      try {
        idCtrlBig = BigInt(String(idCtrlRaw));
      } catch {
        idCtrlBig = null;
      }
      if (idCtrlBig !== null) {
        if (maxIdControle === null || idCtrlBig > maxIdControle) maxIdControle = idCtrlBig;
      }

      rows.push({
        id_evento_controle: String(idCtrlRaw),
        id_evento: ev?.id_evento != null ? String(ev.id_evento) : null,
        id_jornada: j?.id_jornada != null ? String(j.id_jornada) : null,
        data_inicial_jornada: j?.data_inicial ?? null,
        data_final_jornada: j?.data_final ?? null,
        nome_motorista: j?.nome_motorista ?? null,
        id_motorista: j?.id_motorista != null ? String(j.id_motorista) : null,
        cartao_motorista: j?.cartao_motorista ?? null,
        id_cliente: j?.id_cliente != null ? String(j.id_cliente) : null,
        nome_cliente: j?.nome_cliente ?? null,

        data_inicio: ev?.data_inicio ?? null,
        data_fim: ev?.data_fim ?? null,
        id_tipo_evento: ev?.id_tipo_evento != null ? String(ev.id_tipo_evento) : null,
        nome_tipo_evento: ev?.nome_tipo_evento ?? null,
        placa: ev?.placa ?? null,
        latitude: ev?.latitude != null ? String(ev.latitude) : null,
        longitude: ev?.longitude != null ? String(ev.longitude) : null,

        payload: { jornada: j, evento: ev },
      });
    }
  }

  // upsert (ignore duplicates via PK)
  let upserted = 0;
  if (rows.length) {
    const { error: upErr } = await supabase
      .from("sigasul_jornadas_events_raw")
      .upsert(rows, { onConflict: "id_evento_controle", ignoreDuplicates: true });

    if (upErr) {
      await supabase
        .from("sigasul_jornadas_ingest_state")
        .update({
          last_run_at: startedAt,
          last_status: "upsert_failed",
          last_error: upErr.message?.slice(0, 500) || null,
        })
        .eq("stream_key", STREAM_KEY);

      return Response.json(
        { ok: false, error: `upsert_failed:${upErr.message}`, used_url: usedUrl },
        { status: 500 }
      );
    }
    upserted = rows.length;
  }

  await supabase
    .from("sigasul_jornadas_ingest_state")
    .update({
      last_evento_controle: maxIdControle ? String(maxIdControle) : last,
      last_run_at: startedAt,
      last_status: "ok",
      last_error: null,
    })
    .eq("stream_key", STREAM_KEY);

  return Response.json({
    ok: true,
    used_url: usedUrl,
    last_evento_controle_before: last,
    last_evento_controle_after: maxIdControle ? String(maxIdControle) : last,
    jornadas_received: jornadas.length,
    rows_attempted_upsert: upserted,
  });
}

export async function GET(req: Request) {
  return handler(req);
}
export async function POST(req: Request) {
  return handler(req);
}
