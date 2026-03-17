// FILE: app/material/dashboard/page.tsx
"use client";

import { useEffect, useState, useCallback, type CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";

// ─────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────

type SaldoAgregado = {
  material: string;
  entrada_t: number;
  consumo_t: number;
  ajuste_t: number;
  saldo_t: number;
  qtd_tickets_entrada: number;
  qtd_ajustes: number;
};

type TicketRow = {
  id: number;
  tipo: "ENTRADA" | "SAIDA";
  data: string;
  material: string;
  origem: string;
  obra: string;
  peso_t: number;
  veiculo: string;
};

type EntradaPlanResumo = {
  plan_id: number;
  origem: string;
  obra: string;
  produto: string;
  pedido: number | null;
  volume_entr: number | null;
  saldo_rest: number | null;
};

type OcSaldo = {
  plan_id: number;
  obra: string;
  oc: string | null;
  material: string;
  ilimitado: boolean;
  total_t: number | null;
  entrada_t: number | null;
  saida_t: number | null;
  saldo_t: number | null;
};

type SaldoPorData = {
  data: string;
  material: string;
  movimento_t: number;
  saldo_acumulado_t: number;
};

type DiarioUsina = {
  data: string;
  hrm_inicial: number | null;
  hrm_final: number | null;
  ogr_litros: number | null;
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function fmtT(v: number | null | undefined, d = 3) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function fmtN(v: number | null | undefined, d = 0) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoMinus(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function dateBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function pct(part: number | null, total: number | null) {
  if (!part || !total || total === 0) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}

const MATERIAL_COLORS: Record<string, string> = {
  "PO BRITA": "#f59e0b",
  "BRITA ZERO": "#3b82f6",
  "BRITA 01": "#8b5cf6",
  CAP: "#ef4444",
  OGR: "#10b981",
  HRM: "#6b7280",
};

function materialColor(m: string) {
  const key = Object.keys(MATERIAL_COLORS).find((k) =>
    m.toUpperCase().includes(k)
  );
  return key ? MATERIAL_COLORS[key] : "#94a3b8";
}

// ─────────────────────────────────────────────
// COMPONENTES MENORES
// ─────────────────────────────────────────────

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        background: color + "22",
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {label}
    </span>
  );
}

function ProgressBar({
  value,
  total,
  color,
}: {
  value: number | null;
  total: number | null;
  color: string;
}) {
  const p = pct(value, total);
  const over = p >= 100;
  return (
    <div
      style={{
        height: 6,
        borderRadius: 3,
        background: "#e5e7eb",
        overflow: "hidden",
        marginTop: 4,
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.min(p, 100)}%`,
          borderRadius: 3,
          background: over ? "#ef4444" : color,
          transition: "width 0.6s ease",
        }}
      />
    </div>
  );
}

function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 16,
        border: "1px solid #e5e7eb",
        padding: "20px 22px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "#6b7280",
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td
        colSpan={cols}
        style={{ textAlign: "center", padding: "24px 0", color: "#9ca3af", fontSize: 13 }}
      >
        Nenhum registro no período
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────

export default function MaterialDashboardPage() {
  // ── Filtros ──────────────────────────────
  const [dateStart, setDateStart] = useState(isoMinus(30));
  const [dateEnd, setDateEnd] = useState(isoToday());
  const [filterObra, setFilterObra] = useState("");
  const [filterMaterial, setFilterMaterial] = useState("");

  // ── Data ─────────────────────────────────
  const [saldos, setSaldos] = useState<SaldoAgregado[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [entradaPlans, setEntradaPlans] = useState<EntradaPlanResumo[]>([]);
  const [ocSaldos, setOcSaldos] = useState<OcSaldo[]>([]);
  const [saldoPorData, setSaldoPorData] = useState<SaldoPorData[]>([]);
  const [diarios, setDiarios] = useState<DiarioUsina[]>([]);
  const [obras, setObras] = useState<string[]>([]);
  const [materiais, setMateriais] = useState<string[]>([]);

  // ── UI ───────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "estoque" | "producao" | "entradas" | "saidas" | "pedidos"
  >("estoque");

  // ── Fetch ────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [
        { data: saldosData },
        { data: ticketsData },
        { data: plansData },
        { data: ocData },
        { data: evolData },
        { data: diariosData },
      ] = await Promise.all([
        supabase.from("material_saldo_agregados_v").select("*"),
        supabase
          .from("material_tickets")
          .select("id,tipo,data,material,origem,obra,peso_t,veiculo")
          .gte("data", dateStart)
          .lte("data", dateEnd)
          .order("data", { ascending: false }),
        supabase
          .from("material_entrada_resumo_por_plano_v")
          .select("plan_id,origem,obra,produto,pedido,volume_entr,saldo_rest"),
        supabase
          .from("material_oc_saldo_v")
          .select(
            "plan_id,obra,oc,material,ilimitado,total_t,entrada_t,saida_t,saldo_t"
          )
          .order("obra"),
        supabase
          .from("material_saldo_por_data_v")
          .select("data,material,movimento_t,saldo_acumulado_t")
          .gte("data", isoMinus(60))
          .order("data"),
        supabase
          .from("material_diario_usina")
          .select("data,hrm_inicial,hrm_final,ogr_litros")
          .gte("data", dateStart)
          .lte("data", dateEnd)
          .order("data", { ascending: false }),
      ]);

      const tks = (ticketsData as TicketRow[]) ?? [];
      setSaldos((saldosData as SaldoAgregado[]) ?? []);
      setTickets(tks);
      setEntradaPlans((plansData as EntradaPlanResumo[]) ?? []);
      setOcSaldos((ocData as OcSaldo[]) ?? []);
      setSaldoPorData((evolData as SaldoPorData[]) ?? []);
      setDiarios((diariosData as DiarioUsina[]) ?? []);

      // lista de obras e materiais para filtros
      const obrasSet = Array.from(
        new Set(tks.map((t) => t.obra).filter(Boolean))
      ).sort();
      const matsSet = Array.from(
        new Set(tks.map((t) => t.material).filter(Boolean))
      ).sort();
      setObras(obrasSet);
      setMateriais(matsSet);
    } finally {
      setLoading(false);
    }
  }, [dateStart, dateEnd]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ── Dados filtrados ──────────────────────
  const ticketsFiltrados = tickets.filter((t) => {
    if (filterObra && t.obra !== filterObra) return false;
    if (filterMaterial && t.material !== filterMaterial) return false;
    return true;
  });

  const saidas = ticketsFiltrados.filter((t) => t.tipo === "SAIDA");
  const entradas = ticketsFiltrados.filter((t) => t.tipo === "ENTRADA");

  // produção por produto (saídas agrupadas)
  const producaoMap: Record<string, number> = {};
  for (const t of saidas) {
    producaoMap[t.material] = (producaoMap[t.material] ?? 0) + Number(t.peso_t);
  }

  // entradas por material
  const entradasMap: Record<string, { total: number; qtd: number }> = {};
  for (const t of entradas) {
    if (!entradasMap[t.material])
      entradasMap[t.material] = { total: 0, qtd: 0 };
    entradasMap[t.material].total += Number(t.peso_t);
    entradasMap[t.material].qtd += 1;
  }

  // saídas por obra
  const saidasObraMap: Record<string, number> = {};
  for (const t of saidas) {
    saidasObraMap[t.obra] = (saidasObraMap[t.obra] ?? 0) + Number(t.peso_t);
  }

  // HRM total do período
  const hrmTotal = diarios.reduce((acc, d) => {
    if (d.hrm_inicial != null && d.hrm_final != null)
      return acc + (d.hrm_final - d.hrm_inicial);
    return acc;
  }, 0);

  const ogrTotal = diarios.reduce(
    (acc, d) => acc + (d.ogr_litros ?? 0),
    0
  );

  const totalProducaoT = Object.values(producaoMap).reduce((a, b) => a + b, 0);

  // gráfico: materiais únicos no período
  const materiaisGrafico = Array.from(
    new Set(saldoPorData.map((s) => s.material))
  );

  // ── Estilos ──────────────────────────────
  const s: Record<string, CSSProperties> = {
    root: {
      minHeight: "100vh",
      background: "#f8fafc",
      fontFamily:
        "'DM Sans', 'Helvetica Neue', Arial, sans-serif",
    },
    header: {
      background: "#0f172a",
      padding: "0 24px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: 56,
      position: "sticky" as const,
      top: 0,
      zIndex: 100,
    },
    headerTitle: {
      color: "#f1f5f9",
      fontSize: 14,
      fontWeight: 700,
      letterSpacing: "0.04em",
    },
    headerSub: {
      color: "#64748b",
      fontSize: 12,
      marginLeft: 12,
    },
    container: {
      maxWidth: 1280,
      margin: "0 auto",
      padding: "24px 20px",
    },
    filterBar: {
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: 14,
      padding: "14px 18px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      flexWrap: "wrap" as const,
      marginBottom: 20,
    },
    filterLabel: {
      fontSize: 11,
      fontWeight: 700,
      color: "#9ca3af",
      textTransform: "uppercase" as const,
      letterSpacing: "0.07em",
      whiteSpace: "nowrap" as const,
    },
    filterInput: {
      border: "1px solid #e5e7eb",
      borderRadius: 8,
      padding: "6px 10px",
      fontSize: 13,
      color: "#0f172a",
      background: "#f8fafc",
      outline: "none",
    },
    tabs: {
      display: "flex",
      gap: 4,
      marginBottom: 20,
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: 14,
      padding: 6,
    },

    grid2: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
      gap: 14,
      marginBottom: 20,
    },
    statValue: {
      fontSize: 28,
      fontWeight: 800,
      color: "#0f172a",
      lineHeight: 1.1,
      fontVariantNumeric: "tabular-nums",
    },
    statLabel: {
      fontSize: 11,
      fontWeight: 700,
      color: "#9ca3af",
      textTransform: "uppercase" as const,
      letterSpacing: "0.08em",
      marginTop: 4,
    },
    statSub: {
      fontSize: 12,
      color: "#6b7280",
      marginTop: 2,
    },
    table: {
      width: "100%",
      borderCollapse: "collapse" as const,
      fontSize: 13,
    },
    th: {
      textAlign: "left" as const,
      padding: "8px 12px",
      fontSize: 11,
      fontWeight: 700,
      color: "#9ca3af",
      textTransform: "uppercase" as const,
      letterSpacing: "0.07em",
      borderBottom: "2px solid #f1f5f9",
      whiteSpace: "nowrap" as const,
    },
    thR: {
      textAlign: "right" as const,
      padding: "8px 12px",
      fontSize: 11,
      fontWeight: 700,
      color: "#9ca3af",
      textTransform: "uppercase" as const,
      letterSpacing: "0.07em",
      borderBottom: "2px solid #f1f5f9",
      whiteSpace: "nowrap" as const,
    },
    td: {
      padding: "10px 12px",
      borderBottom: "1px solid #f1f5f9",
      color: "#374151",
      verticalAlign: "middle" as const,
    },
    tdR: {
      padding: "10px 12px",
      borderBottom: "1px solid #f1f5f9",
      color: "#374151",
      textAlign: "right" as const,
      fontVariantNumeric: "tabular-nums",
      verticalAlign: "middle" as const,
    },
  };

  const tabStyle = (active: boolean): CSSProperties => ({
    padding: "8px 18px",
    borderRadius: 10,
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    color: active ? "#fff" : "#6b7280",
    background: active ? "#0f172a" : "transparent",
    border: "none",
    cursor: "pointer",
    transition: "all 0.15s",
    letterSpacing: "0.02em",
  });

  const badgeStyle = (ok: boolean): CSSProperties => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 20,
    fontSize: 11,
    fontWeight: 700,
    background: ok ? "#dcfce7" : "#fef2f2",
    color: ok ? "#166534" : "#991b1b",
  });

  const statCardStyle = (color: string): CSSProperties => ({
    background: "#fff",
    borderRadius: 14,
    border: `1px solid ${color}33`,
    padding: "18px 20px",
    borderLeft: `4px solid ${color}`,
  });

  if (loading) {
    return (
      <div style={s.root}>
        <div style={s.header}>
          <span style={s.headerTitle}>MATERIAIS — DASHBOARD</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "60vh",
            color: "#9ca3af",
            fontSize: 14,
          }}
        >
          Carregando...
        </div>
      </div>
    );
  }

  return (
    <div style={s.root}>
      {/* ── HEADER ─────────────────────────── */}
      <header style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          <span style={s.headerTitle}>MATERIAIS</span>
          <span style={s.headerSub}>Controle de estoque · GPA Engenharia</span>
        </div>
        <button
          onClick={fetchAll}
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            color: "#94a3b8",
            borderRadius: 8,
            padding: "6px 14px",
            fontSize: 12,
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          ↻ Atualizar
        </button>
      </header>

      <div style={s.container}>
        {/* ── FILTROS ──────────────────────── */}
        <div style={s.filterBar}>
          <span style={s.filterLabel}>Período</span>
          <input
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            style={s.filterInput}
          />
          <span style={{ color: "#9ca3af", fontSize: 13 }}>até</span>
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            style={s.filterInput}
          />

          <span style={{ ...s.filterLabel, marginLeft: 8 }}>Obra</span>
          <select
            value={filterObra}
            onChange={(e) => setFilterObra(e.target.value)}
            style={s.filterInput}
          >
            <option value="">Todas</option>
            {obras.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>

          <span style={{ ...s.filterLabel, marginLeft: 8 }}>Material</span>
          <select
            value={filterMaterial}
            onChange={(e) => setFilterMaterial(e.target.value)}
            style={s.filterInput}
          >
            <option value="">Todos</option>
            {materiais.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              setFilterObra("");
              setFilterMaterial("");
              setDateStart(isoMinus(30));
              setDateEnd(isoToday());
            }}
            style={{
              ...s.filterInput,
              cursor: "pointer",
              color: "#6b7280",
              marginLeft: "auto",
            }}
          >
            Limpar
          </button>
        </div>

        {/* ── CARDS RESUMO ─────────────────── */}
        <div style={s.grid2}>
          {/* Produção total */}
          <div style={statCardStyle("#f59e0b")}>
            <div style={s.statValue}>{fmtN(totalProducaoT, 1)}</div>
            <div style={s.statLabel}>Produção — ton</div>
            <div style={s.statSub}>
              {Object.keys(producaoMap).length} produto(s) ·{" "}
              {saidas.length} tickets
            </div>
          </div>

          {/* Entradas de agregados */}
          <div style={statCardStyle("#3b82f6")}>
            <div style={s.statValue}>
              {fmtN(
                entradas.reduce((a, t) => a + Number(t.peso_t), 0),
                1
              )}
            </div>
            <div style={s.statLabel}>Entradas agregados — ton</div>
            <div style={s.statSub}>{entradas.length} tickets no período</div>
          </div>

          {/* HRM */}
          <div style={statCardStyle("#6b7280")}>
            <div style={s.statValue}>{fmtN(hrmTotal, 1)}</div>
            <div style={s.statLabel}>Horímetro — HRM</div>
            <div style={s.statSub}>
              {diarios.length} dias com registro · OGR{" "}
              {fmtN(ogrTotal, 0)} L
            </div>
          </div>

          {/* Ton/hora médio */}
          <div style={statCardStyle("#10b981")}>
            <div style={s.statValue}>
              {hrmTotal > 0 ? fmtN(totalProducaoT / hrmTotal, 1) : "—"}
            </div>
            <div style={s.statLabel}>Ton / hora média</div>
            <div style={s.statSub}>
              {totalProducaoT > 0 && ogrTotal > 0
                ? `${fmtN(ogrTotal / totalProducaoT, 2)} L/ton OGR`
                : "Sem dados HRM no período"}
            </div>
          </div>
        </div>

        {/* ── TABS ─────────────────────────── */}
        <div style={s.tabs}>
          {(
            [
              ["estoque", "Saldo Estoque"],
              ["producao", "Produção"],
              ["entradas", "Entradas"],
              ["saidas", "Saídas / Obras"],
              ["pedidos", "Pedidos / OC"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              style={tabStyle(activeTab === key)}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════
            TAB: SALDO ESTOQUE
        ══════════════════════════════════════ */}
        {activeTab === "estoque" && (
          <div>
            {/* Cards de saldo por material */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 12,
                marginBottom: 20,
              }}
            >
              {saldos.map((s_) => {
                const cor = materialColor(s_.material);
                const alerta = s_.saldo_t < 50;
                return (
                  <Card
                    key={s_.material}
                    style={{ borderLeft: `4px solid ${cor}` }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "#9ca3af",
                        letterSpacing: "0.07em",
                        marginBottom: 8,
                      }}
                    >
                      {s_.material}
                    </div>
                    <div
                      style={{
                        fontSize: 32,
                        fontWeight: 800,
                        color: alerta ? "#ef4444" : "#0f172a",
                        lineHeight: 1,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {fmtN(s_.saldo_t, 1)}
                    </div>
                    <div
                      style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}
                    >
                      toneladas em estoque
                    </div>
                    {alerta && (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 11,
                          fontWeight: 700,
                          color: "#ef4444",
                          background: "#fef2f2",
                          padding: "3px 8px",
                          borderRadius: 6,
                          display: "inline-block",
                        }}
                      >
                        ⚠ Estoque baixo
                      </div>
                    )}
                    <div
                      style={{
                        marginTop: 10,
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 4,
                        fontSize: 11,
                        color: "#6b7280",
                      }}
                    >
                      <div>
                        <span style={{ color: "#10b981", fontWeight: 700 }}>
                          +{fmtN(s_.entrada_t, 1)}
                        </span>{" "}
                        entr.
                      </div>
                      <div>
                        <span style={{ color: "#ef4444", fontWeight: 700 }}>
                          -{fmtN(s_.consumo_t, 1)}
                        </span>{" "}
                        cons.
                      </div>
                    </div>
                  </Card>
                );
              })}

              {saldos.length === 0 && (
                <Card style={{ gridColumn: "1/-1", textAlign: "center" }}>
                  <div style={{ color: "#9ca3af", fontSize: 13 }}>
                    Nenhum saldo calculado. Verifique os ajustes iniciais.
                  </div>
                </Card>
              )}
            </div>

            {/* Gráfico de evolução (barras CSS simples) */}
            <Card>
              <SectionTitle>Evolução do estoque — últimos 60 dias</SectionTitle>
              {materiaisGrafico.length === 0 ? (
                <div style={{ color: "#9ca3af", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                  Sem dados de evolução
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                  {materiaisGrafico.slice(0, 5).map((mat) => {
                    const linhas = saldoPorData.filter(
                      (s) => s.material === mat
                    );
                    const maxVal = Math.max(
                      ...linhas.map((l) => Math.abs(l.saldo_acumulado_t))
                    );
                    const cor = materialColor(mat);
                    const ultimo =
                      linhas[linhas.length - 1]?.saldo_acumulado_t ?? 0;
                    return (
                      <div key={mat}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginBottom: 6,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: "#374151",
                            }}
                          >
                            {mat}
                          </span>
                          <span
                            style={{
                              fontSize: 13,
                              fontWeight: 800,
                              color: cor,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {fmtN(ultimo, 1)} t
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "flex-end",
                            gap: 2,
                            height: 48,
                          }}
                        >
                          {linhas.slice(-30).map((l, i) => {
                            const h = maxVal > 0
                              ? Math.max(2, (Math.abs(l.saldo_acumulado_t) / maxVal) * 48)
                              : 2;
                            const neg = l.saldo_acumulado_t < 0;
                            return (
                              <div
                                key={i}
                                title={`${dateBR(l.data)}: ${fmtN(l.saldo_acumulado_t, 1)}t`}
                                style={{
                                  flex: 1,
                                  height: h,
                                  background: neg ? "#ef4444" : cor,
                                  borderRadius: "2px 2px 0 0",
                                  opacity: 0.8,
                                  minWidth: 2,
                                }}
                              />
                            );
                          })}
                        </div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 10,
                            color: "#9ca3af",
                            marginTop: 2,
                          }}
                        >
                          <span>
                            {linhas.length > 0 ? dateBR(linhas[Math.max(0, linhas.length - 30)].data) : ""}
                          </span>
                          <span>
                            {linhas.length > 0 ? dateBR(linhas[linhas.length - 1].data) : ""}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: PRODUÇÃO
        ══════════════════════════════════════ */}
        {activeTab === "producao" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Produção por produto */}
            <Card style={{ gridColumn: "1/-1" }}>
              <SectionTitle>Produção por produto usinado</SectionTitle>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Produto</th>
                    <th style={s.thR}>Tickets</th>
                    <th style={s.thR}>Total (ton)</th>
                    <th style={s.thR}>% do total</th>
                    <th style={s.th} />
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(producaoMap).length === 0 ? (
                    <EmptyRow cols={5} />
                  ) : (
                    Object.entries(producaoMap)
                      .sort((a, b) => b[1] - a[1])
                      .map(([mat, ton]) => {
                        const qtd = saidas.filter(
                          (t) => t.material === mat
                        ).length;
                        const p =
                          totalProducaoT > 0
                            ? (ton / totalProducaoT) * 100
                            : 0;
                        const cor = materialColor(mat);
                        return (
                          <tr key={mat}>
                            <td style={s.td}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <div
                                  style={{
                                    width: 10,
                                    height: 10,
                                    borderRadius: 2,
                                    background: cor,
                                    flexShrink: 0,
                                  }}
                                />
                                <span style={{ fontWeight: 600 }}>{mat}</span>
                              </div>
                            </td>
                            <td style={s.tdR}>{qtd}</td>
                            <td style={{ ...s.tdR, fontWeight: 700 }}>
                              {fmtT(ton, 1)}
                            </td>
                            <td style={s.tdR}>{p.toFixed(1)}%</td>
                            <td style={{ ...s.td, minWidth: 120 }}>
                              <div
                                style={{
                                  height: 6,
                                  background: "#f1f5f9",
                                  borderRadius: 3,
                                  overflow: "hidden",
                                }}
                              >
                                <div
                                  style={{
                                    height: "100%",
                                    width: `${p}%`,
                                    background: cor,
                                    borderRadius: 3,
                                  }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })
                  )}
                  {Object.keys(producaoMap).length > 0 && (
                    <tr style={{ background: "#f8fafc" }}>
                      <td style={{ ...s.td, fontWeight: 800 }}>TOTAL</td>
                      <td style={{ ...s.tdR, fontWeight: 800 }}>
                        {saidas.length}
                      </td>
                      <td style={{ ...s.tdR, fontWeight: 800 }}>
                        {fmtT(totalProducaoT, 1)}
                      </td>
                      <td style={s.tdR}>100%</td>
                      <td style={s.td} />
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>

            {/* HRM / OGR */}
            <Card>
              <SectionTitle>Horímetro e OGR — por dia</SectionTitle>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Data</th>
                    <th style={s.thR}>HRM</th>
                    <th style={s.thR}>OGR (L)</th>
                  </tr>
                </thead>
                <tbody>
                  {diarios.length === 0 ? (
                    <EmptyRow cols={3} />
                  ) : (
                    diarios.map((d) => {
                      const hrm =
                        d.hrm_inicial != null && d.hrm_final != null
                          ? d.hrm_final - d.hrm_inicial
                          : null;
                      return (
                        <tr key={d.data}>
                          <td style={s.td}>{dateBR(d.data)}</td>
                          <td style={s.tdR}>{fmtN(hrm, 1)}</td>
                          <td style={s.tdR}>{fmtN(d.ogr_litros, 0)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </Card>

            {/* Saída por destino */}
            <Card>
              <SectionTitle>Saídas por destino</SectionTitle>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Obra</th>
                    <th style={s.thR}>Ton</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(saidasObraMap).length === 0 ? (
                    <EmptyRow cols={2} />
                  ) : (
                    Object.entries(saidasObraMap)
                      .sort((a, b) => b[1] - a[1])
                      .map(([obra, ton]) => (
                        <tr key={obra}>
                          <td style={{ ...s.td, fontSize: 12 }}>{obra}</td>
                          <td style={{ ...s.tdR, fontWeight: 700 }}>
                            {fmtT(ton, 1)}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: ENTRADAS
        ══════════════════════════════════════ */}
        {activeTab === "entradas" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Resumo por material */}
            <Card>
              <SectionTitle>Entradas por material</SectionTitle>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Material</th>
                    <th style={s.thR}>Tickets</th>
                    <th style={s.thR}>Total (ton)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(entradasMap).length === 0 ? (
                    <EmptyRow cols={3} />
                  ) : (
                    Object.entries(entradasMap)
                      .sort((a, b) => b[1].total - a[1].total)
                      .map(([mat, v]) => (
                        <tr key={mat}>
                          <td style={s.td}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: 2,
                                  background: materialColor(mat),
                                  flexShrink: 0,
                                }}
                              />
                              {mat}
                            </div>
                          </td>
                          <td style={s.tdR}>{v.qtd}</td>
                          <td style={{ ...s.tdR, fontWeight: 700 }}>
                            {fmtT(v.total, 1)}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </Card>

            {/* Lista de tickets de entrada */}
            <Card>
              <SectionTitle>Tickets de entrada — detalhado</SectionTitle>
              <div style={{ overflowX: "auto" }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Data</th>
                      <th style={s.th}>Veículo</th>
                      <th style={s.th}>Origem</th>
                      <th style={s.th}>Material</th>
                      <th style={s.thR}>Peso (ton)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entradas.length === 0 ? (
                      <EmptyRow cols={5} />
                    ) : (
                      entradas.slice(0, 50).map((t) => (
                        <tr key={t.id}>
                          <td style={{ ...s.td, whiteSpace: "nowrap" }}>
                            {dateBR(t.data)}
                          </td>
                          <td style={s.td}>{t.veiculo}</td>
                          <td style={{ ...s.td, fontSize: 12 }}>{t.origem}</td>
                          <td style={s.td}>
                            <Pill
                              label={t.material}
                              color={materialColor(t.material)}
                            />
                          </td>
                          <td style={{ ...s.tdR, fontWeight: 700 }}>
                            {fmtT(t.peso_t)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {entradas.length > 50 && (
                <div
                  style={{
                    textAlign: "center",
                    fontSize: 12,
                    color: "#9ca3af",
                    padding: "12px 0 0",
                  }}
                >
                  Exibindo 50 de {entradas.length} tickets. Use os filtros para
                  refinar.
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: SAÍDAS / OBRAS
        ══════════════════════════════════════ */}
        {activeTab === "saidas" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Controle OC por obra */}
            <Card>
              <SectionTitle>Controle por obra — OC</SectionTitle>
              <div style={{ overflowX: "auto" }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Obra</th>
                      <th style={s.th}>OC</th>
                      <th style={s.th}>Material</th>
                      <th style={s.thR}>Contratado</th>
                      <th style={s.thR}>Entrado</th>
                      <th style={s.thR}>Saído</th>
                      <th style={s.thR}>Saldo</th>
                      <th style={s.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ocSaldos.length === 0 ? (
                      <EmptyRow cols={8} />
                    ) : (
                      ocSaldos
                        .filter(
                          (o) =>
                            !filterObra ||
                            o.obra
                              .toLowerCase()
                              .includes(filterObra.toLowerCase())
                        )
                        .map((o) => {
                          const p = pct(o.saida_t, o.total_t);
                          const ok =
                            o.ilimitado ||
                            (o.saldo_t != null && o.saldo_t >= 0);
                          return (
                            <tr key={o.plan_id}>
                              <td style={{ ...s.td, fontSize: 12 }}>
                                {o.obra}
                              </td>
                              <td style={{ ...s.td, color: "#9ca3af", fontSize: 12 }}>
                                {o.oc ?? "—"}
                              </td>
                              <td style={s.td}>
                                <Pill
                                  label={o.material}
                                  color={materialColor(o.material)}
                                />
                              </td>
                              <td style={s.tdR}>
                                {o.ilimitado ? "∞" : fmtT(o.total_t, 1)}
                              </td>
                              <td style={s.tdR}>{fmtT(o.entrada_t, 1)}</td>
                              <td style={s.tdR}>{fmtT(o.saida_t, 1)}</td>
                              <td
                                style={{
                                  ...s.tdR,
                                  fontWeight: 700,
                                  color: ok ? "#0f172a" : "#ef4444",
                                }}
                              >
                                {o.ilimitado ? "∞" : fmtT(o.saldo_t, 1)}
                              </td>
                              <td style={s.td}>
                                {o.ilimitado ? (
                                  <span style={badgeStyle(true)}>Ilimitado</span>
                                ) : (
                                  <div>
                                    <span style={badgeStyle(ok)}>
                                      {ok ? "OK" : "Excedido"}
                                    </span>
                                    <ProgressBar
                                      value={o.saida_t}
                                      total={o.total_t}
                                      color="#3b82f6"
                                    />
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Lista tickets de saída */}
            <Card>
              <SectionTitle>Tickets de saída — detalhado</SectionTitle>
              <div style={{ overflowX: "auto" }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Data</th>
                      <th style={s.th}>Veículo</th>
                      <th style={s.th}>Destino</th>
                      <th style={s.th}>Material</th>
                      <th style={s.thR}>Peso (ton)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saidas.length === 0 ? (
                      <EmptyRow cols={5} />
                    ) : (
                      saidas.slice(0, 50).map((t) => (
                        <tr key={t.id}>
                          <td style={{ ...s.td, whiteSpace: "nowrap" }}>
                            {dateBR(t.data)}
                          </td>
                          <td style={s.td}>{t.veiculo}</td>
                          <td style={{ ...s.td, fontSize: 12 }}>{t.obra}</td>
                          <td style={s.td}>
                            <Pill
                              label={t.material}
                              color={materialColor(t.material)}
                            />
                          </td>
                          <td style={{ ...s.tdR, fontWeight: 700 }}>
                            {fmtT(t.peso_t)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: PEDIDOS / OC
        ══════════════════════════════════════ */}
        {activeTab === "pedidos" && (
          <Card>
            <SectionTitle>Pedidos de compra — entradas planejadas</SectionTitle>
            <div style={{ overflowX: "auto" }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Origem</th>
                    <th style={s.th}>Obra / Destino</th>
                    <th style={s.th}>Produto</th>
                    <th style={s.thR}>Pedido (ton)</th>
                    <th style={s.thR}>Entrado (ton)</th>
                    <th style={s.thR}>Saldo (ton)</th>
                    <th style={s.th}>Progresso</th>
                  </tr>
                </thead>
                <tbody>
                  {entradaPlans.length === 0 ? (
                    <EmptyRow cols={7} />
                  ) : (
                    entradaPlans
                      .filter(
                        (p) =>
                          !filterObra ||
                          p.obra
                            .toLowerCase()
                            .includes(filterObra.toLowerCase())
                      )
                      .sort((a, b) =>
                        String(a.produto).localeCompare(String(b.produto))
                      )
                      .map((p) => {
                        const ok =
                          p.saldo_rest == null ||
                          Number(p.saldo_rest) >= 0;
                        return (
                          <tr key={p.plan_id}>
                            <td style={{ ...s.td, fontSize: 12 }}>
                              {p.origem}
                            </td>
                            <td style={{ ...s.td, fontSize: 12 }}>
                              {p.obra}
                            </td>
                            <td style={s.td}>
                              <Pill
                                label={p.produto ?? "—"}
                                color={materialColor(p.produto ?? "")}
                              />
                            </td>
                            <td style={s.tdR}>
                              {p.pedido != null
                                ? fmtT(p.pedido, 1)
                                : "—"}
                            </td>
                            <td style={s.tdR}>
                              {fmtT(p.volume_entr, 1)}
                            </td>
                            <td
                              style={{
                                ...s.tdR,
                                fontWeight: 700,
                                color: ok ? "#0f172a" : "#ef4444",
                              }}
                            >
                              {p.saldo_rest != null
                                ? fmtT(p.saldo_rest, 1)
                                : "—"}
                            </td>
                            <td
                              style={{ ...s.td, minWidth: 140 }}
                            >
                              {p.pedido != null && p.volume_entr != null ? (
                                <div>
                                  <div
                                    style={{
                                      fontSize: 11,
                                      color: "#6b7280",
                                      marginBottom: 2,
                                    }}
                                  >
                                    {pct(
                                      p.volume_entr,
                                      p.pedido
                                    ).toFixed(0)}
                                    %
                                  </div>
                                  <ProgressBar
                                    value={p.volume_entr}
                                    total={p.pedido}
                                    color={materialColor(p.produto ?? "")}
                                  />
                                </div>
                              ) : (
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: "#9ca3af",
                                  }}
                                >
                                  sem pedido definido
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
