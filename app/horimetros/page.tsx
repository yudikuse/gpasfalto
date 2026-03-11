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
  return value.toFixed(1).replace(".", ",");
}

function parsePtNumber(value: string) {
  const s = String(value || "").trim();
  if (!s) return null;
  const cleaned = s.replace(/\./g, "").replace(/,/g, ".").replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
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
          --bg: #f3f5f8;
          --panel: #ffffff;
          --line: #d7dee8;
          --line-soft: #e6ebf2;
          --text: #09152f;
          --muted: #60708c;
          --navy-1: #071126;
          --navy-2: #152742;
          --orange: #f5a300;
          --orange-2: #ffbb33;
          --green: #12b76a;
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
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
            sans-serif;
        }

        .app-root {
          min-height: 100vh;
          background: linear-gradient(180deg, #eef2f7 0%, #f5f7fb 100%);
        }

        .app-shell {
          width: 100%;
          max-width: 1560px;
          margin: 0 auto;
          padding: 14px;
        }

        .topbar {
          border-radius: 24px 24px 0 0;
          padding: 18px 18px 22px;
          background: linear-gradient(90deg, var(--navy-1) 0%, #0a1731 32%, var(--navy-2) 100%);
          color: #fff;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 18px 40px rgba(6, 18, 42, 0.18);
        }

        .topbar-grid {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 18px;
          align-items: start;
        }

        .brand {
          display: flex;
          gap: 14px;
          align-items: center;
        }

        .brand-logo {
          width: 54px;
          height: 54px;
          border-radius: 14px;
          background: linear-gradient(180deg, var(--orange-2), var(--orange));
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          color: #09152f;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), 0 10px 24px rgba(245, 163, 0, 0.25);
          overflow: hidden;
        }

        .brand-logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .eyebrow {
          margin: 0 0 4px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.75);
        }

        .title {
          margin: 0;
          font-size: 28px;
          line-height: 1.05;
          font-weight: 900;
          letter-spacing: -0.03em;
        }

        .subtitle {
          margin-top: 8px;
          max-width: 820px;
          color: rgba(255, 255, 255, 0.82);
          font-size: 14px;
        }

        .actions {
          display: grid;
          gap: 8px;
          min-width: 260px;
        }

        .actions label {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(255, 255, 255, 0.9);
        }

        .actions-row {
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: flex-end;
        }

        .date-input,
        .search-input,
        .select,
        .number-input,
        .text-input {
          width: 100%;
          height: 42px;
          border-radius: 12px;
          border: 1px solid #c9d3e1;
          background: #fff;
          color: var(--text);
          outline: none;
          padding: 0 12px;
          font-size: 14px;
        }

        .date-input {
          min-width: 148px;
          background: rgba(255, 255, 255, 0.98);
          font-weight: 700;
        }

        .number-input[disabled],
        .text-input[disabled] {
          background: #eef2f7;
          color: #7b8799;
          cursor: not-allowed;
        }

        .search-input:focus,
        .select:focus,
        .number-input:focus,
        .text-input:focus,
        .date-input:focus {
          border-color: #9fb2cc;
          box-shadow: 0 0 0 4px rgba(91, 120, 160, 0.12);
        }

        .save-btn {
          height: 42px;
          border: 0;
          border-radius: 14px;
          padding: 0 18px;
          font-size: 15px;
          font-weight: 900;
          color: #09152f;
          background: linear-gradient(180deg, var(--orange-2), var(--orange));
          cursor: pointer;
          box-shadow: 0 10px 24px rgba(245, 163, 0, 0.3);
        }

        .save-btn[disabled] {
          opacity: 0.65;
          cursor: wait;
        }

        .stats {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 16px;
        }

        .chip {
          min-height: 38px;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 0 14px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.98);
          color: #09152f;
          border: 1px solid rgba(255, 255, 255, 0.15);
          font-size: 13px;
          font-weight: 800;
        }

        .chip strong {
          font-size: 22px;
          line-height: 1;
        }

        .legend {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
          color: rgba(255, 255, 255, 0.92);
          font-size: 13px;
          font-weight: 700;
        }

        .legend-item {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .dot {
          width: 14px;
          height: 14px;
          border-radius: 4px;
          border: 1px solid rgba(255, 255, 255, 0.7);
          background: rgba(255, 255, 255, 0.18);
        }

        .dot.green {
          background: rgba(18, 183, 106, 0.2);
          border-color: #9ae6b4;
        }

        .toolbar {
          display: grid;
          grid-template-columns: minmax(260px, 540px) 1fr;
          gap: 14px;
          margin-top: 14px;
          padding: 14px;
          border: 1px solid var(--line-soft);
          border-radius: 0 0 22px 22px;
          background: #fff;
          box-shadow: 0 10px 28px rgba(10, 21, 47, 0.05);
        }

        .toolbar-block label {
          display: block;
          margin-bottom: 8px;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #09152f;
        }

        .toolbar-help {
          align-self: end;
          color: var(--muted);
          font-size: 13px;
          font-weight: 700;
        }

        .message {
          margin-top: 12px;
          border-radius: 14px;
          padding: 12px 14px;
          font-size: 14px;
          font-weight: 800;
        }

        .message.error {
          background: #fff0ef;
          border: 1px solid #f3beb8;
          color: #8f1f14;
        }

        .message.ok {
          background: #ecfdf3;
          border: 1px solid #a6f4c5;
          color: #087443;
        }

        .table-card {
          margin-top: 14px;
          overflow: hidden;
          border-radius: 22px;
          border: 1px solid var(--line-soft);
          background: #fff;
          box-shadow: 0 14px 34px rgba(10, 21, 47, 0.06);
        }

        .table-wrap {
          overflow: auto;
          max-height: calc(100vh - 290px);
        }

        table {
          width: 100%;
          min-width: 1460px;
          border-collapse: separate;
          border-spacing: 0;
        }

        thead th {
          position: sticky;
          top: 0;
          z-index: 5;
          padding: 12px 10px;
          background: #09152f;
          color: #fff;
          font-size: 12px;
          font-weight: 900;
          line-height: 1.15;
          text-transform: uppercase;
          border-right: 1px solid rgba(255, 255, 255, 0.18);
          white-space: nowrap;
        }

        thead th:last-child {
          border-right: 0;
        }

        tbody td {
          padding: 10px 8px;
          border-top: 1px solid var(--line-soft);
          background: #fff;
          vertical-align: middle;
        }

        tbody tr:hover td {
          background: #f8fbff;
        }

        .td-equip {
          width: 90px;
          font-size: 15px;
          font-weight: 900;
          color: #09152f;
          white-space: nowrap;
        }

        .readonly-box {
          height: 42px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 0 12px;
          border-radius: 12px;
          border: 1px solid #d5deea;
          background: #fff;
          font-weight: 900;
          color: #09152f;
          min-width: 120px;
        }

        .readonly-box.disabled {
          justify-content: center;
          background: #eef2f7;
          color: #7a8699;
        }

        .right-input {
          text-align: right;
          font-weight: 800;
        }

        .updated {
          min-width: 190px;
          color: #60708c;
          font-size: 12px;
          font-weight: 800;
          line-height: 1.35;
        }

        .row-status {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 800;
        }

        .status-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #c4ccd8;
        }

        .status-dot.green {
          background: var(--green);
        }

        .empty {
          padding: 24px;
          color: #60708c;
          font-size: 14px;
          font-weight: 700;
        }

        .env-warning {
          margin-top: 12px;
          border-radius: 14px;
          padding: 12px 14px;
          background: #fff5e8;
          border: 1px solid #f8d49a;
          color: #8c5a00;
          font-size: 14px;
          font-weight: 800;
        }

        @media (max-width: 980px) {
          .topbar-grid,
          .toolbar {
            grid-template-columns: 1fr;
          }

          .actions-row {
            justify-content: flex-start;
          }

          .table-wrap {
            max-height: none;
          }
        }
      `}</style>

      <main className="app-root">
        <div className="app-shell">
          <section className="topbar">
            <div className="topbar-grid">
              <div>
                <div className="brand">
                  <div className="brand-logo">
                    <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
                  </div>

                  <div>
                    <p className="eyebrow">GP Asfalto</p>
                    <h1 className="title">Horímetros e Odômetros</h1>
                    <div className="subtitle">
                      Lançamento diário por equipamento, com obra na própria linha e leitura anterior
                      bloqueada.
                    </div>
                  </div>
                </div>

                <div className="stats">
                  <div className="chip">
                    Equipamentos <strong>{stats.total}</strong>
                  </div>
                  <div className="chip">
                    Lançados <strong>{stats.lancados}</strong>
                  </div>
                  <div className="chip">
                    Pendentes <strong>{stats.pendentes}</strong>
                  </div>
                  <div className="chip">
                    Período visível <span>{isoToBr(periodoAnterior)} — {isoToBr(selectedDate)}</span>
                  </div>
                </div>

                <div className="legend">
                  <span className="legend-item">
                    <span className="dot" />
                    Somente leitura
                  </span>
                  <span className="legend-item">
                    <span className="dot" />
                    Editável
                  </span>
                  <span className="legend-item">
                    <span className="dot green" />
                    Já salvo no dia
                  </span>
                </div>
              </div>

              <div className="actions">
                <label htmlFor="data-lancamento">Data do lançamento</label>

                <div className="actions-row">
                  <input
                    id="data-lancamento"
                    className="date-input"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />

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
          </section>

          <section className="toolbar">
            <div className="toolbar-block">
              <label htmlFor="busca-equip">Buscar equipamento</label>
              <input
                id="busca-equip"
                className="search-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ex.: MN-05"
              />
            </div>

            <div className="toolbar-help">
              Anterior = leitura final do dia anterior. Se não existir, usa a base do cadastro.
            </div>
          </section>

          {!env.ok ? (
            <div className="env-warning">
              Defina no Vercel: NEXT_PUBLIC_SUPABASE_URL e
              {" "}
              NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
              {" "}
              ou
              {" "}
              NEXT_PUBLIC_SUPABASE_ANON_KEY.
            </div>
          ) : null}

          {errorMsg ? <div className="message error">{errorMsg}</div> : null}
          {okMsg ? <div className="message ok">{okMsg}</div> : null}

          <section className="table-card">
            {loading ? (
              <div className="empty">Carregando...</div>
            ) : filteredRows.length === 0 ? (
              <div className="empty">Nenhum equipamento encontrado para a busca atual.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>EQUIP.</th>
                      <th>OBRA</th>
                      <th>
                        HORÍMETRO ANTERIOR
                        <br />
                        {isoToBr(periodoAnterior)}
                      </th>
                      <th>
                        HORÍMETRO ATUAL
                        <br />
                        {isoToBr(selectedDate)}
                      </th>
                      <th>HORAS DO DIA</th>
                      <th>
                        ODÔMETRO ANTERIOR
                        <br />
                        {isoToBr(periodoAnterior)}
                      </th>
                      <th>
                        ODÔMETRO ATUAL
                        <br />
                        {isoToBr(selectedDate)}
                      </th>
                      <th>KM DO DIA</th>
                      <th>ÚLTIMA ATUALIZAÇÃO</th>
                      <th>OBSERVAÇÃO</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredRows.map((row) => {
                      const obraSelecionada = row.obraId ? Number(row.obraId) : 0;

                      return (
                        <tr key={row.equipamentoId}>
                          <td className="td-equip">{row.codigo}</td>

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
                              className="number-input right-input"
                              value={row.horimetroAtual}
                              onChange={(e) =>
                                updateRow(row.equipamentoId, { horimetroAtual: e.target.value })
                              }
                              inputMode="decimal"
                              placeholder="Digite"
                              disabled={!row.usaHorimetro}
                            />
                          </td>

                          <td>
                            <div className={`readonly-box ${!row.usaHorimetro ? "disabled" : ""}`}>
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
                              className="number-input right-input"
                              value={row.odometroAtual}
                              onChange={(e) =>
                                updateRow(row.equipamentoId, { odometroAtual: e.target.value })
                              }
                              inputMode="decimal"
                              placeholder="Digite"
                              disabled={!row.usaOdometro}
                            />
                          </td>

                          <td>
                            <div className={`readonly-box ${!row.usaOdometro ? "disabled" : ""}`}>
                              {row.usaOdometro ? format1(row.kmDia) : "—"}
                            </div>
                          </td>

                          <td className="updated">
                            {row.registroId ? (
                              <>
                                <div className="row-status">
                                  <span className="status-dot green" />
                                  Salvo no dia
                                </div>
                                <div>
                                  {row.updatedAt
                                    ? new Date(row.updatedAt).toLocaleString("pt-BR")
                                    : "—"}
                                </div>
                                <div>{row.updatedByNome || "—"}</div>
                              </>
                            ) : (
                              <>
                                <div className="row-status">
                                  <span className="status-dot" />
                                  Ainda não salvo neste dia
                                </div>
                                <div>
                                  {obraSelecionada ? obraNameById.get(obraSelecionada) || "" : ""}
                                </div>
                              </>
                            )}
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
