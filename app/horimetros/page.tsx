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

function stripToDecimalDraft(value: string) {
  let s = String(value || "").replace(/\s+/g, "").replace(/\./g, ",");
  s = s.replace(/[^0-9,\-]/g, "");

  const isNegative = s.startsWith("-");
  s = s.replace(/-/g, "");

  const firstComma = s.indexOf(",");
  if (firstComma >= 0) {
    const intPart = s.slice(0, firstComma).replace(/,/g, "");
    const decPart = s.slice(firstComma + 1).replace(/,/g, "").slice(0, 1);
    s = `${intPart},${decPart}`;
  } else {
    s = s.replace(/,/g, "");
  }

  return `${isNegative ? "-" : ""}${s}`;
}

function formatDecimalWhileTyping(value: string) {
  const draft = stripToDecimalDraft(value);
  if (!draft || draft === "-") return draft;

  const isNegative = draft.startsWith("-");
  const unsigned = draft.replace(/^-/, "");
  const hasComma = unsigned.includes(",");
  const [intRaw = "", decRaw = ""] = unsigned.split(",");
  const intDigits = intRaw.replace(/^0+(?=\d)/, "");
  const intFormatted = intDigits
    ? Number(intDigits).toLocaleString("pt-BR")
    : hasComma
      ? "0"
      : "";

  if (!hasComma) {
    return `${isNegative ? "-" : ""}${intFormatted}`;
  }

  return `${isNegative ? "-" : ""}${intFormatted},${decRaw}`;
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

function statusLabel(row: RowState) {
  return row.registroId ? "Salvo no dia" : "Pendente";
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
    const comHorimetro = rows.filter((row) => row.usaHorimetro).length;
    const comOdometro = rows.filter((row) => row.usaOdometro).length;
    return { total, lancados, pendentes, comHorimetro, comOdometro };
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
          --bg: #f4f6f8;
          --surface: #ffffff;
          --surface-soft: #f9fafb;
          --line: #d9e0e7;
          --line-strong: #c7d0da;
          --text: #152232;
          --muted: #6a7786;
          --navy: #1f344a;
          --navy-soft: #edf3f9;
          --yellow: #f4b400;
          --green: #17a672;
          --green-soft: #e9fbf4;
          --red: #c83d36;
          --red-soft: #fff2f1;
          --shadow: 0 12px 30px rgba(24, 39, 58, 0.06);
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
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .page {
          min-height: 100vh;
          background: var(--bg);
        }

        .shell {
          width: min(1680px, 100%);
          margin: 0 auto;
          padding: 24px;
        }

        .hero {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 24px;
          box-shadow: var(--shadow);
          padding: 24px;
        }

        .hero-top {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: flex-start;
        }

        .hero-brand {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .hero-logo {
          width: 52px;
          height: 52px;
          border-radius: 16px;
          background: #fff8e1;
          border: 1px solid #f6df8f;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex: 0 0 auto;
        }

        .hero-logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .eyebrow {
          margin: 0 0 6px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .title {
          margin: 0;
          font-size: 34px;
          line-height: 1.02;
          font-weight: 900;
          letter-spacing: -0.04em;
          color: var(--navy);
        }

        .subtitle {
          margin-top: 8px;
          max-width: 760px;
          color: var(--muted);
          font-size: 14px;
          line-height: 1.45;
          font-weight: 600;
        }

        .hero-actions {
          min-width: 320px;
          display: grid;
          gap: 12px;
        }

        .hero-actions-grid {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
          align-items: end;
        }

        .field-block {
          display: grid;
          gap: 8px;
        }

        .field-label {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .stats-grid {
          margin-top: 22px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }

        .stat-card {
          border: 1px solid var(--line);
          border-radius: 20px;
          background: var(--surface-soft);
          padding: 16px;
          min-height: 110px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
        }

        .stat-label {
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted);
        }

        .stat-value {
          margin-top: 6px;
          font-size: 34px;
          line-height: 1;
          font-weight: 900;
          letter-spacing: -0.04em;
          color: var(--navy);
        }

        .stat-note {
          margin-top: 10px;
          font-size: 13px;
          color: var(--muted);
          font-weight: 700;
        }

        .toolbar {
          margin-top: 18px;
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 24px;
          box-shadow: var(--shadow);
          padding: 18px;
          display: grid;
          grid-template-columns: minmax(280px, 1.4fr) minmax(180px, 220px) minmax(240px, 1fr) auto;
          gap: 14px;
          align-items: end;
        }

        .helper-box {
          height: 48px;
          border-radius: 14px;
          border: 1px dashed var(--line-strong);
          background: #fbfcfd;
          color: var(--muted);
          padding: 0 14px;
          display: flex;
          align-items: center;
          font-size: 13px;
          font-weight: 700;
        }

        .search-input,
        .date-input,
        .select,
        .number-input,
        .text-input {
          width: 100%;
          height: 48px;
          border-radius: 14px;
          border: 1px solid var(--line-strong);
          background: #fff;
          color: var(--text);
          outline: none;
          padding: 0 14px;
          font-size: 14px;
          font-weight: 700;
          transition: border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
        }

        .text-input {
          padding-right: 16px;
        }

        .search-input:focus,
        .date-input:focus,
        .select:focus,
        .number-input:focus,
        .text-input:focus {
          border-color: #7ea0c4;
          box-shadow: 0 0 0 4px rgba(78, 114, 152, 0.12);
        }

        .number-input[disabled],
        .text-input[disabled] {
          background: #f1f4f7;
          color: #8b98a7;
          cursor: not-allowed;
        }

        .save-btn {
          height: 48px;
          border: 0;
          border-radius: 14px;
          padding: 0 20px;
          font-size: 14px;
          font-weight: 900;
          background: var(--yellow);
          color: #1b2430;
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(244, 180, 0, 0.18);
          white-space: nowrap;
        }

        .save-btn[disabled] {
          opacity: 0.65;
          cursor: wait;
        }

        .alerts {
          margin-top: 14px;
          display: grid;
          gap: 12px;
        }

        .alert {
          border-radius: 16px;
          padding: 13px 15px;
          font-size: 14px;
          font-weight: 800;
          border: 1px solid transparent;
          background: var(--surface);
        }

        .alert.error {
          background: #fff3f2;
          border-color: #f0c1bc;
          color: #9a2920;
        }

        .alert.ok {
          background: #edfdf5;
          border-color: #b7efcf;
          color: #0d7c4f;
        }

        .alert.warn {
          background: #fff8ea;
          border-color: #f3d596;
          color: #8a5b00;
        }

        .table-card {
          margin-top: 18px;
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 24px;
          box-shadow: var(--shadow);
          overflow: hidden;
        }

        .table-head {
          padding: 18px 20px;
          border-bottom: 1px solid var(--line);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          background: linear-gradient(180deg, #ffffff 0%, #fbfcfd 100%);
        }

        .table-title {
          display: grid;
          gap: 5px;
        }

        .table-title strong {
          font-size: 17px;
          color: var(--navy);
        }

        .table-title span {
          font-size: 13px;
          color: var(--muted);
          font-weight: 700;
        }

        .table-chip-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .table-chip {
          height: 34px;
          border-radius: 999px;
          padding: 0 12px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid var(--line);
          background: #fff;
          color: var(--text);
          font-size: 12px;
          font-weight: 800;
        }

        .table-wrap {
          overflow: auto;
          max-height: calc(100vh - 330px);
        }

        table {
          width: 100%;
          min-width: 1540px;
          border-collapse: separate;
          border-spacing: 0;
        }

        thead th {
          position: sticky;
          top: 0;
          z-index: 5;
          padding: 14px 10px;
          background: #f5f8fb;
          color: var(--navy);
          border-bottom: 1px solid var(--line);
          border-right: 1px solid #edf1f5;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          line-height: 1.25;
          white-space: nowrap;
        }

        thead th:last-child {
          border-right: 0;
        }

        tbody td {
          padding: 10px 8px;
          border-top: 1px solid #eef2f6;
          background: #fff;
          vertical-align: middle;
        }

        tbody tr:hover td {
          background: #fcfdff;
        }

        .equip-cell {
          min-width: 92px;
        }

        .equip-code {
          font-size: 15px;
          font-weight: 900;
          color: var(--navy);
          line-height: 1.1;
        }

        .equip-mode {
          margin-top: 5px;
          font-size: 11px;
          color: var(--muted);
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .readonly-box {
          min-width: 132px;
          height: 48px;
          border-radius: 14px;
          border: 1px solid var(--line);
          background: #f9fbfc;
          color: var(--text);
          padding: 0 14px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          font-weight: 900;
          font-size: 15px;
        }

        .readonly-box.disabled {
          background: #f1f4f7;
          color: #8b98a7;
          justify-content: center;
        }

        .right-input {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .delta-positive {
          color: #0e8a5d;
        }

        .delta-negative {
          color: var(--red);
        }

        .status-cell {
          min-width: 215px;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0 10px;
          height: 32px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 900;
          border: 1px solid var(--line);
          background: #f7f9fb;
          color: var(--muted);
        }

        .status-badge.saved {
          background: var(--green-soft);
          color: #0d7c4f;
          border-color: #b7efcf;
        }

        .status-dot {
          width: 9px;
          height: 9px;
          border-radius: 999px;
          background: #b6c0cb;
        }

        .status-badge.saved .status-dot {
          background: var(--green);
        }

        .status-meta {
          margin-top: 8px;
          display: grid;
          gap: 4px;
          font-size: 12px;
          color: var(--muted);
          font-weight: 700;
        }

        .empty {
          padding: 28px 24px;
          color: var(--muted);
          font-size: 14px;
          font-weight: 700;
        }

        @media (max-width: 1280px) {
          .stats-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .toolbar {
            grid-template-columns: 1fr 220px;
          }
        }

        @media (max-width: 980px) {
          .shell {
            padding: 16px;
          }

          .hero-top {
            flex-direction: column;
          }

          .hero-actions {
            min-width: 0;
            width: 100%;
          }

          .hero-actions-grid,
          .toolbar {
            grid-template-columns: 1fr;
          }

          .stats-grid {
            grid-template-columns: 1fr;
          }

          .table-wrap {
            max-height: none;
          }
        }
      `}</style>

      <main className="page">
        <div className="shell">
          <section className="hero">
            <div className="hero-top">
              <div>
                <div className="hero-brand">
                  <div className="hero-logo">
                    <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
                  </div>
                  <div>
                    <p className="eyebrow">GP Asfalto</p>
                    <h1 className="title">Horímetros e Odômetros</h1>
                  </div>
                </div>
                <div className="subtitle">
                  Lançamento diário por equipamento, com visual mais clean, leitura anterior bloqueada e número formatado automaticamente durante a digitação.
                </div>
              </div>

              <div className="hero-actions">
                <div className="hero-actions-grid">
                  <div className="field-block">
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
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <div>
                  <div className="stat-label">Equipamentos</div>
                  <div className="stat-value">{stats.total}</div>
                </div>
                <div className="stat-note">Linhas carregadas para o dia atual.</div>
              </div>

              <div className="stat-card">
                <div>
                  <div className="stat-label">Lançados</div>
                  <div className="stat-value">{stats.lancados}</div>
                </div>
                <div className="stat-note">Já possuem registro salvo em {isoToBr(selectedDate)}.</div>
              </div>

              <div className="stat-card">
                <div>
                  <div className="stat-label">Pendentes</div>
                  <div className="stat-value">{stats.pendentes}</div>
                </div>
                <div className="stat-note">Sem lançamento salvo no dia selecionado.</div>
              </div>

              <div className="stat-card">
                <div>
                  <div className="stat-label">Período visível</div>
                  <div className="stat-value" style={{ fontSize: 22 }}>
                    {isoToBr(periodoAnterior)}
                  </div>
                </div>
                <div className="stat-note">Base anterior: {isoToBr(periodoAnterior)} · Atual: {isoToBr(selectedDate)}</div>
              </div>
            </div>
          </section>

          <section className="toolbar">
            <div className="field-block">
              <label className="field-label" htmlFor="busca-equip">
                Buscar equipamento
              </label>
              <input
                id="busca-equip"
                className="search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ex.: MN-05, obra, código..."
              />
            </div>

            <div className="field-block">
              <label className="field-label">Leituras</label>
              <div className="helper-box">
                {stats.comHorimetro} com horímetro · {stats.comOdometro} com odômetro
              </div>
            </div>

            <div className="field-block">
              <label className="field-label">Regra</label>
              <div className="helper-box">
                Anterior = final do dia anterior. Sem histórico, usa base do cadastro.
              </div>
            </div>

            <div className="field-block">
              <label className="field-label">Atualização</label>
              <div className="helper-box">Máscara automática em pt-BR nos campos numéricos.</div>
            </div>
          </section>

          <div className="alerts">
            {!env.ok ? (
              <div className="alert warn">
                Defina no Vercel: NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ou NEXT_PUBLIC_SUPABASE_ANON_KEY.
              </div>
            ) : null}
            {errorMsg ? <div className="alert error">{errorMsg}</div> : null}
            {okMsg ? <div className="alert ok">{okMsg}</div> : null}
          </div>

          <section className="table-card">
            <div className="table-head">
              <div className="table-title">
                <strong>Lançamento diário</strong>
                <span>Horímetro e odômetro por equipamento, obra, status e observação.</span>
              </div>

              <div className="table-chip-row">
                <div className="table-chip">Anterior: {isoToBr(periodoAnterior)}</div>
                <div className="table-chip">Atual: {isoToBr(selectedDate)}</div>
                <div className="table-chip">Busca: {search.trim() ? search.trim() : "todas"}</div>
              </div>
            </div>

            {loading ? (
              <div className="empty">Carregando...</div>
            ) : filteredRows.length === 0 ? (
              <div className="empty">Nenhum equipamento encontrado para a busca atual.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Equip.</th>
                      <th>Obra</th>
                      <th>Horímetro anterior<br />{isoToBr(periodoAnterior)}</th>
                      <th>Horímetro atual<br />{isoToBr(selectedDate)}</th>
                      <th>Horas do dia</th>
                      <th>Odômetro anterior<br />{isoToBr(periodoAnterior)}</th>
                      <th>Odômetro atual<br />{isoToBr(selectedDate)}</th>
                      <th>KM do dia</th>
                      <th>Última atualização</th>
                      <th>Observação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const obraSelecionada = row.obraId ? Number(row.obraId) : 0;
                      const horasNegative = (row.horasDia ?? 0) < 0;
                      const kmNegative = (row.kmDia ?? 0) < 0;

                      return (
                        <tr key={row.equipamentoId}>
                          <td className="equip-cell">
                            <div className="equip-code">{row.codigo}</div>
                            <div className="equip-mode">
                              {row.usaHorimetro ? "Horímetro" : "—"} · {row.usaOdometro ? "Odômetro" : "—"}
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
                            <div className={`readonly-box ${!row.usaHorimetro ? "disabled" : ""}`}>
                              {row.usaHorimetro ? format1(row.horimetroAnterior) : "—"}
                            </div>
                          </td>

                          <td>
                            <input
                              type="text"
                              className="number-input right-input"
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
                              disabled={!row.usaHorimetro}
                            />
                          </td>

                          <td>
                            <div
                              className={`readonly-box ${!row.usaHorimetro ? "disabled" : ""} ${
                                horasNegative ? "delta-negative" : "delta-positive"
                              }`}
                            >
                              {row.usaHorimetro ? format1(row.horasDia) : "—"}
                            </div>
                          </td>

                          <td>
                            <div className={`readonly-box ${!row.usaOdometro ? "disabled" : ""}`}>
                              {row.usaOdometro ? format1(row.odometroAnterior) : "—"}
                            </div>
                          </td>

                          <td>
                            <input
                              type="text"
                              className="number-input right-input"
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
                              disabled={!row.usaOdometro}
                            />
                          </td>

                          <td>
                            <div
                              className={`readonly-box ${!row.usaOdometro ? "disabled" : ""} ${
                                kmNegative ? "delta-negative" : "delta-positive"
                              }`}
                            >
                              {row.usaOdometro ? format1(row.kmDia) : "—"}
                            </div>
                          </td>

                          <td className="status-cell">
                            <div className={`status-badge ${row.registroId ? "saved" : ""}`}>
                              <span className="status-dot" />
                              {statusLabel(row)}
                            </div>
                            <div className="status-meta">
                              <div>{row.updatedAt ? new Date(row.updatedAt).toLocaleString("pt-BR") : "Ainda não salvo neste dia"}</div>
                              <div>{row.updatedByNome || (obraSelecionada ? obraNameById.get(obraSelecionada) || "" : "")}</div>
                            </div>
                          </td>

                          <td>
                            <input
                              className="text-input"
                              value={row.observacao}
                              onChange={(e) => updateRow(row.equipamentoId, { observacao: e.target.value })}
                              placeholder="Observação"
                            />
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
