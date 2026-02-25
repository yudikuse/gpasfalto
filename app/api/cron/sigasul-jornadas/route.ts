// FILE: app/api/cron/sigasul-jornadas/route.ts
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Jornada = {
  id_jornada?: number;
  data_inicial?: string;
  data_final?: string;
  nome_motorista?: string;
  id_motorista?: number;
  cartao_motorista?: string;
  id_cliente?: number;
  nome_cliente?: string;
  eventos?: Evento[];
};

type Evento = {
  id_evento?: number;
  id_evento_controle?: number;
  data_inicio?: string;
  data_fim?: string;
  id_tipo_evento?: number;
  nome_tipo_evento?: string;
  placa?: string;
  latitude?: string;
  longitude?: string;
};

function getProvidedSecret(req: Request): string {
  const url = new URL(req.url);
  const q = (url.searchParams.get("secret") || "").trim();
  if (q) return q;

  const auth = (req.headers.get("authorization") || "").trim();
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || "").trim();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function GET(req: Request) {
  try {
    // 1) AUTH (aceita query ?secret= e Authorization: Bearer)
    const expected = (process.env.CRON_SECRET || "").trim();
    const provided = getProvidedSecret(req);

    if (!expected || !provided || provided !== expected) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    // 2) ENV obrigatórias
    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    const baseUrl = (process.env.SIGASUL_BASE_URL || "https://gestao.sigasul.com.br").replace(/\/+$/, "");
    const apiToken = (process.env.SIGASUL_API_TOKEN || "").trim();

    if (!supabaseUrl || !serviceKey) {
      return Response.json({ ok: false, error: "missing_supabase_env" }, { status: 500 });
    }
    if (!apiToken) {
      return Response.json({ ok: false, error: "missing_sigasul_token" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 3) pega last_evento_controle (stream_key fixo)
    const streamKey = "jornadas_events_v2";

    const st = await supabase
      .from("sigasul_jornadas_ingest_state")
      .select("stream_key,last_evento_controle")
      .eq("stream_key", streamKey)
      .maybeSingle();

    if (st.error) throw st.error;

    if (!st.data) {
      const ins = await supabase.from("sigasul_jornadas_ingest_state").insert({
        stream_key: streamKey,
        last_evento_controle: null,
        last_status: "init",
      });
      if (ins.error) throw ins.error;
    }

    const last = (st.data?.last_evento_controle ?? null) as number | null;

    // 4) chama API
    const usedUrl = last
      ? `${baseUrl}/api/v2/jornadas/events/control/${last}`
      : `${baseUrl}/api/jornadas/events/control`;

    const resp = await fetch(usedUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`sigasul_http_${resp.status}: ${txt.slice(0, 300)}`);
    }

    const jornadas = (await resp.json()) as Jornada[];
    const rows: any[] = [];

    let maxControle = last ?? 0;

    for (const j of jornadas || []) {
      const eventos = j.eventos || [];
      for (const e of eventos) {
        const idControle = Number(e.id_evento_controle);
        if (!Number.isFinite(idControle)) continue;

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

    // 5) upsert em chunks
    let attempted = 0;
    for (const c of chunk(rows, 500)) {
      attempted += c.length;
      const up = await supabase
        .from("sigasul_jornadas_events_raw")
        .upsert(c, { onConflict: "id_evento_controle", ignoreDuplicates: true });

      if (up.error) throw up.error;
    }

    // 6) salva estado
    const upd = await supabase
      .from("sigasul_jornadas_ingest_state")
      .update({
        last_evento_controle: maxControle || last,
        last_run_at: new Date().toISOString(),
        last_status: "ok",
        last_error: null,
      })
      .eq("stream_key", streamKey);

    if (upd.error) throw upd.error;

    return Response.json({
      ok: true,
      used_url: usedUrl,
      last_id_before: last,
      max_id_seen: maxControle || last,
      jornadas_received: (jornadas || []).length,
      rows_attempted_upsert: attempted,
    });
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
