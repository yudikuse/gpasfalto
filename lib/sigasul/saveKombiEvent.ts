import type { SupabaseClient } from "@supabase/supabase-js";

export type SaveKombiEventInput = {
  dia_brt: string; // YYYY-MM-DD
  codigo_equipamento: string | null | undefined;
  placa?: string | null | undefined;
  obra: string | null | undefined;
  evento: "ENTRADA" | "SAIDA" | string | null | undefined;
  evento_at: string | null | undefined; // ISO string
  origem?: string | null | undefined;
};

function clean(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}

export async function saveKombiEvent(
  supabase: SupabaseClient,
  input: SaveKombiEventInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const codigo = clean(input.codigo_equipamento)?.toUpperCase() ?? null;
  const placa = clean(input.placa) ?? null;
  const obra = clean(input.obra);
  const evento = clean(input.evento)?.toUpperCase() ?? null;
  const eventoAt = clean(input.evento_at);
  const origem = clean(input.origem) ?? "geofence";

  if (!codigo || !codigo.startsWith("KB-")) {
    return { ok: true };
  }

  if (!obra) {
    return { ok: true };
  }

  if (evento !== "ENTRADA" && evento !== "SAIDA") {
    return { ok: true };
  }

  if (!eventoAt) {
    return { ok: false, error: "evento_at ausente" };
  }

  const { error } = await supabase.rpc("gp_save_kombi_event", {
    p_dia_brt: input.dia_brt,
    p_codigo_equipamento: codigo,
    p_placa: placa,
    p_obra: obra,
    p_evento: evento,
    p_evento_at: eventoAt,
    p_origem: origem,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
