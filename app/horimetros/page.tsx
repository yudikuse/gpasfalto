"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type MeasurementMode = "horimetro" | "odometro";

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
  selectedMode: MeasurementMode;
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

  const normalized = s.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") return null;

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function formatDecimalWhileTyping(value: string) {
  let raw = String(value || "");

  const hasTrailingComma = raw.endsWith(",") || raw.endsWith(".");
  raw = raw.replace(/\./g, ",");
  raw = raw.replace(/[^0-9,-]/g, "");

  const negative = raw.startsWith("-");
  raw = raw.replace(/-/g, "");

  const parts = raw.split(",");
  const intDigits = (parts[0] || "").replace(/\D/g, "");
  const decDigits = parts.slice(1).join("").replace(/\D/g, "").slice(0, 1);

  const intNormalized = intDigits.replace(/^0+(?=\d)/, "") || (intDigits ? "0" : "");
  const intFormatted = intNormalized
    ? intNormalized.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
    : "";

  const prefix = negative ? "-" : "";

  if (hasTrailingComma && parts.length === 1) {
    return `${prefix}${intFormatted || "0"},`;
  }

  if (parts.length > 1) {
    return `${prefix}${intFormatted || "0"},${decDigits}`;
  }

  return `${prefix}${intFormatted}`;
}

function finalizeDecimalInput(value: string) {
  const parsed = parsePtNumber(value);
  return parsed == null ? "" : formatInput1(parsed);
}

function safeDiff(finalValue: number | null, initialValue: number | null) {
  if (finalValue == null || initialValue == null) return null;
  const diff = Number((finalValue - initialValue).toFixed(1));
  return Number.isFinite(diff) ? diff : null;
}

function modeFromPrefix(codigo: string): MeasurementMode {
  const code = normCode(codigo);
  if (
    code.startsWith("CB") ||
    code.startsWith("CC") ||
    code.startsWith("CP") ||
    code.startsWith("KB")
  ) {
    return "odometro";
  }
  return "horimetro";
}

function resolveInitialMode(eq: EquipamentoRow, atual?: LeituraRow | null): MeasurementMode {
  const hasH =
    atual?.horimetro_final != null ||
    atual?.horimetro_inicial != null ||
    eq.usa_horimetro === true;

  const hasO =
    atual?.odometro_final != null ||
    atual?.odometro_inicial != null ||
    eq.usa_odometro === true;

  if (hasH && !hasO) return "horimetro";
  if (hasO && !hasH) return "odometro";

  return modeFromPrefix(eq.codigo);
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
      selectedMode: resolveInitialMode(eq, atual),
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

function getPreviousValue(row: RowState) {
  return row.selectedMode === "horimetro" ? row.horimetroAnterior : row.odometroAnterior;
}

function getCurrentValue(row: RowState) {
  return row.selectedMode === "horimetro" ? row.horimetroAtual : row.odometroAtual;
}

function getDayValue(row: RowState) {
  return row.selectedMode === "horimetro" ? row.horasDia : row.kmDia;
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

  const stats = useMemo(() => {
    const total = rows.length;
    const lancados = rows.filter((row) => row.registroId != null).length;
    const pendentes = Math.max(total - lancados, 0);
    return { total, lancados, pendentes };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((row) => {
      const obra = obras.find((o) => String(o.id) === row.obraId)?.obra || "";
      return (
        row.codigo.toLowerCase().includes(q) ||
        obra.toLowerCase().includes(q) ||
        row.selectedMode.toLowerCase().includes(q)
      );
    });
  }, [rows, search, obras]);

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

        const next = { ...row, ...patch };

        const hAtual = parsePtNumber(next.horimetroAtual);
        const oAtual = parsePtNumber(next.odometroAtual);

        next.horasDia = safeDiff(hAtual, next.horimetroAnterior);
        next.kmDia = safeDiff(oAtual, next.odometroAnterior);

        return next;
      })
    );
  }, []);

  const updateActiveInput = useCallback((equipamentoId: number, rawValue: string, finalize = false) => {
    setRows((current) =>
      current.map((row) => {
        if (row.equipamentoId !== equipamentoId) return row;

        const next = { ...row };
        const value = finalize ? finalizeDecimalInput(rawValue) : formatDecimalWhileTyping(rawValue);

        if (next.selectedMode === "horimetro") {
          next.horimetroAtual = value;
        } else {
          next.odometroAtual = value;
        }

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
        const horimetroFinal = parsePtNumber(row.horimetroAtual);
        const odometroFinal = parsePtNumber(row.odometroAtual);
        const horasDia = safeDiff(horimetroFinal, row.horimetroAnterior);
        const kmDia = safeDiff(odometroFinal, row.odometroAnterior);

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
          horimetro_inicial:
            horimetroFinal != null || row.horimetroAnterior != null ? row.horimetroAnterior : null,
          horimetro_final: horimetroFinal,
          horas_trabalhadas: horasDia,
          odometro_inicial:
            odometroFinal != null || row.odometroAnterior != null ? row.odometroAnterior : null,
          odometro_final: odometroFinal,
          km_rodados: kmDia,
          observacao: String(row.observacao || "").trim() || null,
          status:
            horimetroFinal != null || odometroFinal != null ? "LANCADO" : "PENDENTE",
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
          --bg: #f6f7fb;
          --surface: #ffffff;
          --surface-soft: #f8fafc;
          --surface-muted: #f1f5f9;
          --line: #e9edf5;
          --line-strong: #d9e1ec;
          --text: #111827;
          --muted: #6b7280;
          --brand: #5b6df6;
          --brand-soft: #eef2ff;
          --success: #16a34a;
          --danger: #ef4444;
          --warning: #f4b400;
          --shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
          --radius-xl: 20px;
          --radius-lg: 16px;
          --radius-md: 12px;
          --radius-sm: 10px;
        }

        * {
          box-sizing: border-box;
        }

        html,
        body {
          margin: 0;
          padding: 0;
          background: var(--bg);
          color: var(--text);
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Arial, sans-serif;
        }

        input,
        select,
        button {
          font: inherit;
        }

        .page {
          min-height: 100vh;
          padding: 14px;
        }

        .shell {
          width: min(1480px, 100%);
          margin: 0 auto;
          display: grid;
          gap: 14px;
        }

        .header {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow);
          padding: 16px;
          display: grid;
          gap: 14px;
        }

        .header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .logo {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: #fff8e8;
          overflow: hidden;
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .eyebrow {
          margin: 0 0 3px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .title {
          margin: 0;
          font-size: 20px;
          line-height: 1;
          font-weight: 800;
          letter-spacing: -0.02em;
        }

        .subtitle {
          margin: 5px 0 0;
          font-size: 13px;
          color: var(--muted);
          font-weight: 500;
        }

        .period {
          font-size: 13px;
          color: #475569;
          font-weight: 600;
          white-space: nowrap;
        }

        .controls {
          display: grid;
          grid-template-columns: minmax(240px, 1fr) 180px 160px;
          gap: 12px;
          align-items: end;
        }

        .field {
          display: grid;
          gap: 6px;
        }

        .field label {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .search,
        .date,
        .select,
        .number-input,
        .text-input {
          width: 100%;
          height: 40px;
          border: 1px solid transparent;
          border-radius: 10px;
          background: var(--surface-soft);
          color: var(--text);
          outline: none;
          padding: 0 12px;
          font-size: 14px;
          font-weight: 600;
          transition: 0.15s ease;
        }

        .search:focus,
        .date:focus,
        .select:focus,
        .number-input:focus,
        .text-input:focus {
          background: #fff;
          border-color: var(--line-strong);
          box-shadow: 0 0 0 4px rgba(91, 109, 246, 0.08);
        }

        .number-input {
          min-width: 110px;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .save-btn {
          width: 100%;
          height: 40px;
          border: 0;
          border-radius: 10px;
          background: var(--warning);
          color: #1f2937;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
        }

        .save-btn[disabled] {
          opacity: 0.7;
          cursor: wait;
        }

        .stats {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .stat {
          padding: 7px 10px;
          border-radius: 999px;
          background: var(--surface-soft);
          color: #475569;
          font-size: 12px;
          font-weight: 700;
        }

        .message {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow);
          padding: 12px 14px;
          font-size: 14px;
          font-weight: 700;
        }

        .message.error {
          color: #a12d2d;
        }

        .message.ok {
          color: #0b7b52;
        }

        .message.warn {
          color: #8a6200;
        }

        .table-card {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow);
          overflow: hidden;
        }

        .table-head {
          padding: 14px 16px 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }

        .table-head h3 {
          margin: 0;
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }

        .table-head p {
          margin: 5px 0 0;
          color: var(--muted);
          font-size: 13px;
          font-weight: 500;
        }

        .table-wrap {
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
        }

        table {
          width: 100%;
          min-width: 1080px;
          border-collapse: separate;
          border-spacing: 0;
        }

        thead th {
          position: sticky;
          top: 0;
          z-index: 5;
          background: var(--surface);
          padding: 12px 12px;
          text-align: left;
          font-size: 11px;
          font-weight: 800;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          border-bottom: 1px solid var(--line);
          white-space: nowrap;
        }

        tbody td {
          padding: 12px;
          border-bottom: 1px solid var(--line);
          vertical-align: middle;
          background: #fff;
        }

        tbody tr:hover td {
          background: #fcfdff;
        }

        tbody tr:last-child td {
          border-bottom: 0;
        }

        .sticky-col {
          position: sticky;
          left: 0;
          z-index: 4;
          background: inherit;
        }

        thead .sticky-col {
          z-index: 6;
          background: var(--surface);
        }

        .equip-code {
          font-size: 15px;
          font-weight: 800;
          line-height: 1;
        }

        .equip-sub {
          margin-top: 4px;
          font-size: 11px;
          color: var(--muted);
          font-weight: 600;
        }

        .segmented {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 3px;
          border-radius: 999px;
          background: var(--surface-soft);
          border: 1px solid var(--line);
        }

        .segmented button {
          height: 28px;
          border: 0;
          border-radius: 999px;
          padding: 0 10px;
          background: transparent;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
        }

        .segmented button.active {
          background: var(--brand-soft);
          color: var(--brand);
        }

        .value {
          font-size: 14px;
          font-weight: 700;
          color: var(--text);
          white-space: nowrap;
        }

        .value.muted {
          color: #9aa4b2;
        }

        .value.success {
          color: var(--success);
        }

        .value.danger {
          color: var(--danger);
        }

        .status {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 999px;
          background: var(--surface-soft);
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
        }

        .status.saved {
          background: #ecfdf3;
          color: #118244;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #b6bfcd;
          flex: 0 0 auto;
        }

        .status.saved .status-dot {
          background: #16a34a;
        }

        .meta {
          margin-top: 6px;
          display: grid;
          gap: 2px;
          font-size: 11px;
          color: var(--muted);
          font-weight: 600;
        }

        .empty {
          padding: 20px;
          color: var(--muted);
          font-size: 14px;
          font-weight: 700;
        }

        @media (max-width: 920px) {
          .page {
            padding: 10px;
          }

          .header {
            padding: 14px;
          }

          .controls {
            grid-template-columns: 1fr;
          }

          .title {
            font-size: 18px;
          }

          table {
            min-width: 980px;
          }
        }
      `}</style>

      <main className="page">
        <div className="shell">
          <section className="header">
            <div className="header-top">
              <div className="brand">
                <div className="logo">
                  <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
                </div>
                <div>
                  <p className="eyebrow">GP Asfalto</p>
                  <h1 className="title">Horímetros e Odômetros</h1>
                  <p className="subtitle">Uma linha por equipamento. Tabela simples, clean e com rolagem lateral no celular.</p>
                </div>
              </div>

              <div className="period">
                Anterior: {isoToBr(periodoAnterior)} · Atual: {isoToBr(selectedDate)}
              </div>
            </div>

            <div className="controls">
              <div className="field">
                <label htmlFor="busca">Buscar equipamento</label>
                <input
                  id="busca"
                  className="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Ex.: CB-02, obra..."
                />
              </div>

              <div className="field">
                <label htmlFor="data">Data do lançamento</label>
                <input
                  id="data"
                  className="date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Ação</label>
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

            <div className="stats">
              <div className="stat">Equipamentos: {stats.total}</div>
              <div className="stat">Lançados: {stats.lancados}</div>
              <div className="stat">Pendentes: {stats.pendentes}</div>
            </div>
          </section>

          {!env.ok ? (
            <div className="message warn">
              Defina no Vercel: NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ou NEXT_PUBLIC_SUPABASE_ANON_KEY.
            </div>
          ) : null}

          {errorMsg ? <div className="message error">{errorMsg}</div> : null}
          {okMsg ? <div className="message ok">{okMsg}</div> : null}

          <section className="table-card">
            <div className="table-head">
              <div>
                <h3>Lançamento diário</h3>
                <p>Padrão automático: CB, CC, CP e KB em odômetro. Os demais em horímetro. O toggle da linha muda qual leitura a linha usa.</p>
              </div>
            </div>

            {loading ? (
              <div className="empty">Carregando...</div>
            ) : filteredRows.length === 0 ? (
              <div className="empty">Nenhum equipamento encontrado.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="sticky-col">Equip.</th>
                      <th>Tipo</th>
                      <th>Obra</th>
                      <th>Anterior</th>
                      <th>Atual</th>
                      <th>Do dia</th>
                      <th>Observação</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const previous = getPreviousValue(row);
                      const current = getCurrentValue(row);
                      const dayValue = getDayValue(row);
                      const dayNegative = (dayValue ?? 0) < 0;

                      return (
                        <tr key={row.equipamentoId}>
                          <td className="sticky-col">
                            <div className="equip-code">{row.codigo}</div>
                            <div className="equip-sub">{row.selectedMode === "horimetro" ? "Horímetro" : "Odômetro"}</div>
                          </td>

                          <td>
                            <div className="segmented">
                              <button
                                type="button"
                                className={row.selectedMode === "horimetro" ? "active" : ""}
                                onClick={() => updateRow(row.equipamentoId, { selectedMode: "horimetro" })}
                              >
                                Horímetro
                              </button>
                              <button
                                type="button"
                                className={row.selectedMode === "odometro" ? "active" : ""}
                                onClick={() => updateRow(row.equipamentoId, { selectedMode: "odometro" })}
                              >
                                Odômetro
                              </button>
                            </div>
                          </td>

                          <td>
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
                          </td>

                          <td>
                            <span className={`value ${previous == null ? "muted" : ""}`}>
                              {format1(previous)}
                            </span>
                          </td>

                          <td>
                            <input
                              type="text"
                              className="number-input"
                              value={current}
                              onChange={(e) => updateActiveInput(row.equipamentoId, e.target.value, false)}
                              onBlur={(e) => updateActiveInput(row.equipamentoId, e.target.value, true)}
                              inputMode="decimal"
                              placeholder="Digite"
                            />
                          </td>

                          <td>
                            <span
                              className={`value ${
                                dayValue == null ? "muted" : dayNegative ? "danger" : "success"
                              }`}
                            >
                              {format1(dayValue)}
                            </span>
                          </td>

                          <td>
                            <input
                              className="text-input"
                              value={row.observacao}
                              onChange={(e) => updateRow(row.equipamentoId, { observacao: e.target.value })}
                              placeholder="Observação"
                            />
                          </td>

                          <td>
                            <div className={`status ${row.registroId ? "saved" : ""}`}>
                              <span className="status-dot" />
                              {row.registroId ? "Salvo" : "Pendente"}
                            </div>
                            <div className="meta">
                              <div>
                                {row.updatedAt
                                  ? new Date(row.updatedAt).toLocaleString("pt-BR")
                                  : "Ainda não salvo"}
                              </div>
                              <div>{row.updatedByNome || "—"}</div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
