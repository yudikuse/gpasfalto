"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type ObraRow = {
  id: number;
  obra: string;
  ativo?: boolean | null;
};

type EquipamentoRow = {
  id: number;
  codigo: string;
  obra_padrao_id?: number | null;
  usa_horimetro?: boolean | null;
  usa_odometro?: boolean | null;
  ativo?: boolean | null;
  observacao?: string | null;
  horimetro_base?: number | null;
  odometro_base?: number | null;
};

type LeituraRow = {
  id: number;
  data: string;
  obra_id?: number | null;
  equipamento_id: number;
  horimetro_inicial?: number | null;
  horimetro_final?: number | null;
  horas_trabalhadas?: number | null;
  odometro_inicial?: number | null;
  odometro_final?: number | null;
  km_rodados?: number | null;
  observacao?: string | null;
  status?: string | null;
  updated_by_user_id?: string | null;
  updated_by_nome?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type RowState = {
  equipamentoId: number;
  codigo: string;
  obraId: string;
  obraPadraoId: number | null;
  usaHorimetro: boolean;
  usaOdometro: boolean;
  horimetroAnterior: number | null;
  horimetroAtual: string;
  horasDia: number | null;
  odometroAnterior: number | null;
  odometroAtual: string;
  kmDia: number | null;
  observacao: string;
  registroId: number | null;
  updatedAt: string | null;
  updatedByNome: string | null;
};

function pad(n: number, size: number) {
  const s = String(n);
  return s.length >= size ? s : "0".repeat(size - s.length) + s;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

function isoToBr(iso: string) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || "—";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function previousIso(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

function resolveSupabaseEnv(): { ok: boolean; url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const key = publishable || anon;
  return { ok: Boolean(url && key), url, key };
}

function normCode(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "-");
}

function format1(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatInput1(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function parsePtNumber(value: string) {
  const s = String(value || "").trim();
  if (!s) return null;
  const cleaned = s.replace(/\./g, "").replace(/,/g, ".").replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function sanitizeDecimalDraft(value: string) {
  let s = String(value || "")
    .replace(/\s+/g, "")
    .replace(/\./g, ",")
    .replace(/[^0-9,\-]/g, "");

  const negative = s.startsWith("-");
  s = s.replace(/-/g, "");

  const parts = s.split(",");
  const intPart = (parts[0] || "").replace(/\D/g, "");
  const decPart = parts.length > 1 ? (parts.slice(1).join("") || "").replace(/\D/g, "").slice(0, 1) : "";

  return {
    negative,
    hasComma: parts.length > 1,
    intPart,
    decPart,
  };
}

function formatThousandsPtBrFromDigits(digits: string) {
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatDecimalWhileTyping(value: string) {
  const { negative, hasComma, intPart, decPart } = sanitizeDecimalDraft(value);
  const cleanInt = intPart.replace(/^0+(?=\d)/, "");
  const formattedInt = formatThousandsPtBrFromDigits(cleanInt || (hasComma ? "0" : ""));
  const signal = negative ? "-" : "";

  if (!hasComma) return `${signal}${formattedInt}`;
  return `${signal}${formattedInt},${decPart}`;
}

function finalizeDecimalInput(value: string) {
  const n = parsePtNumber(value);
  return n == null ? "" : formatInput1(n);
}

function safeDiff(finalValue: number | null, initialValue: number | null) {
  if (finalValue == null || initialValue == null) return null;
  const diff = Number((finalValue - initialValue).toFixed(1));
  return Number.isFinite(diff) ? diff : null;
}

function buildRows(params: {
  equipamentos: EquipamentoRow[];
  atuais: LeituraRow[];
  anteriores: LeituraRow[];
}): RowState[] {
  const { equipamentos, atuais, anteriores } = params;
  const atualMap = new Map<number, LeituraRow>();
  const anteriorMap = new Map<number, LeituraRow>();

  for (const row of atuais) atualMap.set(Number(row.equipamento_id), row);
  for (const row of anteriores) {
    const key = Number(row.equipamento_id);
    if (!anteriorMap.has(key)) anteriorMap.set(key, row);
  }

  return equipamentos.map((eq) => {
    const atual = atualMap.get(eq.id);
    const anterior = anteriorMap.get(eq.id);

    const horimetroAnterior =
      atual?.horimetro_inicial ?? anterior?.horimetro_final ?? eq.horimetro_base ?? null;
    const odometroAnterior =
      atual?.odometro_inicial ?? anterior?.odometro_final ?? eq.odometro_base ?? null;

    const horimetroAtualNum = atual?.horimetro_final ?? null;
    const odometroAtualNum = atual?.odometro_final ?? null;

    const horasDia = atual?.horas_trabalhadas ?? safeDiff(horimetroAtualNum, horimetroAnterior);
    const kmDia = atual?.km_rodados ?? safeDiff(odometroAtualNum, odometroAnterior);

    return {
      equipamentoId: eq.id,
      codigo: eq.codigo,
      obraId: String(atual?.obra_id ?? eq.obra_padrao_id ?? ""),
      obraPadraoId: eq.obra_padrao_id ?? null,
      usaHorimetro: Boolean(eq.usa_horimetro),
      usaOdometro: Boolean(eq.usa_odometro),
      horimetroAnterior,
      horimetroAtual: formatInput1(horimetroAtualNum),
      horasDia,
      odometroAnterior,
      odometroAtual: formatInput1(odometroAtualNum),
      kmDia,
      observacao: String(atual?.observacao || ""),
      registroId: atual?.id ?? null,
      updatedAt: atual?.updated_at ?? null,
      updatedByNome: atual?.updated_by_nome ?? null,
    };
  });
}

export default function HorimetrosPage() {
  const env = resolveSupabaseEnv();

  const supabase: SupabaseClient | null = useMemo(() => {
    if (!env.ok) return null;
    return createClient(env.url, env.key);
  }, [env.ok, env.key, env.url]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [search, setSearch] = useState("");
  const [obras, setObras] = useState<ObraRow[]>([]);
  const [rows, setRows] = useState<RowState[]>([]);

  const periodoAnterior = useMemo(() => previousIso(selectedDate), [selectedDate]);

  const obraNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const obra of obras) map.set(Number(obra.id), String(obra.obra || ""));
    return map;
  }, [obras]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const obraNome = obraNameById.get(Number(row.obraId)) || "";
      return row.codigo.toLowerCase().includes(q) || obraNome.toLowerCase().includes(q);
    });
  }, [rows, search, obraNameById]);

  const stats = useMemo(() => {
    const total = rows.length;
    const lancados = rows.filter((row) => row.registroId != null).length;
    const pendentes = Math.max(total - lancados, 0);
    return { total, lancados, pendentes };
  }, [rows]);

  const loadData = useCallback(async () => {
    if (!supabase) return;

    setLoading(true);
    setErrorMsg("");
    setOkMsg("");

    try {
      const [obrasRes, equipamentosRes, atuaisRes, anterioresRes] = await Promise.all([
        supabase
          .from("obras")
          .select("id,obra,ativo")
          .eq("ativo", true)
          .order("obra", { ascending: true })
          .limit(500),
        supabase
          .from("horimetro_equipamentos")
          .select(
            "id,codigo,obra_padrao_id,usa_horimetro,usa_odometro,ativo,observacao,horimetro_base,odometro_base"
          )
          .eq("ativo", true)
          .order("codigo", { ascending: true })
          .limit(500),
        supabase
          .from("horimetro_leituras_diarias")
          .select(
            "id,data,obra_id,equipamento_id,horimetro_inicial,horimetro_final,horas_trabalhadas,odometro_inicial,odometro_final,km_rodados,observacao,status,updated_by_user_id,updated_by_nome,updated_at,created_at"
          )
          .eq("data", selectedDate)
          .order("equipamento_id", { ascending: true })
          .limit(1000),
        supabase
          .from("horimetro_leituras_diarias")
          .select(
            "id,data,obra_id,equipamento_id,horimetro_inicial,horimetro_final,horas_trabalhadas,odometro_inicial,odometro_final,km_rodados,observacao,status,updated_by_user_id,updated_by_nome,updated_at,created_at"
          )
          .lt("data", selectedDate)
          .order("data", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(5000),
      ]);

      if (obrasRes.error) throw obrasRes.error;
      if (equipamentosRes.error) throw equipamentosRes.error;
      if (atuaisRes.error) throw atuaisRes.error;
      if (anterioresRes.error) throw anterioresRes.error;

      const obrasData = (obrasRes.data || []) as ObraRow[];
      const equipamentosData = ((equipamentosRes.data || []) as EquipamentoRow[]).sort((a, b) =>
        normCode(a.codigo).localeCompare(normCode(b.codigo), "pt-BR")
      );

      const anterioresDedup: LeituraRow[] = [];
      const seen = new Set<number>();
      for (const row of (anterioresRes.data || []) as LeituraRow[]) {
        const eqId = Number(row.equipamento_id);
        if (seen.has(eqId)) continue;
        seen.add(eqId);
        anterioresDedup.push(row);
      }

      setObras(obrasData);
      setRows(
        buildRows({
          equipamentos: equipamentosData,
          atuais: (atuaisRes.data || []) as LeituraRow[],
          anteriores: anterioresDedup,
        })
      );
    } catch (e: any) {
      setRows([]);
      setErrorMsg(e?.message || "Erro ao carregar horímetros.");
    } finally {
      setLoading(false);
    }
  }, [selectedDate, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateRow = useCallback((equipamentoId: number, patch: Partial<RowState>) => {
    setRows((current) =>
      current.map((row) => {
        if (row.equipamentoId !== equipamentoId) return row;
        const next: RowState = { ...row, ...patch };

        const hAtual = parsePtNumber(next.horimetroAtual);
        const oAtual = parsePtNumber(next.odometroAtual);

        next.horasDia = safeDiff(hAtual, next.horimetroAnterior);
        next.kmDia = safeDiff(oAtual, next.odometroAnterior);

        return next;
      })
    );
  }, []);

  const handleSaveAll = useCallback(async () => {
    if (!supabase) return;

    setSaving(true);
    setErrorMsg("");
    setOkMsg("");

    try {
      const authRes = await supabase.auth.getUser();
      const user = authRes.data.user;
      const updatedByName = user?.email || user?.user_metadata?.name || "Usuário";
      const updatedById = user?.id || null;

      for (const row of rows) {
        const horimetroFinal = row.usaHorimetro ? parsePtNumber(row.horimetroAtual) : null;
        const odometroFinal = row.usaOdometro ? parsePtNumber(row.odometroAtual) : null;
        const horasDia = row.usaHorimetro ? safeDiff(horimetroFinal, row.horimetroAnterior) : null;
        const kmDia = row.usaOdometro ? safeDiff(odometroFinal, row.odometroAnterior) : null;

        const hasSomethingToSave =
          row.registroId != null ||
          Boolean(String(row.observacao || "").trim()) ||
          Boolean(String(row.obraId || "").trim()) ||
          horimetroFinal != null ||
          odometroFinal != null;

        if (!hasSomethingToSave) continue;

        const payload = {
          data: selectedDate,
          obra_id: row.obraId ? Number(row.obraId) : null,
          equipamento_id: row.equipamentoId,
          horimetro_inicial: row.usaHorimetro ? row.horimetroAnterior : null,
          horimetro_final: row.usaHorimetro ? horimetroFinal : null,
          horas_trabalhadas: row.usaHorimetro ? horasDia : null,
          odometro_inicial: row.usaOdometro ? row.odometroAnterior : null,
          odometro_final: row.usaOdometro ? odometroFinal : null,
          km_rodados: row.usaOdometro ? kmDia : null,
          observacao: String(row.observacao || "").trim() || null,
          status: horimetroFinal != null || odometroFinal != null ? "LANCADO" : "PENDENTE",
          updated_by_user_id: updatedById,
          updated_by_nome: updatedByName,
          updated_at: new Date().toISOString(),
        };

        if (row.registroId != null) {
          const res = await supabase
            .from("horimetro_leituras_diarias")
            .update(payload)
            .eq("id", row.registroId);
          if (res.error) throw res.error;
        } else {
          const res = await supabase
            .from("horimetro_leituras_diarias")
            .insert(payload)
            .select("id")
            .single();
          if (res.error) throw res.error;
        }
      }

      setOkMsg("Salvo com sucesso.");
      await loadData();
    } catch (e: any) {
      setErrorMsg(e?.message || "Erro ao salvar lançamentos.");
    } finally {
      setSaving(false);
    }
  }, [loadData, rows, selectedDate, supabase]);

  return (
    <>
      <style jsx global>{`
        :root {
          --bg: #f4f7fb;
          --surface: #ffffff;
          --surface-2: #f8fbff;
          --surface-3: #eef4fb;
          --text: #0f172a;
          --muted: #6b7280;
          --blue: #0f3d91;
          --blue-soft: #dbeafe;
          --green: #0f9f6e;
          --green-soft: #eafaf4;
          --yellow: #f5b301;
          --danger: #d84d4d;
          --danger-soft: #fff3f3;
          --radius-xl: 28px;
          --radius-lg: 22px;
          --radius-md: 18px;
          --radius-sm: 14px;
          --shadow-1: 0 16px 40px rgba(15, 23, 42, 0.06);
          --shadow-2: 0 8px 24px rgba(15, 23, 42, 0.05);
        }

        * {
          box-sizing: border-box;
        }

        html,
        body {
          margin: 0;
          padding: 0;
          background: linear-gradient(180deg, #f7faff 0%, #f1f5f9 100%);
          color: var(--text);
        }

        body {
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        input,
        select,
        button,
        textarea {
          font: inherit;
        }

        .page {
          min-height: 100vh;
          padding: 16px 12px 120px;
        }

        .wrap {
          width: 100%;
          max-width: 860px;
          margin: 0 auto;
          display: grid;
          gap: 14px;
        }

        .hero {
          background: linear-gradient(145deg, #08214d 0%, #10397f 58%, #2053ab 100%);
          border-radius: 28px;
          box-shadow: 0 22px 48px rgba(16, 57, 127, 0.24);
          padding: 18px;
          color: #fff;
        }

        .hero-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .brand-logo {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.16);
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          backdrop-filter: blur(8px);
        }

        .brand-logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .eyebrow {
          margin: 0 0 4px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          opacity: 0.78;
        }

        .title {
          margin: 0;
          font-size: 28px;
          line-height: 1;
          font-weight: 900;
          letter-spacing: -0.04em;
        }

        .subtitle {
          margin: 10px 0 0;
          color: rgba(255, 255, 255, 0.86);
          font-size: 13px;
          line-height: 1.45;
          max-width: 540px;
          font-weight: 600;
        }

        .hero-stats {
          margin-top: 16px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .hero-stat {
          min-height: 74px;
          background: rgba(255, 255, 255, 0.12);
          border-radius: 18px;
          padding: 12px;
          backdrop-filter: blur(10px);
        }

        .hero-stat-label {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          opacity: 0.8;
        }

        .hero-stat-value {
          margin-top: 6px;
          font-size: 28px;
          line-height: 1;
          font-weight: 900;
          letter-spacing: -0.04em;
        }

        .hero-stat-note {
          margin-top: 6px;
          font-size: 12px;
          line-height: 1.25;
          opacity: 0.82;
          font-weight: 600;
        }

        .toolbar {
          position: sticky;
          top: 10px;
          z-index: 30;
          background: rgba(244, 247, 251, 0.86);
          backdrop-filter: blur(16px);
          border-radius: 26px;
          padding: 10px;
        }

        .toolbar-grid {
          display: grid;
          gap: 10px;
          grid-template-columns: 1fr 150px;
        }

        .search-shell,
        .date-shell,
        .action-shell,
        .message,
        .card {
          background: var(--surface);
          border-radius: 22px;
          box-shadow: var(--shadow-2);
        }

        .search-shell,
        .date-shell {
          padding: 8px;
        }

        .field-label {
          display: block;
          padding: 0 6px 6px;
          font-size: 10px;
          font-weight: 900;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .search-input,
        .date-input,
        .select,
        .text-input,
        .number-input {
          width: 100%;
          height: 46px;
          border: 0;
          outline: none;
          background: var(--surface-2);
          border-radius: 16px;
          padding: 0 14px;
          color: var(--text);
          font-size: 15px;
          font-weight: 700;
          box-shadow: inset 0 0 0 1px transparent;
          transition: box-shadow 0.16s ease, background 0.16s ease, transform 0.16s ease;
        }

        .text-input {
          padding-right: 16px;
        }

        .search-input:focus,
        .date-input:focus,
        .select:focus,
        .text-input:focus,
        .number-input:focus {
          background: #edf5ff;
          box-shadow: inset 0 0 0 2px rgba(32, 83, 171, 0.14);
        }

        .number-input[disabled],
        .text-input[disabled],
        .select[disabled] {
          background: #eef2f7;
          color: #9aa4b2;
        }

        .number-input {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .action-shell {
          padding: 8px;
          display: grid;
          align-items: end;
        }

        .save-btn {
          width: 100%;
          height: 62px;
          border: 0;
          outline: none;
          border-radius: 18px;
          background: linear-gradient(135deg, #f7c321 0%, #f4b400 100%);
          color: #13233f;
          font-size: 16px;
          font-weight: 900;
          box-shadow: 0 14px 32px rgba(244, 180, 0, 0.26);
          cursor: pointer;
        }

        .save-btn[disabled] {
          opacity: 0.7;
          cursor: wait;
        }

        .chips {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding: 2px 2px 0;
          scrollbar-width: none;
        }

        .chips::-webkit-scrollbar {
          display: none;
        }

        .chip {
          white-space: nowrap;
          border: 0;
          border-radius: 999px;
          background: var(--surface);
          box-shadow: var(--shadow-2);
          padding: 10px 14px;
          font-size: 12px;
          font-weight: 800;
          color: #334155;
        }

        .message {
          padding: 14px 16px;
          font-size: 14px;
          font-weight: 800;
          line-height: 1.45;
        }

        .message.error {
          background: var(--danger-soft);
          color: #9a2d2d;
        }

        .message.ok {
          background: var(--green-soft);
          color: #0b7b52;
        }

        .message.warn {
          background: #fff7df;
          color: #8a6200;
        }

        .list {
          display: grid;
          gap: 12px;
        }

        .card {
          padding: 14px;
          display: grid;
          gap: 14px;
        }

        .card-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .equip-box {
          min-width: 0;
        }

        .equip-code {
          margin: 0;
          font-size: 24px;
          line-height: 1;
          font-weight: 900;
          letter-spacing: -0.04em;
          color: #0f172a;
        }

        .equip-sub {
          margin-top: 6px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .mini-tag {
          border-radius: 999px;
          padding: 6px 10px;
          background: var(--surface-3);
          color: #355076;
          font-size: 11px;
          font-weight: 800;
        }

        .status-pill {
          flex: 0 0 auto;
          min-width: fit-content;
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 900;
          background: #eef2f7;
          color: #64748b;
        }

        .status-pill.saved {
          background: var(--green-soft);
          color: #0b7b52;
        }

        .section-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
        }

        .panel {
          background: var(--surface-2);
          border-radius: 20px;
          padding: 12px;
        }

        .panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 10px;
        }

        .panel-title {
          font-size: 12px;
          font-weight: 900;
          color: #334155;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .panel-date {
          font-size: 11px;
          font-weight: 800;
          color: #64748b;
        }

        .reading-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }

        .reading-box {
          background: #fff;
          border-radius: 18px;
          padding: 12px;
          min-height: 78px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .reading-label {
          font-size: 11px;
          font-weight: 800;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .reading-value {
          margin-top: 8px;
          font-size: 22px;
          font-weight: 900;
          letter-spacing: -0.04em;
          color: #0f172a;
          line-height: 1;
        }

        .reading-value.muted {
          color: #94a3b8;
        }

        .reading-value.positive {
          color: var(--green);
        }

        .reading-value.negative {
          color: var(--danger);
        }

        .stack {
          display: grid;
          gap: 10px;
        }

        .meta {
          display: grid;
          gap: 4px;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
        }

        .empty {
          padding: 22px 18px;
          text-align: center;
          background: var(--surface);
          border-radius: 22px;
          box-shadow: var(--shadow-2);
          color: #64748b;
          font-size: 14px;
          font-weight: 800;
        }

        @media (min-width: 768px) {
          .page {
            padding: 22px 18px 120px;
          }

          .hero {
            padding: 22px;
          }

          .toolbar-grid {
            grid-template-columns: 1.4fr 220px 180px;
          }

          .section-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .stack.two {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      `}</style>

      <main className="page">
        <div className="wrap">
          <section className="hero">
            <div className="hero-head">
              <div className="brand">
                <div className="brand-logo">
                  <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
                </div>
                <div>
                  <p className="eyebrow">GP Asfalto</p>
                  <h1 className="title">Horímetros</h1>
                </div>
              </div>
            </div>

            <p className="subtitle">
              Tela mobile, limpa e applike. Sem tabela pesada. Cada equipamento fica em um card com leitura anterior, leitura atual e resultado do dia.
            </p>

            <div className="hero-stats">
              <div className="hero-stat">
                <div className="hero-stat-label">Equipamentos</div>
                <div className="hero-stat-value">{stats.total}</div>
                <div className="hero-stat-note">Linhas disponíveis</div>
              </div>
              <div className="hero-stat">
                <div className="hero-stat-label">Lançados</div>
                <div className="hero-stat-value">{stats.lancados}</div>
                <div className="hero-stat-note">Já salvos no dia</div>
              </div>
              <div className="hero-stat">
                <div className="hero-stat-label">Pendentes</div>
                <div className="hero-stat-value">{stats.pendentes}</div>
                <div className="hero-stat-note">Aguardando leitura</div>
              </div>
            </div>
          </section>

          <section className="toolbar">
            <div className="toolbar-grid">
              <div className="search-shell">
                <label className="field-label" htmlFor="busca-equipamento">
                  Buscar equipamento
                </label>
                <input
                  id="busca-equipamento"
                  className="search-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Ex.: CB-02, obra..."
                />
              </div>

              <div className="date-shell">
                <label className="field-label" htmlFor="data-lancamento">
                  Data do lançamento
                </label>
                <input
                  id="data-lancamento"
                  className="date-input"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>

              <div className="action-shell">
                <button
                  className="save-btn"
                  type="button"
                  onClick={() => void handleSaveAll()}
                  disabled={saving || loading || !env.ok}
                >
                  {saving ? "Salvando..." : "Salvar tudo"}
                </button>
              </div>
            </div>
          </section>

          <div className="chips">
            <div className="chip">Anterior: {isoToBr(periodoAnterior)}</div>
            <div className="chip">Atual: {isoToBr(selectedDate)}</div>
            <div className="chip">Máscara pt-BR automática</div>
            <div className="chip">Leitura anterior bloqueada</div>
          </div>

          {!env.ok ? (
            <div className="message warn">
              Defina no Vercel: NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ou NEXT_PUBLIC_SUPABASE_ANON_KEY.
            </div>
          ) : null}

          {errorMsg ? <div className="message error">{errorMsg}</div> : null}
          {okMsg ? <div className="message ok">{okMsg}</div> : null}

          {loading ? (
            <div className="empty">Carregando...</div>
          ) : filteredRows.length === 0 ? (
            <div className="empty">Nenhum equipamento encontrado.</div>
          ) : (
            <section className="list">
              {filteredRows.map((row) => {
                const horasNegative = (row.horasDia ?? 0) < 0;
                const kmNegative = (row.kmDia ?? 0) < 0;

                return (
                  <article key={row.equipamentoId} className="card">
                    <div className="card-top">
                      <div className="equip-box">
                        <h2 className="equip-code">{row.codigo}</h2>
                        <div className="equip-sub">
                          {row.usaHorimetro ? <span className="mini-tag">Horímetro</span> : null}
                          {row.usaOdometro ? <span className="mini-tag">Odômetro</span> : null}
                          {!row.usaHorimetro && !row.usaOdometro ? <span className="mini-tag">Sem leitura</span> : null}
                        </div>
                      </div>

                      <div className={`status-pill ${row.registroId ? "saved" : ""}`}>
                        {row.registroId ? "Salvo" : "Pendente"}
                      </div>
                    </div>

                    <div className="stack">
                      <div>
                        <label className="field-label">Obra</label>
                        <select
                          className="select"
                          value={row.obraId}
                          onChange={(e) => updateRow(row.equipamentoId, { obraId: e.target.value })}
                        >
                          <option value="">Selecione</option>
                          {obras.map((obra) => (
                            <option key={obra.id} value={obra.id}>
                              {obra.obra}
                            </option>
                          ))}
                        </select>
                      </div>

                      {row.usaHorimetro ? (
                        <div className="panel">
                          <div className="panel-head">
                            <div className="panel-title">Horímetro</div>
                            <div className="panel-date">{isoToBr(selectedDate)}</div>
                          </div>

                          <div className="reading-grid">
                            <div className="reading-box">
                              <div className="reading-label">Anterior {isoToBr(periodoAnterior)}</div>
                              <div className="reading-value">{format1(row.horimetroAnterior)}</div>
                            </div>

                            <div>
                              <label className="field-label">Atual</label>
                              <input
                                type="text"
                                className="number-input"
                                value={row.horimetroAtual}
                                onChange={(e) =>
                                  updateRow(row.equipamentoId, {
                                    horimetroAtual: formatDecimalWhileTyping(e.target.value),
                                  })
                                }
                                onBlur={(e) =>
                                  updateRow(row.equipamentoId, {
                                    horimetroAtual: finalizeDecimalInput(e.target.value),
                                  })
                                }
                                inputMode="decimal"
                                placeholder="Digite"
                              />
                            </div>

                            <div className="reading-box">
                              <div className="reading-label">Horas do dia</div>
                              <div
                                className={`reading-value ${
                                  horasNegative ? "negative" : row.horasDia == null ? "muted" : "positive"
                                }`}
                              >
                                {format1(row.horasDia)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {row.usaOdometro ? (
                        <div className="panel">
                          <div className="panel-head">
                            <div className="panel-title">Odômetro</div>
                            <div className="panel-date">{isoToBr(selectedDate)}</div>
                          </div>

                          <div className="reading-grid">
                            <div className="reading-box">
                              <div className="reading-label">Anterior {isoToBr(periodoAnterior)}</div>
                              <div className="reading-value">{format1(row.odometroAnterior)}</div>
                            </div>

                            <div>
                              <label className="field-label">Atual</label>
                              <input
                                type="text"
                                className="number-input"
                                value={row.odometroAtual}
                                onChange={(e) =>
                                  updateRow(row.equipamentoId, {
                                    odometroAtual: formatDecimalWhileTyping(e.target.value),
                                  })
                                }
                                onBlur={(e) =>
                                  updateRow(row.equipamentoId, {
                                    odometroAtual: finalizeDecimalInput(e.target.value),
                                  })
                                }
                                inputMode="decimal"
                                placeholder="Digite"
                              />
                            </div>

                            <div className="reading-box">
                              <div className="reading-label">KM do dia</div>
                              <div
                                className={`reading-value ${
                                  kmNegative ? "negative" : row.kmDia == null ? "muted" : "positive"
                                }`}
                              >
                                {format1(row.kmDia)}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      <div className="stack two">
                        <div>
                          <label className="field-label">Observação</label>
                          <input
                            className="text-input"
                            value={row.observacao}
                            onChange={(e) => updateRow(row.equipamentoId, { observacao: e.target.value })}
                            placeholder="Observação"
                          />
                        </div>

                        <div className="panel">
                          <div className="panel-title" style={{ marginBottom: 10 }}>
                            Última atualização
                          </div>
                          <div className="meta">
                            <div>{row.updatedAt ? new Date(row.updatedAt).toLocaleString("pt-BR") : "Ainda não salvo neste dia"}</div>
                            <div>{row.updatedByNome || "—"}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </div>
      </main>
    </>
  );
}
