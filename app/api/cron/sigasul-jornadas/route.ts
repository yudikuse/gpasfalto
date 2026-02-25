// FILE: app/api/cron/sigasul-jornadas/route.ts
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`missing_env:${name}`);
  return v;
}

function readSecret(req: Request) {
  const url = new URL(req.url);

  // 1) querystring ?secret=
  const qs = (url.searchParams.get("secret") || "").trim();

  // 2) Authorization: Bearer xxx
  const auth = (req.headers.get("authorization") || "").trim();
  const bearer = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";

  // 3) header alternativo
  const x = (req.headers.get("x-cron-secret") || "").trim();

  return qs || bearer || x;
}

type JornadaAPI = {
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
    latitude?: string | number;
    longitude?: string | number;
  }>;
};

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function handler(req: Request) {
  const expected = mustEnv("CRON_SECRET");
  const provided = readSecret(req);

  if (!provided || provided !== expected) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const baseUrl = mustEnv("SIGASUL_BASE_URL").replace(/\/+$/, "");
  const apiToken = mustEnv("SIGASUL_API_TOKEN");

  const streamKey = "jornadas_events_v2";

  // lê estado (last_evento_controle)
  const { data: state, error: stErr } = await supabase
    .from("sigasul_jornadas_ingest_state")
    .select("stream_key,last_evento_controle")
    .eq("stream_key", streamKey)
    .maybeSingle();

  if (stErr) throw stErr;

  const last = state?.last_evento_controle ?? null;

  const usedUrl = last
    ? `${baseUrl}/api/v2/jornadas/events/control/${last}`
    : `${baseUrl}/api/jornadas/events/control`;

  const resp = await fetch(usedUrl, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    await supabase
      .from("sigasul_jornadas_ingest_state")
      .upsert(
        {
          stream_key: streamKey,
          last_evento_controle: last,
          last_run_at: new Date().toISOString(),
          last_status: "fetch_failed",
          last_error: `${resp.status} ${resp.statusText} ${text.slice(0, 200)}`,
        },
        { onConflict: "stream_key" }
      );

    return Response.json(
      { ok: false, error: "fetch_failed", status: resp.status },
      { status: 500 }
    );
  }

  const json = (await resp.json()) as JornadaAPI[];
  const jornadas = Array.isArray(json) ? json : [];

  const rows: any[] = [];
  let maxControle = typeof last === "number" ? last : 0;

  for (const j of jornadas) {
    const eventos = Array.isArray(j.eventos) ? j.eventos : [];
    for (const e of eventos) {
      const idControle = Number(e.id_evento_controle ?? 0);
      if (idControle > maxControle) maxControle = idControle;

      rows.push({
        id_evento_controle: idControle,
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
      });
    }
  }

  let attempted = 0;
  for (const c of chunk(rows, 500)) {
    attempted += c.length;
    const { error } = await supabase
      .from("sigasul_jornadas_events_raw")
      .upsert(c, { onConflict: "id_evento_controle" });
    if (error) throw error;
  }

  await supabase
    .from("sigasul_jornadas_ingest_state")
    .upsert(
      {
        stream_key: streamKey,
        last_evento_controle: maxControle || last,
        last_run_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
      },
      { onConflict: "stream_key" }
    );

  return Response.json({
    ok: true,
    used_url: usedUrl,
    last_id_before: last,
    max_id_seen: maxControle,
    rows_received: rows.length,
    rows_attempted_upsert: attempted,
  });
}

export async function GET(req: Request) {
  try {
    return await handler(req);
  } catch (err: any) {
    return Response.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
