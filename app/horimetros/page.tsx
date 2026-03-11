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
  const decPart =
    parts.length > 1
      ? (parts.slice(1).join("") || "").replace(/\D/g, "").slice(0, 1)
      : "";

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

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const obra = obras.find((o) => String(o.id) === row.obraId)?.obra || "";
      return row.codigo.toLowerCase().includes(q) || obra.toLowerCase().includes(q);
    });
  }, [rows, search, obras]);

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
          --bg: #eff2ff;
          --surface: #ffffff;
          --surface-soft: #f7f8fc;
          --surface-muted: #f2f4fa;
          --line: #e9edf5;
          --line-strong: #dce3ef;
          --text: #161c2d;
          --muted: #7b8498;
          --brand: #6e86f8;
          --brand-soft: #eef1ff;
          --success: #16a34a;
          --danger: #ef4444;
          --warning: #f4b400;
          --shadow: 0 18px 45px rgba(34, 40, 73, 0.08);
          --radius-xl: 26px;
          --radius-lg: 20px;
          --radius-md: 14px;
          --radius-sm: 12px;
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
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
            "Segoe UI", sans-serif;
        }

        input,
        select,
        button {
          font: inherit;
        }

        .page {
          min-height: 100vh;
          padding: 18px;
        }

        .shell {
          width: min(1460px, 100%);
          margin: 0 auto;
          display: grid;
          gap: 16px;
        }

        .header {
          background: var(--surface);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow);
          overflow: hidden;
        }

        .header-top {
          background: #26262a;
          color: #fff;
          padding: 14px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .brand-row {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .logo {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.1);
          overflow: hidden;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
        }

        .logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .header-top small {
          display: block;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.7;
          margin-bottom: 4px;
          font-weight: 800;
        }

        .header-top h1 {
          margin: 0;
          font-size: 24px;
          line-height: 1;
          letter-spacing: -0.04em;
          font-weight: 900;
        }

        .header-top .period {
          white-space: nowrap;
          font-size: 13px;
          font-weight: 700;
          opacity: 0.88;
        }

        .header-body {
          padding: 18px;
          display: grid;
          gap: 16px;
        }

        .header-row {
          display: grid;
          grid-template-columns: 1.3fr 220px 180px;
          gap: 14px;
          align-items: end;
        }

        .intro h2 {
          margin: 0;
          font-size: 18px;
          line-height: 1.1;
          font-weight: 900;
          color: var(--brand);
          letter-spacing: -0.03em;
        }

        .intro p {
          margin: 8px 0 0;
          color: var(--muted);
          font-size: 14px;
          font-weight: 500;
        }

        .field {
          display: grid;
          gap: 6px;
        }

        .field label {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted);
        }

        .search,
        .date,
        .select,
        .number-input,
        .text-input {
          width: 100%;
          height: 42px;
          border: 1px solid transparent;
          outline: none;
          border-radius: var(--radius-sm);
          background: var(--surface-soft);
          color: var(--text);
          padding: 0 14px;
          font-size: 14px;
          font-weight: 700;
          transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
        }

        .text-input,
        .select,
        .number-input {
          height: 40px;
        }

        .search:focus,
        .date:focus,
        .select:focus,
        .number-input:focus,
        .text-input:focus {
          background: #fff;
          border-color: var(--line-strong);
          box-shadow: 0 0 0 4px rgba(110, 134, 248, 0.09);
        }

        .number-input {
          text-align: right;
          font-variant-numeric: tabular-nums;
          min-width: 112px;
        }

        .number-input[disabled],
        .text-input[disabled],
        .select[disabled] {
          background: var(--surface-muted);
          color: #a0a8b8;
        }

        .save-btn {
          width: 100%;
          height: 42px;
          border: 0;
          border-radius: 12px;
          background: var(--brand);
          color: #fff;
          font-size: 14px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 10px 22px rgba(110, 134, 248, 0.25);
        }

        .save-btn[disabled] {
          opacity: 0.7;
          cursor: wait;
        }

        .pills {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .pill {
          background: var(--surface-soft);
          color: #505a70;
          border-radius: 999px;
          padding: 9px 12px;
          font-size: 12px;
          font-weight: 800;
        }

        .message {
          background: var(--surface);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow);
          padding: 12px 14px;
          font-size: 14px;
          font-weight: 800;
        }

        .message.error {
          color: #9f2c2c;
        }

        .message.ok {
          color: #0b7b52;
        }

        .message.warn {
          color: #8a6200;
        }

        .table-card {
          background: var(--surface);
          border-radius: var(--radius-xl);
          box-shadow: var(--shadow);
          overflow: hidden;
        }

        .table-head {
          padding: 18px 18px 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }

        .table-head h3 {
          margin: 0;
          font-size: 18px;
          font-weight: 900;
          letter-spacing: -0.03em;
        }

        .table-head p {
          margin: 6px 0 0;
          font-size: 13px;
          color: var(--muted);
          font-weight: 600;
        }

        .table-wrap {
          overflow: auto;
          -webkit-overflow-scrolling: touch;
        }

        table {
          width: 100%;
          min-width: 1500px;
          border-collapse: separate;
          border-spacing: 0;
        }

        thead th {
          position: sticky;
          top: 0;
          z-index: 5;
          background: var(--surface);
          padding: 14px 12px;
          text-align: left;
          font-size: 11px;
          font-weight: 900;
          color: #4e5870;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          border-bottom: 1px solid var(--line);
          white-space: nowrap;
        }

        tbody td {
          padding: 10px 12px;
          border-bottom: 1px solid var(--line);
          vertical-align: middle;
          background: #fff;
        }

        tbody tr:hover td {
          background: #fbfcff;
        }

        tbody tr:last-child td {
          border-bottom: 0;
        }

        .equip {
          min-width: 86px;
        }

        .equip-code {
          font-size: 15px;
          font-weight: 900;
          color: var(--text);
          line-height: 1;
        }

        .equip-meta {
          margin-top: 4px;
          font-size: 11px;
          color: var(--muted);
          font-weight: 700;
        }

        .readonly {
          font-size: 14px;
          font-weight: 800;
          color: #263042;
          white-space: nowrap;
        }

        .readonly.muted {
          color: #a0a8b8;
        }

        .readonly.success {
          color: var(--success);
        }

        .readonly.danger {
          color: var(--danger);
        }

        .status {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 11px;
          border-radius: 999px;
          background: var(--surface-soft);
          color: #677287;
          font-size: 12px;
          font-weight: 900;
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
          background: #b4bdcc;
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
          font-weight: 700;
        }

        .empty {
          padding: 20px;
          color: var(--muted);
          font-size: 14px;
          font-weight: 800;
        }

        @media (max-width: 980px) {
          .page {
            padding: 12px;
          }

          .header-top,
          .header-row {
            grid-template-columns: 1fr;
            display: grid;
          }

          .header-top {
            gap: 10px;
          }

          .brand-row {
            align-items: flex-start;
          }

          .header-top .period {
            white-space: normal;
          }

          .header-body {
            padding: 14px;
          }

          .table-head {
            padding: 14px 14px 8px;
          }
        }
      `}</style>

      <main className="page">
        <div className="shell">
          <section className="header">
            <div className="header-top">
              <div className="brand-row">
                <div className="logo">
                  <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
                </div>
                <div>
                  <small>GP Asfalto</small>
                  <h1>Horímetros e Odômetros</h1>
                </div>
              </div>
              <div className="period">
                Anterior: {isoToBr(periodoAnterior)} · Atual: {isoToBr(selectedDate)}
              </div>
            </div>

            <div className="header-body">
              <div className="header-row">
                <div className="intro">
                  <h2>Uma linha por equipamento</h2>
                  <p>Layout limpo, tabela direta e todos os campos na mesma linha.</p>
                </div>

                <div className="field">
                  <label htmlFor="date">Data do lançamento</label>
                  <input
                    id="date"
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

              <div className="header-row" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
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

                <div className="pills">
                  <div className="pill">Equipamentos: {stats.total}</div>
                  <div className="pill">Lançados: {stats.lancados}</div>
                  <div className="pill">Pendentes: {stats.pendentes}</div>
                </div>

                <div className="pills" style={{ justifyContent: "flex-end" }}>
                  <div className="pill">Máscara pt-BR automática</div>
                </div>
              </div>
            </div>
          </section>

          {!env.ok ? (
            <div className="message warn">
              Defina no Vercel: NEXT_PUBLIC_SUPABASE_URL e
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ou
              NEXT_PUBLIC_SUPABASE_ANON_KEY.
            </div>
          ) : null}

          {errorMsg ? <div className="message error">{errorMsg}</div> : null}
          {okMsg ? <div className="message ok">{okMsg}</div> : null}

          <section className="table-card">
            <div className="table-head">
              <div>
                <h3>Lançamento diário</h3>
                <p>Todos os equipamentos em uma única grade, uma linha por equipamento.</p>
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
                      <th>Equip.</th>
                      <th>Obra</th>
                      <th>H. anterior</th>
                      <th>H. atual</th>
                      <th>Horas dia</th>
                      <th>O. anterior</th>
                      <th>O. atual</th>
                      <th>KM dia</th>
                      <th>Observação</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const horasNegative = (row.horasDia ?? 0) < 0;
                      const kmNegative = (row.kmDia ?? 0) < 0;

                      return (
                        <tr key={row.equipamentoId}>
                          <td className="equip">
                            <div className="equip-code">{row.codigo}</div>
                            <div className="equip-meta">
                              {row.usaHorimetro ? "H" : "—"} · {row.usaOdometro ? "O" : "—"}
                            </div>
                          </td>

                          <td>
                            <select
                              className="select"
                              value={row.obraId}
                              onChange={(e) =>
                                updateRow(row.equipamentoId, { obraId: e.target.value })
                              }
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
                            <span className={`readonly ${!row.usaHorimetro ? "muted" : ""}`}>
                              {row.usaHorimetro ? format1(row.horimetroAnterior) : "—"}
                            </span>
                          </td>

                          <td>
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
                              disabled={!row.usaHorimetro}
                            />
                          </td>

                          <td>
                            <span
                              className={`readonly ${
                                !row.usaHorimetro
                                  ? "muted"
                                  : horasNegative
                                    ? "danger"
                                    : row.horasDia == null
                                      ? "muted"
                                      : "success"
                              }`}
                            >
                              {row.usaHorimetro ? format1(row.horasDia) : "—"}
                            </span>
                          </td>

                          <td>
                            <span className={`readonly ${!row.usaOdometro ? "muted" : ""}`}>
                              {row.usaOdometro ? format1(row.odometroAnterior) : "—"}
                            </span>
                          </td>

                          <td>
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
                              disabled={!row.usaOdometro}
                            />
                          </td>

                          <td>
                            <span
                              className={`readonly ${
                                !row.usaOdometro
                                  ? "muted"
                                  : kmNegative
                                    ? "danger"
                                    : row.kmDia == null
                                      ? "muted"
                                      : "success"
                              }`}
                            >
                              {row.usaOdometro ? format1(row.kmDia) : "—"}
                            </span>
                          </td>

                          <td>
                            <input
                              className="text-input"
                              value={row.observacao}
                              onChange={(e) =>
                                updateRow(row.equipamentoId, { observacao: e.target.value })
                              }
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
