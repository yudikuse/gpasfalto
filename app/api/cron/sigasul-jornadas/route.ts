import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mustGetEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing_env:${name}`);
  return v;
}

function getAuthSecret(req: Request): string | null {
  const url = new URL(req.url);

  // 1) query param ?secret=
  const q = url.searchParams.get("secret");
  if (q) return q;

  // 2) Authorization: Bearer <secret>
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type JornadaApi = {
  id_jornada?: number | string;
  data_inicial?: string | null;
  data_final?: string | null;
  nome_motorista?: string | null;
  id_motorista?: number | string | null;
  cartao_motorista?: string | null;
  id_cliente?: number | string | null;
  nome_cliente?: string | null;
  eventos?: EventoApi[] | null;
};

type EventoApi = {
  id_evento?: number | string;
  id_evento_controle?: number | string;
  data_inicio?: string | null;
  data_fim?: string | null;
  id_tipo_evento?: number | string | null;
  nome_tipo_evento?: string | null;
  placa?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
};

export async function GET(req: Request) {
  const startedAt = new Date().toISOString();
  const streamKey = "jornadas_events_v2";

  try {
    // auth (cron secret)
    const expected = process.env.CRON_SECRET || "";
    const provided = getAuthSecret(req);
    if (expected && provided !== expected) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // supabase
    const supabaseUrl = mustGetEnv("NEXT_PUBLIC_SUPABASE_URL");
    const serviceKey = mustGetEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // read state
    const { data: st, error: stErr } = await supabase
      .from("sigasul_jornadas_ingest_state")
      .select("*")
      .eq("stream_key", streamKey)
      .maybeSingle();

    if (stErr) throw stErr;

    const lastEventoControle: number | null =
      st?.last_evento_controle !== null && st?.last_evento_controle !== undefined
        ? Number(st.last_evento_controle)
        : null;

    // sigasul fetch
    const base = mustGetEnv("SIGASUL_BASE_URL").replace(/\/+$/, "");
    const token = mustGetEnv("SIGASUL_API_TOKEN");

    const url =
      lastEventoControle && Number.isFinite(lastEventoControle)
        ? `${base}/api/v2/jornadas/events/control/${lastEventoControle}`
        : `${base}/api/jornadas/events/control`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        // SigaSul docs mostram x-auth-token; seus exemplos/SQL usam Bearer também -> manda os dois e pronto
        "x-auth-token": token,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`sigasul_http_${res.status}`);

    const payload = (await res.json()) as unknown;
    if (!Array.isArray(payload)) throw new Error("invalid_payload_not_array");

    const jornadasMap = new Map<number, any>();
    const eventos: any[] = [];

    let maxControleSeen = lastEventoControle ?? 0;

    for (const j of payload as JornadaApi[]) {
      const idJ = Number(j.id_jornada);
      if (!Number.isFinite(idJ)) continue;

      jornadasMap.set(idJ, {
        id_jornada: idJ,
        data_inicial: j.data_inicial ?? null,
        data_final: j.data_final ?? null,
        nome_motorista: j.nome_motorista ?? null,
        id_motorista: j.id_motorista !== undefined && j.id_motorista !== null ? Number(j.id_motorista) : null,
        cartao_motorista: j.cartao_motorista ?? null,
        id_cliente: j.id_cliente !== undefined && j.id_cliente !== null ? Number(j.id_cliente) : null,
        nome_cliente: j.nome_cliente ?? null,
      });

      const evs = Array.isArray(j.eventos) ? j.eventos : [];
      for (const e of evs) {
        const idEvento = Number(e.id_evento);
        const idControle = Number(e.id_evento_controle);

        if (!Number.isFinite(idEvento)) continue;

        if (Number.isFinite(idControle)) {
          maxControleSeen = Math.max(maxControleSeen, idControle);
        }

        eventos.push({
          id_evento: idEvento,
          id_evento_controle: Number.isFinite(idControle) ? idControle : null,
          id_jornada: idJ,
          data_inicio: e.data_inicio ?? null,
          data_fim: e.data_fim ?? null,
          id_tipo_evento:
            e.id_tipo_evento !== undefined && e.id_tipo_evento !== null ? Number(e.id_tipo_evento) : null,
          nome_tipo_evento: e.nome_tipo_evento ?? null,
          placa: e.placa ?? null,
          latitude:
            e.latitude !== undefined && e.latitude !== null && e.latitude !== ""
              ? Number(e.latitude)
              : null,
          longitude:
            e.longitude !== undefined && e.longitude !== null && e.longitude !== ""
              ? Number(e.longitude)
              : null,
          payload: e, // guarda o evento bruto
        });
      }
    }

    const jornadas = Array.from(jornadasMap.values());

    // upsert (chunk)
    let jornadasAttempted = 0;
    for (const c of chunk(jornadas, 500)) {
      jornadasAttempted += c.length;
      const { error } = await supabase.from("sigasul_jornadas").upsert(c, { onConflict: "id_jornada" });
      if (error) throw error;
    }

    let eventosAttempted = 0;
    for (const c of chunk(eventos, 500)) {
      eventosAttempted += c.length;
      const { error } = await supabase
        .from("sigasul_jornadas_eventos")
        .upsert(c, { onConflict: "id_evento" });
      if (error) throw error;
    }

    // update state
    const { error: upErr } = await supabase
      .from("sigasul_jornadas_ingest_state")
      .update({
        last_evento_controle: maxControleSeen || lastEventoControle,
        last_run_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
      })
      .eq("stream_key", streamKey);

    if (upErr) throw upErr;

    return NextResponse.json({
      ok: true,
      used_url: url,
      started_at: startedAt,
      last_evento_controle_before: lastEventoControle,
      max_evento_controle_seen: maxControleSeen,
      jornadas_attempted_upsert: jornadasAttempted,
      eventos_attempted_upsert: eventosAttempted,
    });
  } catch (err: any) {
    // tenta registrar erro no state, sem quebrar
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceKey) {
        const supabase = createClient(supabaseUrl, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        await supabase
          .from("sigasul_jornadas_ingest_state")
          .update({
            last_run_at: new Date().toISOString(),
            last_status: "error",
            last_error: err?.message || String(err),
          })
          .eq("stream_key", "jornadas_events_v2");
      }
    } catch {}

    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
