// FILE: app/api/cron/sigasul/daily/route.ts
// Roda às 23:50 BRT (02:50 UTC) — consolida o dia corrente
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

const BASE  = process.env.SIGASUL_BASE_URL  || "https://gestao.sigasul.com.br";
const TOKEN = process.env.SIGASUL_API_TOKEN || "";

function pad2(n: number) { return String(n).padStart(2, "0"); }

function todayBRT() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return `${brt.getUTCFullYear()}-${pad2(brt.getUTCMonth() + 1)}-${pad2(brt.getUTCDate())}`;
}

function hhmmssToSec(s: string): number {
  if (!s || !s.match(/^\d{2}:\d{2}:\d{2}$/)) return 0;
  const [h, m, sec] = s.split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (sec || 0);
}

function distanciaMetros(haversineMeters: number): number {
  return Math.max(0, haversineMeters);
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  // Auth
  const cronSecret = process.env.CRON_SECRET || "";
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    const qs   = url.searchParams.get("secret") || "";
    if (auth !== `Bearer ${cronSecret}` && qs !== cronSecret) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!SUPABASE_URL || !SERVICE_ROLE) return Response.json({ ok: false, error: "missing_supabase_env" }, { status: 500 });
  if (!TOKEN) return Response.json({ ok: false, error: "missing_sigasul_token" }, { status: 500 });

  // Data alvo — padrão é hoje BRT (cron roda às 23:50)
  const targetDate = url.searchParams.get("date") || todayBRT();
  const start = `${targetDate} 00:00:00`;
  const end   = `${targetDate} 23:59:59`;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Busca todos os equipamentos cadastrados
  const { data: placaCodigos } = await supabase
    .from("sigasul_placa_codigo")
    .select("pos_placa, codigo");

  const allEquips = new Map<string, string>(); // placa → codigo
  for (const r of placaCodigos ?? []) allEquips.set(r.pos_placa, r.codigo);

  // 2. Busca pos_equip_id de cada placa (da positions_raw)
  const { data: equipsRaw } = await supabase
    .from("sigasul_positions_raw")
    .select("pos_equip_id, pos_placa")
    .in("pos_placa", Array.from(allEquips.keys()));

  const placaToEquipId = new Map<string, string>();
  for (const r of equipsRaw ?? []) {
    if (r.pos_equip_id && r.pos_placa) placaToEquipId.set(r.pos_placa, r.pos_equip_id);
  }

  // 3. Busca obra de cada equipamento (última posição do dia)
  const { data: posicoesDia } = await supabase
    .from("sigasul_positions_raw")
    .select("pos_equip_id, pos_placa, obra, last_seen_at")
    .gte("last_seen_at", `${targetDate}T00:00:00-03:00`)
    .lte("last_seen_at", `${targetDate}T23:59:59-03:00`)
    .order("last_seen_at", { ascending: false });

  // Obra mais frequente por equipamento no dia
  const obraCount = new Map<string, Map<string, number>>();
  for (const p of posicoesDia ?? []) {
    if (!p.pos_equip_id || !p.obra) continue;
    if (!obraCount.has(p.pos_equip_id)) obraCount.set(p.pos_equip_id, new Map());
    const m = obraCount.get(p.pos_equip_id)!;
    m.set(p.obra, (m.get(p.obra) ?? 0) + 1);
  }

  function obraPrincipal(equip_id: string): string {
    const m = obraCount.get(equip_id);
    if (!m || m.size === 0) return "SEM OBRA";
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  // 4. Chama simplificada
  const sigasulUrl = `${BASE}/api/jornadas/simplificada/${encodeURIComponent(start)}/${encodeURIComponent(end)}`;

  let simplificada: any[] = [];
  try {
    const res = await fetch(sigasulUrl, {
      headers: { "x-auth-token": TOKEN, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) simplificada = data;
    }
  } catch (e) {
    console.error("simplificada error:", e);
  }

  // 5. Agrega por placa
  type Agg = {
    km_metros: number;
    tempo_ligado_sec: number;
    primeira_ignicao: string | null;
    ultima_ignicao: string | null;
    trabalhou: boolean;
  };

  const byPlaca = new Map<string, Agg>();

  for (const veiculo of simplificada) {
    const placa = (veiculo.placa as string)?.toUpperCase();
    if (!placa || !veiculo.eventos?.length) continue;

    const eventos = veiculo.eventos as any[];

    const km = eventos.reduce((a: number, e: any) => a + distanciaMetros(e.distancia ?? 0), 0);
    const tempo = eventos.reduce((a: number, e: any) => a + hhmmssToSec(e.tempoLigado), 0);

    // Extrai HH:MM:SS das strings de data "YYYY-MM-DD HH:MM:SS"
    const primeira = eventos[0]?.data_hora_inicial?.split(" ")[1] ?? null;
    const ultima   = eventos[eventos.length - 1]?.data_hora_final?.split(" ")[1] ?? null;

    byPlaca.set(placa, { km_metros: km, tempo_ligado_sec: tempo, primeira_ignicao: primeira, ultima_ignicao: ultima, trabalhou: tempo > 0 });
  }

  // 6. Monta rows para upsert — inclui TODOS os equipamentos cadastrados
  const rows: any[] = [];

  for (const [placa, codigo] of allEquips.entries()) {
    const equip_id = placaToEquipId.get(placa) ?? placa;
    const agg      = byPlaca.get(placa.toUpperCase()) ?? { km_metros: 0, tempo_ligado_sec: 0, primeira_ignicao: null, ultima_ignicao: null, trabalhou: false };
    const obra     = obraPrincipal(equip_id);

    rows.push({
      dia:              targetDate,
      pos_equip_id:     equip_id,
      codigo,
      placa,
      obra,
      km_metros:        agg.km_metros,
      tempo_ligado_sec: agg.tempo_ligado_sec,
      primeira_ignicao: agg.primeira_ignicao,
      ultima_ignicao:   agg.ultima_ignicao,
      trabalhou:        agg.trabalhou,
    });
  }

  // 7. Upsert
  const { error } = await supabase
    .from("sigasul_daily_summary")
    .upsert(rows, { onConflict: "dia,pos_equip_id" });

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const trabalharam = rows.filter((r) => r.trabalhou).length;

  return Response.json({
    ok: true,
    dia: targetDate,
    equips_total:       rows.length,
    equips_trabalharam: trabalharam,
    equips_sem_evento:  rows.length - trabalharam,
  });
}

export async function POST(req: Request) { return GET(req); }
