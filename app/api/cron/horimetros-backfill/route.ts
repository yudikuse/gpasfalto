// FILE: app/api/cron/horimetros-backfill/route.ts
// Roda às 23:59 (horário Brasília = 02:59 UTC do dia seguinte)
// Para cada equipamento ativo sem leitura hoje, cria um registro
// com os valores do último dia conhecido (horas=0, km=0).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";

function pad(n: number) { return String(n).padStart(2, "0"); }

/** Data de hoje no fuso Brasília (UTC-3) */
function hojeNoBrasil(): string {
  const agora = new Date();
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const y = brasilia.getUTCFullYear();
  const m = pad(brasilia.getUTCMonth() + 1);
  const d = pad(brasilia.getUTCDate());
  return `${y}-${m}-${d}`;
}

type EquipRow = {
  id: number;
  codigo: string;
  usa_horimetro: boolean | null;
  usa_odometro: boolean | null;
  horimetro_base: number | null;
  odometro_base: number | null;
};

type LeituraRow = {
  id: number;
  data: string;
  obra_id: number | null;
  equipamento_id: number;
  horimetro_final: number | null;
  odometro_final: number | null;
};

export async function GET(request: Request) {
  // Segurança
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const hoje = hojeNoBrasil();

    // 1. Todos os equipamentos ativos
    const { data: equipamentos, error: eqErr } = await supabase
      .from("horimetro_equipamentos")
      .select("id,codigo,usa_horimetro,usa_odometro,horimetro_base,odometro_base")
      .eq("ativo", true)
      .limit(500);

    if (eqErr) throw eqErr;
    if (!equipamentos?.length) {
      return Response.json({ ok: true, info: "Nenhum equipamento ativo." });
    }

    // 2. Quais já têm leitura hoje
    const { data: leiturasHoje, error: lhErr } = await supabase
      .from("horimetro_leituras_diarias")
      .select("equipamento_id")
      .eq("data", hoje);

    if (lhErr) throw lhErr;

    const idsComLeitura = new Set((leiturasHoje ?? []).map(l => l.equipamento_id));

    // 3. Equipamentos SEM leitura hoje
    const semLeitura = (equipamentos as EquipRow[]).filter(
      eq => !idsComLeitura.has(eq.id)
    );

    if (semLeitura.length === 0) {
      return Response.json({ ok: true, hoje, backfilled: 0, info: "Todos já têm leitura." });
    }

    // 4. Para cada equipamento sem leitura, busca o último registro anterior
    const results: { codigo: string; status: "ok" | "skip" | "erro"; motivo?: string }[] = [];

    for (const eq of semLeitura) {
      try {
        // Busca última leitura anterior (qualquer data < hoje)
        const { data: ultimaLeitura, error: ulErr } = await supabase
          .from("horimetro_leituras_diarias")
          .select("id,data,obra_id,equipamento_id,horimetro_final,odometro_final")
          .eq("equipamento_id", eq.id)
          .lt("data", hoje)
          .order("data", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (ulErr) throw ulErr;

        const ultima = ultimaLeitura as LeituraRow | null;

        // Determina valores a usar
        const horFinal = ultima?.horimetro_final ?? eq.horimetro_base ?? null;
        const odoFinal = ultima?.odometro_final  ?? eq.odometro_base  ?? null;
        const obraId   = ultima?.obra_id ?? null;

        // Se não tem nenhum valor de referência, pula
        if (horFinal == null && odoFinal == null) {
          results.push({ codigo: eq.codigo, status: "skip", motivo: "sem valor de referência" });
          continue;
        }

        // Cria o registro de backfill
        const payload: Record<string, unknown> = {
          data:              hoje,
          equipamento_id:    eq.id,
          obra_id:           obraId,
          updated_by_nome:   "Sistema (backfill automático)",
          updated_at:        new Date().toISOString(),
        };

        if (horFinal != null) {
          payload.horimetro_inicial  = horFinal;
          payload.horimetro_final    = horFinal;
          payload.horas_trabalhadas  = 0;
        }

        if (odoFinal != null) {
          payload.odometro_inicial = odoFinal;
          payload.odometro_final   = odoFinal;
          payload.km_rodados       = 0;
        }

        const { error: insertErr } = await supabase
          .from("horimetro_leituras_diarias")
          .insert(payload);

        if (insertErr) throw insertErr;

        results.push({ codigo: eq.codigo, status: "ok" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ codigo: eq.codigo, status: "erro", motivo: msg });
      }
    }

    const okCount   = results.filter(r => r.status === "ok").length;
    const skipCount = results.filter(r => r.status === "skip").length;
    const errCount  = results.filter(r => r.status === "erro").length;

    console.log(`[backfill] ${hoje} — ok:${okCount} skip:${skipCount} erro:${errCount}`);

    return Response.json({
      ok: true,
      hoje,
      backfilled: okCount,
      skipped:    skipCount,
      errors:     errCount,
      details:    results,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[backfill]", msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
