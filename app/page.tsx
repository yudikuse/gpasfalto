// FILE: app/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  LineController,
  BarController,
} from "chart.js";
import { supabase } from "@/lib/supabaseClient";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  LineController,
  BarController,
  Tooltip,
  Legend
);

type EquipmentCostRow = {
  equipamento: string;
  ano: number;
  mes: number;
  horas_trab_mes: number | null;
  descricao: string | null;
  custo_hora_goinfra: number | null;
  custo_goinfra: number | null;
  custo_gp: number | null;
  custo_hora_gp: number | null;
  diff_gp_goinfra: number | null;
  diff_hora_gp_goinfra: number | null;
};

const monthLabels = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

type RankingMode = "percent" | "value";

type EquipStat = {
  equipamento: string;
  totalGp: number;
  totalGoinfra: number;
  totalHoras: number;
  custoHoraGp: number | null;
  custoHoraGoinfra: number | null;
  diffHora: number | null; // R$/h
  diffPercent: number | null; // ex: 0.25 = 25% mais caro
};

export default function DashboardPage() {
  const [data, setData] = useState<EquipmentCostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEquip, setSelectedEquip] = useState<"all" | string>("all");
  const [startMonth, setStartMonth] = useState(1);
  const [endMonth, setEndMonth] = useState(12);
  const [error, setError] = useState<string | null>(null);
  const [rankingMode, setRankingMode] = useState<RankingMode>("percent");

  // === FETCH: view equipment_costs_2025_v ===
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("equipment_costs_2025_v")
        .select("*")
        .eq("ano", 2025);

      if (error) {
        console.error(error);
        setError("Erro ao carregar dados de custos.");
        setLoading(false);
        return;
      }

      setData((data || []) as EquipmentCostRow[]);
      setLoading(false);
    };

    fetchData();
  }, []);

  // Equipamentos disponíveis (já excluindo TP-03 da análise inteira)
  const equipmentOptions = useMemo(() => {
    const set = new Set<string>();
    data.forEach((row) => {
      if (row.equipamento && row.equipamento !== "TP-03") {
        set.add(row.equipamento);
      }
    });
    return Array.from(set).sort();
  }, [data]);

  // Filtros aplicados (ignorando TP-03)
  const filteredData = useMemo(
    () =>
      data.filter((row) => {
        if (row.equipamento === "TP-03") return false;
        const inEquip =
          selectedEquip === "all" || row.equipamento === selectedEquip;
        const inMonth = row.mes >= startMonth && row.mes <= endMonth;
        return inEquip && inMonth;
      }),
    [data, selectedEquip, startMonth, endMonth]
  );

  // Agregação mensal (barras = GP, linha = GOINFRA)
  const monthlyAggregates = useMemo(() => {
    const result: { [mes: number]: { gp: number; goinfra: number } } = {};

    filteredData.forEach((row) => {
      if (!result[row.mes]) {
        result[row.mes] = { gp: 0, goinfra: 0 };
      }
      result[row.mes].gp += row.custo_gp ?? 0;
      result[row.mes].goinfra += row.custo_goinfra ?? 0;
    });

    return result;
  }, [filteredData]);

  const chartLabels = monthLabels.slice(startMonth - 1, endMonth);
  const barData = chartLabels.map((_, idx) => {
    const monthNumber = startMonth + idx;
    return monthlyAggregates[monthNumber]?.gp ?? 0;
  });
  const lineData = chartLabels.map((_, idx) => {
    const monthNumber = startMonth + idx;
    return monthlyAggregates[monthNumber]?.goinfra ?? 0;
  });

  // Resumo geral
  const summary = useMemo(() => {
    let totalGp = 0;
    let totalGoinfra = 0;
    let totalHoras = 0;

    filteredData.forEach((row) => {
      totalGp += row.custo_gp ?? 0;
      totalGoinfra += row.custo_goinfra ?? 0;
      totalHoras += row.horas_trab_mes ?? 0;
    });

    const diff = totalGp - totalGoinfra;
    const custoHoraGp = totalHoras > 0 ? totalGp / totalHoras : undefined;
    const custoHoraGoinfra =
      totalHoras > 0 ? totalGoinfra / totalHoras : undefined;

    return {
      totalGp,
      totalGoinfra,
      diff,
      totalHoras,
      custoHoraGp,
      custoHoraGoinfra,
    };
  }, [filteredData]);

  // === Estatísticas por equipamento para TOP 5 ===
  const equipStats: EquipStat[] = useMemo(() => {
    type Acc = {
      equipamento: string;
      totalGp: number;
      totalGoinfra: number;
      totalHoras: number;
      custoHoraGoinfraRef: number | null;
    };

    const map = new Map<string, Acc>();

    filteredData.forEach((row) => {
      const eq = row.equipamento;
      if (!eq) return;

      const horas = row.horas_trab_mes ?? 0;
      const gp = row.custo_gp ?? 0;
      const go = row.custo_goinfra ?? 0;

      const current: Acc =
        map.get(eq) || {
          equipamento: eq,
          totalGp: 0,
          totalGoinfra: 0,
          totalHoras: 0,
          custoHoraGoinfraRef: null,
        };

      current.totalGp += gp;
      current.totalGoinfra += go;
      current.totalHoras += horas;

      // guarda o custo hora de referência GOINFRA se vier preenchido
      if (row.custo_hora_goinfra != null) {
        current.custoHoraGoinfraRef = row.custo_hora_goinfra;
      }

      map.set(eq, current);
    });

    const stats: EquipStat[] = [];
    for (const acc of map.values()) {
      const custoHoraGp =
        acc.totalHoras > 0 ? acc.totalGp / acc.totalHoras : null;

      const custoHoraGoinfraCalc =
        acc.totalHoras > 0 ? acc.totalGoinfra / acc.totalHoras : null;

      const custoHoraGoinfra =
        acc.custoHoraGoinfraRef != null
          ? acc.custoHoraGoinfraRef
          : custoHoraGoinfraCalc;

      const diffHora =
        custoHoraGp != null && custoHoraGoinfra != null
          ? custoHoraGp - custoHoraGoinfra
          : null;

      const diffPercent =
        custoHoraGp != null &&
        custoHoraGoinfra != null &&
        custoHoraGoinfra > 0
          ? custoHoraGp / custoHoraGoinfra - 1
          : null;

      stats.push({
        equipamento: acc.equipamento,
        totalGp: acc.totalGp,
        totalGoinfra: acc.totalGoinfra,
        totalHoras: acc.totalHoras,
        custoHoraGp,
        custoHoraGoinfra,
        diffHora,
        diffPercent,
      });
    }

    return stats;
  }, [filteredData]);

  // TOP 5 mais caros / mais baratos por hora
  const topMaisCaros: EquipStat[] = useMemo(() => {
    const valid = equipStats.filter((s) => {
      if (s.totalHoras <= 0) return false;
      if (rankingMode === "percent") return s.diffPercent != null;
      return s.diffHora != null;
    });

    const sorted = [...valid].sort((a, b) => {
      if (rankingMode === "percent") {
        return (b.diffPercent! ?? 0) - (a.diffPercent! ?? 0);
      }
      return (b.diffHora! ?? 0) - (a.diffHora! ?? 0);
    });

    return sorted.slice(0, 5);
  }, [equipStats, rankingMode]);

  const topMaisBaratos: EquipStat[] = useMemo(() => {
    const valid = equipStats.filter((s) => {
      if (s.totalHoras <= 0) return false;
      if (rankingMode === "percent") return s.diffPercent != null;
      return s.diffHora != null;
    });

    const sorted = [...valid].sort((a, b) => {
      if (rankingMode === "percent") {
        return (a.diffPercent! ?? 0) - (b.diffPercent! ?? 0);
      }
      return (a.diffHora! ?? 0) - (b.diffHora! ?? 0);
    });

    return sorted.slice(0, 5);
  }, [equipStats, rankingMode]);

  const chartData = {
    labels: chartLabels,
    datasets: [
      {
        type: "bar" as const,
        label: "Custo GP Asfalto (R$)",
        data: barData,
        backgroundColor: "#fb4b37",
        borderRadius: 10,
        maxBarThickness: 40,
      },
      {
        type: "line" as const,
        label: "Custo GOINFRA (R$)",
        data: lineData,
        borderColor: "#111827",
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 4,
        pointBorderWidth: 2,
        pointBackgroundColor: "#ffffff",
        pointBorderColor: "#111827",
        yAxisID: "y",
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false as const,
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          usePointStyle: true,
          font: {
            size: 11,
            family:
              "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          },
        },
      },
      tooltip: {
        callbacks: {
          label: (context: any) => {
            const label = context.dataset.label || "";
            const value = context.parsed.y || 0;
            return `${label}: ${currency.format(value)}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        grid: { color: "#e5e7eb" },
        ticks: {
          callback: (value: any) => currency.format(Number(value)),
        },
      },
    },
  };

  const monthOptions = monthLabels.map((label, index) => ({
    label,
    value: index + 1,
  }));

  const periodLabel =
    startMonth === 1 && endMonth === 12
      ? "Jan–Dez 2025"
      : `${monthLabels[startMonth - 1]}–${monthLabels[endMonth - 1]} · 2025`;

  const rankingSubtitle =
    rankingMode === "percent"
      ? "Diferença de custo/hora em %: GP ÷ GOINFRA - 1 (maior % = pior)."
      : "Diferença de custo/hora em R$/h: GP – GOINFRA (maior valor = pior).";

  return (
    <div className="page-root">
      <div className="page-container">
        {/* HEADER / BRANDING COM LOGO */}
        <header className="page-header">
          <div className="brand">
            <img
              src="/gpasfalto-logo.png"
              alt="GP Asfalto"
              className="brand-logo"
              style={{
                width: 72,
                height: 72,
                borderRadius: 20,
                border: "1px solid #e5e7eb",
                background: "#ffffff",
                objectFit: "contain",
              }}
            />
            <div>
              <div className="brand-text-main">
                Dashboard de Manutenção 2025 - GP Asfalto
              </div>
              <div className="brand-text-sub">
                Comparativo de custos de manutenção · GP Asfalto x GOINFRA
              </div>
            </div>
          </div>

          <div className="header-right">
            <div className="header-pill">
              <span>Período</span>
              <strong>{periodLabel}</strong>
            </div>
          </div>
        </header>

        {/* FILTROS */}
        <section className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Overview do período</div>
              <div className="section-subtitle">
                Selecione equipamento e meses para atualizar os indicadores.
              </div>
            </div>
          </div>

          <div className="filter-bar">
            <div className="filter-label">Filtros</div>
            <div className="filter-group">
              {/* Equipamento */}
              <div className="filter-chip">
                <span style={{ marginRight: 6 }}>Equipamento:</span>
                <select
                  value={selectedEquip}
                  onChange={(e) =>
                    setSelectedEquip(
                      e.target.value === "all" ? "all" : e.target.value
                    )
                  }
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: "0.8rem",
                    outline: "none",
                  }}
                >
                  <option value="all">Todos (exceto TP-03)</option>
                  {equipmentOptions.map((eq) => (
                    <option key={eq} value={eq}>
                      {eq}
                    </option>
                  ))}
                </select>
              </div>

              {/* Mês inicial */}
              <div className="filter-chip">
                <span style={{ marginRight: 6 }}>Mês inicial:</span>
                <select
                  value={startMonth}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setStartMonth(val);
                    if (val > endMonth) setEndMonth(val);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: "0.8rem",
                    outline: "none",
                  }}
                >
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Mês final */}
              <div className="filter-chip">
                <span style={{ marginRight: 6 }}>Mês final:</span>
                <select
                  value={endMonth}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setEndMonth(val);
                    if (val < startMonth) setStartMonth(val);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: "0.8rem",
                    outline: "none",
                  }}
                >
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Texto do filtro */}
              <div className="filter-chip">
                <span>
                  {selectedEquip === "all"
                    ? "Frota completa no período (sem TP-03)."
                    : `Equipamento: ${selectedEquip}`}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* CARDS PRINCIPAIS */}
        <section className="summary-grid">
          <div className="summary-card">
            <div className="summary-label">Custo total GP</div>
            <div className="summary-value">
              {currency.format(summary.totalGp)}
            </div>
            <div className="summary-subvalue">
              Soma das ordens de manutenção GP no período filtrado.
            </div>
          </div>

          <div className="summary-card">
            <div className="summary-label">Custo total GOINFRA</div>
            <div className="summary-value">
              {currency.format(summary.totalGoinfra)}
            </div>
            <div className="summary-subvalue">
              Horas trabalhadas × custo/hora de referência GOINFRA.
            </div>
          </div>

          <div className="summary-card">
            <div className="summary-label">Diferença (GP – GOINFRA)</div>
            <div
              className="summary-value"
              style={{
                color: summary.diff > 0 ? "#dc2626" : "#16a34a",
              }}
            >
              {currency.format(summary.diff)}
            </div>
            <div className="summary-subvalue">
              Valor positivo indica custo maior na operação GP vs GOINFRA.
            </div>
          </div>

          <div className="summary-card">
            <div className="summary-label">Horas trabalhadas</div>
            <div className="summary-value">
              {summary.totalHoras.toLocaleString("pt-BR", {
                maximumFractionDigits: 1,
              })}
            </div>
            <div className="summary-subvalue">
              Soma das horas de todos os equipamentos no período.
            </div>
          </div>
        </section>

        {/* CARDS CUSTO/HORA */}
        <section className="summary-grid">
          <div className="summary-card">
            <div className="summary-label">Custo hora GP Asfalto</div>
            <div className="summary-value" style={{ fontSize: "1.4rem" }}>
              {summary.custoHoraGp != null
                ? currency.format(summary.custoHoraGp)
                : "—"}
            </div>
            <div className="summary-subvalue">
              Custo total GP dividido pelas horas reais trabalhadas.
            </div>
          </div>

          <div className="summary-card">
            <div className="summary-label">Custo hora GOINFRA (médio)</div>
            <div className="summary-value" style={{ fontSize: "1.4rem" }}>
              {summary.custoHoraGoinfra != null
                ? currency.format(summary.custoHoraGoinfra)
                : "—"}
            </div>
            <div className="summary-subvalue">
              Custo teórico ponderado pelas horas trabalhadas.
            </div>
          </div>
        </section>

        {/* TOGGLE DE RANKING + TOP 5 */}
        <section>
          {/* Toggle de modo de ranking */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginBottom: 8,
              fontSize: "0.75rem",
              color: "var(--gp-muted)",
            }}
          >
            <span style={{ marginRight: 8, color: "var(--gp-muted-soft)" }}>
              Ordenar TOP 5 por:
            </span>
            <button
              onClick={() => setRankingMode("percent")}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border:
                  rankingMode === "percent"
                    ? "1px solid var(--gp-accent)"
                    : "1px solid #e5e7eb",
                background:
                  rankingMode === "percent"
                    ? "var(--gp-accent-soft)"
                    : "#ffffff",
                color:
                  rankingMode === "percent"
                    ? "var(--gp-accent)"
                    : "var(--gp-muted)",
                fontSize: "0.75rem",
                cursor: "pointer",
                marginRight: 4,
              }}
            >
              % Dif
            </button>
            <button
              onClick={() => setRankingMode("value")}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border:
                  rankingMode === "value"
                    ? "1px solid var(--gp-accent)"
                    : "1px solid #e5e7eb",
                background:
                  rankingMode === "value"
                    ? "var(--gp-accent-soft)"
                    : "#ffffff",
                color:
                  rankingMode === "value"
                    ? "var(--gp-accent)"
                    : "var(--gp-muted)",
                fontSize: "0.75rem",
                cursor: "pointer",
              }}
            >
              R$/h
            </button>
          </div>

          <div className="summary-grid">
            <div className="section-card">
              <div className="section-header">
                <div>
                  <div className="section-title">
                    Top 5 · Mais caros por hora (GP × GOINFRA)
                  </div>
                  <div className="section-subtitle">{rankingSubtitle}</div>
                </div>
              </div>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Equipamento</th>
                      <th>Horas</th>
                      <th>GP / h</th>
                      <th>GOINFRA / h</th>
                      <th>Dif. (R$/h)</th>
                      <th>Dif. (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMaisCaros.length === 0 && (
                      <tr>
                        <td colSpan={6}>Sem dados para o filtro atual.</td>
                      </tr>
                    )}
                    {topMaisCaros.map((s) => {
                      const diffColor =
                        (s.diffHora ?? 0) > 0 ? "#dc2626" : "#16a34a";
                      const diffPercentStr =
                        s.diffPercent != null
                          ? `${(s.diffPercent * 100).toFixed(1)}%`
                          : "—";
                      return (
                        <tr key={s.equipamento}>
                          <td>{s.equipamento}</td>
                          <td>
                            {s.totalHoras.toLocaleString("pt-BR", {
                              maximumFractionDigits: 1,
                            })}
                          </td>
                          <td>
                            {s.custoHoraGp != null
                              ? currency.format(s.custoHoraGp)
                              : "—"}
                          </td>
                          <td>
                            {s.custoHoraGoinfra != null
                              ? currency.format(s.custoHoraGoinfra)
                              : "—"}
                          </td>
                          <td style={{ color: diffColor, fontWeight: 600 }}>
                            {s.diffHora != null
                              ? currency.format(s.diffHora)
                              : "—"}
                          </td>
                          <td style={{ color: diffColor, fontWeight: 600 }}>
                            {diffPercentStr}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="section-card">
              <div className="section-header">
                <div>
                  <div className="section-title">
                    Top 5 · Mais baratos por hora (GP × GOINFRA)
                  </div>
                  <div className="section-subtitle">
                    {rankingMode === "percent"
                      ? "Mais negativo em % = melhor."
                      : "Menor diferença em R$/h = melhor."}
                  </div>
                </div>
              </div>
              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Equipamento</th>
                      <th>Horas</th>
                      <th>GP / h</th>
                      <th>GOINFRA / h</th>
                      <th>Dif. (R$/h)</th>
                      <th>Dif. (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMaisBaratos.length === 0 && (
                      <tr>
                        <td colSpan={6}>Sem dados para o filtro atual.</td>
                      </tr>
                    )}
                    {topMaisBaratos.map((s) => {
                      const diffColor =
                        (s.diffHora ?? 0) > 0 ? "#dc2626" : "#16a34a";
                      const diffPercentStr =
                        s.diffPercent != null
                          ? `${(s.diffPercent * 100).toFixed(1)}%`
                          : "—";
                      return (
                        <tr key={s.equipamento}>
                          <td>{s.equipamento}</td>
                          <td>
                            {s.totalHoras.toLocaleString("pt-BR", {
                              maximumFractionDigits: 1,
                            })}
                          </td>
                          <td>
                            {s.custoHoraGp != null
                              ? currency.format(s.custoHoraGp)
                              : "—"}
                          </td>
                          <td>
                            {s.custoHoraGoinfra != null
                              ? currency.format(s.custoHoraGoinfra)
                              : "—"}
                          </td>
                          <td style={{ color: diffColor, fontWeight: 600 }}>
                            {s.diffHora != null
                              ? currency.format(s.diffHora)
                              : "—"}
                          </td>
                          <td style={{ color: diffColor, fontWeight: 600 }}>
                            {diffPercentStr}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* GRÁFICO PRINCIPAL */}
        <section className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">
                Custo mensal · GP (barras) x GOINFRA (linha)
              </div>
              <div className="section-subtitle">
                Valores acumulados por mês no período selecionado.
              </div>
            </div>
          </div>

          {error && (
            <div className="state-card" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}

          {loading ? (
            <div className="state-card">Carregando dados…</div>
          ) : (
            <div style={{ height: 320 }}>
              <Bar data={chartData as any} options={chartOptions as any} />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
