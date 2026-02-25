import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";

function getReqSecret(req: Request): string | null {
  const url = new URL(req.url);

  // 1) Query param (pra testar no browser)
  const q = url.searchParams.get("secret");
  if (q) return q;

  // 2) Header Authorization: Bearer <secret> (pra cron do Supabase)
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function handler(req: Request) {
  const expected = process.env.CRON_SECRET || "";
  const got = getReqSecret(req) || "";

  if (!expected || !got || !safeEqual(got, expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const sigasulBase = (process.env.SIGASUL_BASE_URL || "").replace(/\/+$/, "");
  const sigasulToken = process.env.SIGASUL_API_TOKEN || "";

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ok: false, error: "missing_supabase_env" }, { status: 500 });
  }
  if (!sigasulBase || !sigasulToken) {
    return NextResponse.json({ ok: false, error: "missing_sigasul_env" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // lê estado do cursor
  const streamKey = "jornadas_events_v2";
  const { data: state, error: stErr } = await supabase
    .from("sigasul_jornadas_ingest_state")
    .select("stream_key,last_evento_controle")
    .eq("stream_key", streamKey)
    .maybeSingle();

  if (stErr) {
    return NextResponse.json({ ok: false, error: stErr.message }, { status: 500 });
  }

  const last = state?.last_evento_controle ?? null;

  const usedUrl =
    last == null
      ? `${sigasulBase}/jornadas/events/control`
      : `${sigasulBase}/v2/jornadas/events/control/${last}`;

  const resp = await fetch(usedUrl, {
    method: "GET",
    headers: {
      "x-auth-token": sigasulToken,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    await supabase
      .from("sigasul_jornadas_ingest_state")
      .update({
        last_run_at: new Date().toISOString(),
        last_status: "error",
        last_error: `http_${resp.status} ${txt?.slice(0, 200)}`,
      })
      .eq("stream_key", streamKey);

    return NextResponse.json(
      { ok: false, error: "fetch_failed", status: resp.status, body: txt?.slice(0, 200) },
      { status: 502 }
    );
  }

  const jornadas = (await resp.json()) as any[];
  const rows: any[] = [];

  let maxControl: number | null = null;

  for (const j of jornadas || []) {
    const eventos = Array.isArray(j?.eventos) ? j.eventos : [];
    for (const e of eventos) {
      const idControle = e?.id_evento_controle;
      if (typeof idControle === "number") maxControl = maxControl == null ? idControle : Math.max(maxControl, idControle);

      rows.push({
        id_evento_controle: idControle,
        id_evento: e?.id_evento ?? null,
        id_jornada: j?.id_jornada ?? null,
        data_inicial_jornada: j?.data_inicial ?? null,
        data_final_jornada: j?.data_final ?? null,
        nome_motorista: j?.nome_motorista ?? null,
        id_motorista: j?.id_motorista ?? null,
        cartao_motorista: j?.cartao_motorista ?? null,
        id_cliente: j?.id_cliente ?? null,
        nome_cliente: j?.nome_cliente ?? null,

        data_inicio: e?.data_inicio ?? null,
        data_fim: e?.data_fim ?? null,
        id_tipo_evento: e?.id_tipo_evento ?? null,
        nome_tipo_evento: e?.nome_tipo_evento ?? null,
        placa: e?.placa ?? null,
        latitude: e?.latitude ?? null,
        longitude: e?.longitude ?? null,

        payload: { jornada: j, evento: e },
      });
    }
  }

  // upsert em chunks
  let attempted = 0;
  for (const c of chunk(rows, 500)) {
    attempted += c.length;
    const { error } = await supabase
      .from("sigasul_jornadas_events_raw")
      .upsert(c, { onConflict: "id_evento_controle", ignoreDuplicates: true });

    if (error) {
      await supabase
        .from("sigasul_jornadas_ingest_state")
        .update({
          last_run_at: new Date().toISOString(),
          last_status: "error",
          last_error: error.message,
        })
        .eq("stream_key", streamKey);

      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
  }

  await supabase
    .from("sigasul_jornadas_ingest_state")
    .update({
      last_evento_controle: maxControl ?? last,
      last_run_at: new Date().toISOString(),
      last_status: "ok",
      last_error: null,
    })
    .eq("stream_key", streamKey);

  return NextResponse.json({
    ok: true,
    used_url: usedUrl,
    last_evento_controle_before: last,
    max_evento_controle_seen: maxControl,
    rows_received: rows.length,
    rows_attempted_upsert: attempted,
  });
}

export async function GET(req: Request) {
  return handler(req);
}
export async function POST(req: Request) {
  return handler(req);
}
