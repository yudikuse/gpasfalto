// FILE: app/api/cron/horimetros/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
import { enviarMensagemWhatsApp } from "@/lib/evolution";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Data de hoje no fuso Brasília (UTC-3) */
function hojeNoBrasil(): string {
  const agora = new Date();
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  const y = brasilia.getUTCFullYear();
  const m = pad(brasilia.getUTCMonth() + 1);
  const d = pad(brasilia.getUTCDate());
  return `${y}-${m}-${d}`;
}

/** "16:00", "18:00" ou "20:00" conforme hora UTC do disparo */
function horarioAlerta(): string {
  const h = new Date().getUTCHours();
  const mapa: Record<number, string> = { 19: "16:00", 21: "18:00", 23: "20:00" };
  return mapa[h] ?? `${pad(h - 3)}:00`;
}

/** Monta o texto da mensagem WhatsApp */
function montarMensagem(
  pendentes: string[],
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

  const MAX = 20;
  let lista = pendentes.slice(0, MAX).join(", ");
  const extras = pendentes.length - MAX;
  if (extras > 0) lista += ` e mais ${extras}`;

  return (
    `⚠️ *GP Asfalto · Alerta ${horario} · ${dataFmt}*\n\n` +
    `*${pendentes.length} de ${total} equipamentos* sem leitura hoje:\n\n` +
    `${lista}\n\n` +
    `📲 https://gpasfalto.vercel.app/horimetros`
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Proteção: Vercel envia CRON_SECRET automaticamente; chamadas manuais também precisam dele
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!  // service role — só usado server-side
    );

    const hoje = hojeNoBrasil();

    // 1. Todos os equipamentos ativos
    const { data: equipamentos, error: eqErr } = await supabase
      .from("horimetro_equipamentos")
      .select("id, codigo")
      .eq("ativo", true)
      .order("codigo");

    if (eqErr) throw eqErr;
    if (!equipamentos?.length) {
      return Response.json({ ok: true, info: "Nenhum equipamento ativo." });
    }

    // 2. Quais já têm leitura hoje
    const { data: leituras, error: leitErr } = await supabase
      .from("horimetro_leituras_diarias")
      .select("equipamento_id")
      .eq("data", hoje);

    if (leitErr) throw leitErr;

    const idsRegistrados = new Set((leituras ?? []).map((l) => l.equipamento_id));

    // 3. Pendentes = ativos sem leitura hoje
    const pendentes = equipamentos
      .filter((eq) => !idsRegistrados.has(eq.id))
      .map((eq) => eq.codigo as string);

    const horario = horarioAlerta();
    const mensagem = montarMensagem(pendentes, equipamentos.length, horario, hoje);

    // Alerta de 20h envia sempre (resumo do dia); outros só se houver pendentes
    const horaUtc = new Date().getUTCHours();
    const deveEnviar = pendentes.length > 0 || horaUtc === 23;

    if (deveEnviar) {
      await enviarMensagemWhatsApp(mensagem);
    }

    return Response.json({
      ok: true,
      data: hoje,
      horario,
      total: equipamentos.length,
      registrados: idsRegistrados.size,
      pendentes: pendentes.length,
      mensagemEnviada: deveEnviar,
      equipamentosPendentes: pendentes,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[cron/horimetros]", msg);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
