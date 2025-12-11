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

type OficinaRow = {
  mes_ano: string | null;
  valor_menor: number | null;
};

type RankingMode = "percent" | "value";

type ProcessedRow = EquipmentCostRow & {
  oficina_share: number;
  mao_obra_share: number;
  custo_gp_total: number;
};

type EquipStat = {
  equipamento: string;
  totalGp: number;
  totalGoinfra: number;
  totalHoras: number;
  custoHoraGp: number | null;
  custoHoraGoinfra: number | null;
  diffHora: number | null;
  diffPercent: number | null;
};

type CategoryStat = {
  category: string;
  totalGp: number;
  totalGoinfra: number;
  totalHoras: number;
  custoHoraGp: number | null;
  custoHoraGoinfra: number | null;
  diffHora: number | null;
  diffPercent: number | null;
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

// valor fixo mensal de mão de obra para rateio
const MAO_OBRA_MENSAL = 88000;

function getCategoryFromEquip(equipamento: string | null): string | null {
  if (!equipamento) return null;
  const idx = equipamento.indexOf("-");
  if (idx === -1) return equipamento;
  return equipamento.slice(0, idx);
}

export default function DashboardPage() {
  const [data, setData] = useState<EquipmentCostRow[]>([]);
  const [oficinaData, setOficinaData] = useState<OficinaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEquip, setSelectedEquip] = useState<"all" | string>("all");
  const [startMonth, setStartMonth] = useState(1);
  const [endMonth, setEndMonth] = useState(12);
  const [error, setError] = useState<string | null>(null);
  const [rankingMode, setRankingMode] = useState<RankingMode>("percent");
  const [includeOficina, setIncludeOficina] = useState<boolean>(true);
  const [includeMaoObra, setIncludeMaoObra] = useState<boolean>(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      const [equipRes, oficinaRes] = await Promise.all([
        supabase.from("equipment_costs_2025_v").select("*").eq("ano", 2025),
        supabase.from("oficina_costs_by_month").select("*"),
      ]);

      if (equipRes.error) {
        console.error(equipRes.error);
        setError("Erro ao carregar dados de custos.");
        setLoading(false);
        return;
      }
      if (oficinaRes.error) {
        console.error(oficinaRes.error);
        setError("Erro ao carregar custos da oficina.");
        setLoading(false);
        return;
      }

      setData((equipRes.data || []) as EquipmentCostRow[]);
      setOficinaData((oficinaRes.data || []) as OficinaRow[]);
      setLoading(false);
    };

    fetchData();
  }, []);

  const equipmentOptions = useMemo(() => {
    const set = new Set<string>();
    data.forEach((row) => {
      if (row.equipamento && row.equipamento !== "TP-03") {
        set.add(row.equipamento);
      }
    });
    return Array.from(set).sort();
  }, [data]);

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

  const oficinaByMonth = useMemo(() => {
    const map: { [mes: number]: number } = {};
    oficinaData.forEach((row) => {
      if (!row.mes_ano) return;
      const parts = row.mes_ano.split("-");
      if (parts.length < 2) return;
      const mes = Number(parts[1]);
      if (!Number.isFinite(mes)) return;
      const val = row.valor_menor ?? 0;
      map[mes] = (map[mes] ?? 0) + val;
    });
    return map;
  }, [oficinaData]);

  const gpTotalsByMonth = useMemo(() => {
    const map: { [mes: number]: number } = {};
    data.forEach((row) => {
      if (row.equipamento === "TP-03") return;
      const mes = row.mes;
      const gp = row.custo_gp ?? 0;
      map[mes] = (map[mes] ?? 0) + gp;
    });
    return map;
  }, [data]);

  const processedFilteredData: ProcessedRow[] = useMemo(() => {
    return filteredData.map((row) => {
      const directGp = row.custo_gp ?? 0;
      const mes = row.mes;
      const totalGpMes = gpTotalsByMonth[mes] ?? 0;
      const oficinaMes = includeOficina ? oficinaByMonth[mes] ?? 0 : 0;
      const maoObraMes = includeMaoObra ? MAO_OBRA_MENSAL : 0;

      let oficinaShare = 0;
      let maoObraShare = 0;

      if (totalGpMes > 0) {
        if (includeOficina && oficinaMes > 0) {
          oficinaShare = (directGp / totalGpMes) * oficinaMes;
        }
        if (includeMaoObra && maoObraMes > 0) {
          maoObraShare = (directGp / totalGpMes) * maoObraMes;
        }
      }

      const custo_gp_total = directGp + oficinaShare + maoObraShare;

      return {
        ...row,
        oficina_share: oficinaShare,
        mao_obra_share: maoObraShare,
        custo_gp_total,
      };
    });
  }, [
    filteredData,
    gpTotalsByMonth,
    oficinaByMonth,
    includeOficina,
    includeMaoObra,
  ]);

  const monthlyAggregates = useMemo(() => {
    const result: {
      [mes: number]: {
        gpDireto: number;
        oficina: number;
        maoObra: number;
        goinfra: number;
      };
    } = {};

    processedFilteredData.forEach((row) => {
      const mes = row.mes;
      if (!result[mes]) {
        result[mes] = { gpDireto: 0, oficina: 0, maoObra: 0, goinfra: 0 };
      }
      result[mes].gpDireto += row.custo_gp ?? 0;
      result[mes].oficina += row.oficina_share;
      result[mes].maoObra += row.mao_obra_share;
      result[mes].goinfra += row.custo_goinfra ?? 0;
    });

    return result;
  }, [processedFilteredData]);

  const chartLabels = monthLabels.slice(startMonth - 1, endMonth);
  const barGpData = chartLabels.map((_, idx) => {
    const mes = startMonth + idx;
    return monthlyAggregates[mes]?.gpDireto ?? 0;
  });
  const barOficinaData = chartLabels.map((_, idx) => {
    const mes = startMonth + idx;
    return monthlyAggregates[mes]?.oficina ?? 0;
  });
  const barMaoObraData = chartLabels.map((_, idx) => {
    const mes = startMonth + idx;
    return monthlyAggregates[mes]?.maoObra ?? 0;
  });
  const lineData = chartLabels.map((_, idx) => {
    const mes = startMonth + idx;
    return monthlyAggregates[mes]?.goinfra ?? 0;
  });

  const summary = useMemo(() => {
    let totalGp = 0;
    let totalGoinfra = 0;
    let totalHoras = 0;

    processedFilteredData.forEach((row) => {
      totalGp += row.custo_gp_total;
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
  }, [processedFilteredData]);

  const equipStats: EquipStat[] = useMemo(() => {
    type Acc = {
      equipamento: string;
      totalGp: number;
      totalGoinfra: number;
      totalHoras: number;
      custoHoraGoinfraRef: number | null;
    };

    const map = new Map<string, Acc>();

    processedFilteredData.forEach((row) => {
      const eq = row.equipamento;
      if (!eq) return;

      const horas = row.horas_trab_mes ?? 0;
      const gpTotal = row.custo_gp_total;
      const go = row.custo_goinfra ?? 0;

      const current: Acc =
        map.get(eq) || {
          equipamento: eq,
          totalGp: 0,
          totalGoinfra: 0,
          totalHoras: 0,
          custoHoraGoinfraRef: null,
        };

      current.totalGp += gpTotal;
      current.totalGoinfra += go;
      current.totalHoras += horas;

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
  }, [processedFilteredData]);

  const categoryStats: CategoryStat[] = useMemo(() => {
    type Acc = {
      category: string;
      totalGp: number;
      totalGoinfra: number;
      totalHoras: number;
    };

    const map = new Map<string, Acc>();

    processedFilteredData.forEach((row) => {
      const cat = getCategoryFromEquip(row.equipamento);
      if (!cat) return;

      const horas = row.horas_trab_mes ?? 0;
      const gp = row.custo_gp_total;
      const go = row.custo_goinfra ?? 0;

      const current: Acc =
        map.get(cat) || {
          category: cat,
          totalGp: 0,
          totalGoinfra: 0,
          totalHoras: 0,
        };

      current.totalGp += gp;
      current.totalGoinfra += go;
      current.totalHoras += horas;

      map.set(cat, current);
    });

    const list: CategoryStat[] = [];

    for (const acc of map.values()) {
      const custoHoraGp =
        acc.totalHoras > 0 ? acc.totalGp / acc.totalHoras : null;
      const custoHoraGoinfra =
        acc.totalHoras > 0 ? acc.totalGoinfra / acc.totalHoras : null;
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

      list.push({
        category: acc.category,
        totalGp: acc.totalGp,
        totalGoinfra: acc.totalGoinfra,
        totalHoras: acc.totalHoras,
        custoHoraGp,
        custoHoraGoinfra,
        diffHora,
        diffPercent,
      });
    }

    list.sort((a, b) => {
      const aVal = a.diffPercent ?? 0;
      const bVal = b.diffPercent ?? 0;
      return aVal - bVal;
    });

    return list;
  }, [processedFilteredData]);

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

  // ====== GRÁFICO MENSAL (AQUI VAI A CORREÇÃO DA LINHA) ======
  const datasets: any[] = [
    {
      type: "bar" as const,
      label: "Custo GP Asfalto (R$)",
      data: barGpData,
      backgroundColor: "#fb4b37",
      borderRadius: 10,
      maxBarThickness: 40,
      stack: "gp",
      order: 1,
      z: 0,
    },
  ];

  if (includeOficina) {
    datasets.push({
      type: "bar" as const,
      label: "Rateio oficina (R$)",
      data: barOficinaData,
      backgroundColor: "#ff8a73",
      borderRadius: 10,
      maxBarThickness: 40,
      stack: "gp",
      order: 1,
      z: 0,
    });
  }

  if (includeMaoObra) {
    datasets.push({
      type: "bar" as const,
      label: "Mão de obra (R$)",
      data: barMaoObraData,
      backgroundColor: "#fdba74",
      borderRadius: 10,
      maxBarThickness: 40,
      stack: "gp",
      order: 1,
      z: 0,
    });
  }

  // LINHA GOINFRA: z bem maior + order alto + fill false
  datasets.push({
    type: "line" as const,
    label: "Custo GOINFRA (R$)",
    data: lineData,
    borderColor: "#4b5563",
    borderWidth: 3,
    tension: 0.25,
    pointRadius: 4,
    pointBorderWidth: 2,
    pointBackgroundColor: "#ffffff",
    pointBorderColor: "#4b5563",
    yAxisID: "y",
    order: 999,
    z: 100,
    fill: false,
  });

  const chartData: any = {
    labels: chartLabels,
    datasets,
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
      x: { grid: { display: false } },
      y: {
        beginAtZero: true,
        grid: { color: "#e5e7eb" },
        ticks: {
          callback: (value: any) => currency.format(Number(value)),
        },
      },
    },
  };
  // ====== FIM DO GRÁFICO MENSAL ======

  const categoryChartData: any = {
    labels: categoryStats.map((c) => c.category),
    datasets: [
      {
        type: "bar" as const,
        label: "GP / h",
        data: categoryStats.map((c) => c.custoHoraGp ?? 0),
        backgroundColor: "#fb4b37",
        borderRadius: 10,
        maxBarThickness: 40,
        yAxisID: "y",
      },
      {
        type: "bar" as const,
        label: "GOINFRA / h",
        data: categoryStats.map((c) => c.custoHoraGoinfra ?? 0),
        backgroundColor: "#4b5563",
        borderRadius: 10,
        maxBarThickness: 40,
        yAxisID: "y",
      },
      {
        type: "line" as const,
        label: "Diferença % (GP vs GOINFRA)",
        data: categoryStats.map((c) =>
          c.diffPercent != null ? c.diffPercent * 100 : 0
        ),
        borderColor: "#0f766e",
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 3,
        pointBackgroundColor: "#0f766e",
        pointBorderColor: "#0f766e",
        yAxisID: "y1",
      },
    ],
  };

  const categoryChartOptions = {
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
            const datasetLabel = context.dataset.label || "";
            const value = context.parsed.y || 0;
            if (context.dataset.yAxisID === "y1") {
              return `${datasetLabel}: ${value.toFixed(1)}%`;
            }
            return `${datasetLabel}: ${currency.format(value)}`;
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false } },
      y: {
        beginAtZero: true,
        grid: { color: "#e5e7eb" },
        ticks: {
          callback: (value: any) => currency.format(Number(value)),
        },
      },
      y1: {
        position: "right" as const,
        beginAtZero: true,
        grid: { display: false },
        ticks: {
          callback: (value: any) => `${value.toFixed(0)}%`,
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
        {/* HEADER / LOGO CENTRALIZADA */}
        <header
          className="page-header"
          style={{
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            className="brand"
            style={{
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <img
              src="/gpasfalto-logo.png"
              alt="GP Asfalto"
              style={{
                width: 240,
                height: 240,
                objectFit: "contain",
                border: "none",
                background: "transparent",
              }}
            />
            <div style={{ textAlign: "center" }}>
              <div className="brand-text-main">
                Dashboard de Manutenção 2025 - GP Asfalto
              </div>
              <div className="brand-text-sub">
                Comparativo de custos de manutenção · GP Asfalto x GOINFRA
              </div>
            </div>
          </div>

          <div style={{ marginTop: 4 }}>
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

              <div className="filter-chip">
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeOficina}
                    onChange={(e) => setIncludeOficina(e.target.checked)}
                    style={{ margin: 0 }}
                  />
                  <span>Incluir custo da oficina</span>
                </label>
              </div>

              <div className="filter-chip">
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeMaoObra}
                    onChange={(e) => setIncludeMaoObra(e.target.checked)}
                    style={{ margin: 0 }}
                  />
                  <span>Incluir custo de mão de obra</span>
                </label>
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
              {includeOficina || includeMaoObra
                ? "Soma das ordens de manutenção GP + rateios (oficina / mão de obra) no período filtrado."
                : "Soma das ordens de manutenção GP no período filtrado (sem rateios)."}
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
              Custo total GP dividido pelas horas reais trabalhadas
              (incluindo rateios ativos).
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

        {/* TOGGLE + TOP 5 */}
        <section>
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

        {/* GRÁFICO MENSAL */}
        <section className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">
                Custo mensal · GP (barras) x GOINFRA (linha)
              </div>
              <div className="section-subtitle">
                Barras empilhadas: GP direto + rateio da oficina + mão de obra.
                Linha: custo teórico GOINFRA.
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
              <Bar data={chartData} options={chartOptions as any} />
            </div>
          )}
        </section>

        {/* GRÁFICO POR CATEGORIA */}
        <section className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">
                Custo por categoria de equipamento (R$/h) · GP x GOINFRA
              </div>
              <div className="section-subtitle">
                Agrupa códigos por prefixo (RE, VBA, UA, TP, PC...) e ordena do
                melhor resultado para GP (à esquerda) até o pior (à direita),
                com linha de diferença percentual.
              </div>
            </div>
          </div>

          {loading ? (
            <div className="state-card">Carregando dados…</div>
          ) : categoryStats.length === 0 ? (
            <div className="state-card">
              Nenhuma categoria com dados para o filtro atual.
            </div>
          ) : (
            <div style={{ height: 260 }}>
              <Bar
                data={categoryChartData}
                options={categoryChartOptions as any}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
