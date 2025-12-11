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

export default function DashboardPage() {
  const [data, setData] = useState<EquipmentCostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEquip, setSelectedEquip] = useState<"all" | string>("all");
  const [startMonth, setStartMonth] = useState(1);
  const [endMonth, setEndMonth] = useState(12);
  const [error, setError] = useState<string | null>(null);

  // === FETCH: view equipment_costs_2025_v (dados corretos) ===
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

  // Equipamentos disponíveis
  const equipmentOptions = useMemo(() => {
    const set = new Set<string>();
    data.forEach((row) => set.add(row.equipamento));
    return Array.from(set).sort();
  }, [data]);

  // Filtros aplicados
  const filteredData = useMemo(
    () =>
      data.filter((row) => {
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

  // === TOP 5 MAIS CAROS / MAIS BARATOS POR HORA (GP x GOINFRA) ===
  type EquipStat = {
    equipamento: string;
    totalGp: number;
    totalGoinfra: number;
    totalHoras: number;
    custoHoraGp?: number;
    custoHoraGoinfra?: number;
    diffHora?: number;
  };

  const { topMaisCaros, topMaisBaratos } = useMemo(() => {
    const map = new Map<string, EquipStat>();

    filteredData.forEach((row) => {
      const eq = row.equipamento;
      if (!eq) return;

      const horas = row.horas_trab_mes ?? 0;
      const gp = row.custo_gp ?? 0;
      const go = row.custo_goinfra ?? 0;

      const current = map.get(eq) || {
        equipamento: eq,
        totalGp: 0,
        totalGoinfra: 0,
        totalHoras: 0,
      };

      current.totalGp += gp;
      current.totalGoinfra += go;
      current.totalHoras += horas;

      map.set(eq, current);
    });

    const stats: EquipStat[] = Array.from(map.values()).map((s) => {
      if (s.totalHoras > 0) {
        s.custoHoraGp = s.totalGp / s.totalHoras;
        s.custoHoraGoinfra = s.totalGoinfra / s.totalHoras;
        if (s.custoHoraGp != null && s.custoHoraGoinfra != null) {
          s.diffHora = s.custoHoraGp - s.custoHoraGoinfra;
        }
      }
      return s;
    });

    const valid = stats.filter(
      (s) => s.totalHoras > 0 && s.diffHora != null
    ) as Required<EquipStat>[];

    const topMaisCaros = [...valid]
      .sort((a, b) => b.diffHora - a.diffHora)
      .slice(0, 5);

    const topMaisBaratos = [...valid]
      .sort((a, b) => a.diffHora - b.diffHora)
      .slice(0, 5);

    return { topMaisCaros, topMaisBaratos };
  }, [filteredData]);

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

  return (
    <div className="page-root">
      <div className="page-container">
        {/* HEADER / BRANDING COM LOGO GRANDE */}
        <header className="page-header">
          <div className="brand">
            {/* Troca o src abaixo para o arquivo real da logo: /logo-gp-asfalto.png */}
            <div
              className="brand-logo"
              style={{
                width: 72,
                height: 72,
                borderRadius: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* fallback caso a logo ainda não exista */}
              <span style={{ fontWeight: 600, fontSize: "1rem" }}>GP</span>
            </div>
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
                  <option value="all">Todos</option>
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
                    ? "Frota completa no período."
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
              Valor positivo indica custo maior na operação GP em relação ao
              parâmetro GOINFRA.
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

        {/* TOP 5 MAIS CAROS / MAIS BARATOS POR HORA */}
        <section className="summary-grid">
          <div className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">
                  Top 5 · Mais caros por hora (GP x GOINFRA)
                </div>
                <div className="section-subtitle">
                  Diferença de custo/hora: GP – GOINFRA (maior &gt; pior).
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
                    <th>Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {topMaisCaros.length === 0 && (
                    <tr>
                      <td colSpan={5}>Sem dados para o filtro atual.</td>
                    </tr>
                  )}
                  {topMaisCaros.map((s) => (
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
                      <td
                        style={{
                          color: s.diffHora! > 0 ? "#dc2626" : "#16a34a",
                          fontWeight: 600,
                        }}
                      >
                        {currency.format(s.diffHora!)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">
                  Top 5 · Mais baratos por hora (GP x GOINFRA)
                </div>
                <div className="section-subtitle">
                  Diferença de custo/hora: GP – GOINFRA (mais negativo &gt;
                  melhor).
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
                    <th>Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {topMaisBaratos.length === 0 && (
                    <tr>
                      <td colSpan={5}>Sem dados para o filtro atual.</td>
                    </tr>
                  )}
                  {topMaisBaratos.map((s) => (
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
                      <td
                        style={{
                          color: s.diffHora! > 0 ? "#dc2626" : "#16a34a",
                          fontWeight: 600,
                        }}
                      >
                        {currency.format(s.diffHora!)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
