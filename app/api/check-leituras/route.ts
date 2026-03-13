/**
 * app/api/check-leituras/route.ts
 *
 * Disparado pelo Vercel Cron às 16h, 18h e 20h (horário de Brasília).
 * Consulta o Supabase e envia alerta via WhatsApp se houver equipamentos
 * sem leitura no dia.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enviarMensagemWhatsApp } from "@/lib/evolution";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type EquipamentoPendente = {
  codigo: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Retorna a data de hoje no fuso de Brasília (UTC-3) no formato YYYY-MM-DD */
function hojeNoBrasil(): string {
  const agora = new Date();
  // Brasília = UTC-3
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const y = brasilia.getUTCFullYear();
  const m = pad(brasilia.getUTCMonth() + 1);
  const d = pad(brasilia.getUTCDate());
  return `${y}-${m}-${d}`;
}

/** Retorna "16:00", "18:00" ou "20:00" baseado na hora UTC atual */
function horarioAlerta(): string {
  const horaUtc = new Date().getUTCHours();
  // 19 UTC = 16h Brasília, 21 UTC = 18h, 23 UTC = 20h
  const mapa: Record<number, string> = {
    19: "16:00",
    21: "18:00",
    23: "20:00",
  };
  return mapa[horaUtc] ?? `${pad(horaUtc - 3)}:00`;
}

/** Monta o texto da mensagem WhatsApp */
function montarMensagem(
  pendentes: EquipamentoPendente[],
  total: number,
  horario: string,
  hoje: string
): string {
  const [ano, mes, dia] = hoje.split("-");
  const dataFmt = `${dia}/${mes}/${ano}`;

  if (pendentes.length === 0) {
    return (
      `✅ *GP Asfalto · ${horario} · ${dataFmt}*\n` +
      `Todos os ${total} equipamentos foram registrados hoje. Boa operação! 👏`
    );
  }

  const MAX_LISTADOS = 20;
  const listados = pendentes.slice(0, MAX_LISTADOS).map((e) => e.codigo);
  const extras = pendentes.length - MAX_LISTADOS;

  let lista = listados.join(", ");
  if (extras > 0) lista += ` e mais ${extras}`;

  return (
    `⚠️ *GP Asfalto · Alerta ${horario} · ${dataFmt}*\n\n` +
    `*${pendentes.length} de ${total} equipamentos* sem leitura hoje:\n\n` +
    `${lista}\n\n` +
    `📲 Acesse e registre: https://gpasfalto.vercel.app`
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Segurança: o Vercel envia o header CRON_SECRET em todas as chamadas de cron.
  // Chamadas manuais precisam passar o mesmo secret como Bearer token.
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! // service role para leitura server-side
    );

    const hoje = hojeNoBrasil();

    // 1. Busca todos os equipamentos ativos
    const { data: equipamentos, error: eqErr } = await supabase
      .from("horimetro_equipamentos")
      .select("id, codigo")
      .eq("ativo", true)
      .order("codigo");

    if (eqErr) throw eqErr;
    if (!equipamentos || equipamentos.length === 0) {
      return NextResponse.json({ ok: true, info: "Nenhum equipamento ativo." });
    }

    // 2. Busca os que já têm leitura hoje
    const { data: leituras, error: leitErr } = await supabase
      .from("horimetro_leituras_diarias")
      .select("equipamento_id")
      .eq("data", hoje);

    if (leitErr) throw leitErr;

    const idsRegistrados = new Set((leituras ?? []).map((l) => l.equipamento_id));

    // 3. Filtra os pendentes
    const pendentes: EquipamentoPendente[] = equipamentos
      .filter((eq) => !idsRegistrados.has(eq.id))
      .map((eq) => ({ codigo: eq.codigo }));

    const horario = horarioAlerta();
    const mensagem = montarMensagem(pendentes, equipamentos.length, horario, hoje);

    // 4. Só envia se houver pendentes (ou se for o alerta de 20h — envia sempre)
    const horaUtc = new Date().getUTCHours();
    const deveEnviar = pendentes.length > 0 || horaUtc === 23;

    if (deveEnviar) {
      await enviarMensagemWhatsApp(mensagem);
    }

    return NextResponse.json({
      ok: true,
      data: hoje,
      horario,
      total: equipamentos.length,
      registrados: idsRegistrados.size,
      pendentes: pendentes.length,
      mensagemEnviada: deveEnviar,
      equipamentesPendentes: pendentes.map((p) => p.codigo),
    });
  } catch (err: any) {
    console.error("[check-leituras]", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Erro desconhecido" },
      { status: 500 }
    );
  }
}
