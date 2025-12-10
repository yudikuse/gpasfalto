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

  // 1) Buscar dados da view equipment_costs_2025_v (CUSTO GOINFRA CERTO AQUI)
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

  // Lista de equipamentos disponíveis para o filtro
  const equipmentOptions = useMemo(() => {
    const set = new Set<string>();
    data.forEach((row) => set.add(row.equipamento));
    return Array.from(set).sort();
  }, [data]);

  // Aplicar filtros (equipamento + range de meses)
  const filteredData = useMemo(() => {
    return data.filter((row) => {
      const inEquip =
        selectedEquip === "all" || row.equipamento === selectedEquip;
      const inMonth = row.mes >= startMonth && row.mes <= endMonth;
      return inEquip && inMonth;
    });
  }, [data, selectedEquip, startMonth, endMonth]);

  // Agregar por mês para gerar as séries de barras (GP) e linha (GOINFRA)
  const monthlyAggregates = useMemo(() => {
    const result: {
      [mes: number]: { gp: number; goinfra: number };
    } = {};

    filteredData.forEach((row) => {
      if (!result[row.mes]) {
        result[row.mes] = { gp: 0, goinfra: 0 };
      }
      result[row.mes].gp += row.custo_gp ?? 0;
      result[row.mes].goinfra += row.custo_goinfra ?? 0;
    });

    return result;
  }, [filteredData]);

  // Labels e dados só dentro do range selecionado
  const chartLabels = monthLabels.slice(startMonth - 1, endMonth);
  const barData = chartLabels.map((_, idx) => {
    const monthNumber = startMonth + idx;
    return monthlyAggregates[monthNumber]?.gp ?? 0;
  });
  const lineData = chartLabels.map((_, idx) => {
    const monthNumber = startMonth + idx;
    return monthlyAggregates[monthNumber]?.goinfra ?? 0;
  });

  // Totais e resumo para os cards
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

  const chartData = {
    labels: chartLabels,
    datasets: [
      {
        type: "bar" as const,
        label: "Custo GP Asfalto (R$)",
        data: barData,
        backgroundColor: "#fb4b37",
        borderRadius: 8,
        maxBarThickness: 40,
      },
      {
        type: "line" as const,
        label: "Custo GOINFRA (R$)",
        data: lineData,
        borderColor: "#1f2937",
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 4,
        pointBorderWidth: 2,
        pointBackgroundColor: "#ffffff",
        pointBorderColor: "#1f2937",
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
          font: {
            size: 11,
            family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI'",
          },
          usePointStyle: true,
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
        grid: {
          display: false,
        },
        ticks: {
          font: {
            size: 11,
          },
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: "#e5e7eb",
        },
        ticks: {
          callback: (value: any) => currency.format(Number(value)),
          font: {
            size: 11,
          },
        },
      },
    },
  };

  const monthOptions = monthLabels.map((label, index) => ({
    label,
    value: index + 1,
  }));

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      {/* HEADER COM "LOGO" */}
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            {/* Logo simples GP Asfalto */}
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900">
              <span className="text-base font-semibold tracking-tight text-white">
                GP
              </span>
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                GP Asfalto · Manutenção 2025
              </h1>
              <p className="text-xs text-slate-500">
                Comparativo de custos: GP Asfalto x GOINFRA, por período e
                equipamento.
              </p>
            </div>
          </div>

          <div className="hidden text-right text-xs text-slate-500 md:block">
            <div>Visão consolidada</div>
            <div>
              {startMonth === 1 && endMonth === 12
                ? "Jan–Dez 2025"
                : `${monthLabels[startMonth - 1]}–${
                    monthLabels[endMonth - 1]
                  } / 2025`}
            </div>
          </div>
        </div>
      </header>

      {/* CONTENT */}
      <main className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        {/* FILTROS */}
        <section className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-slate-100">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[220px]">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Equipamento
              </span>
              <select
                value={selectedEquip}
                onChange={(e) =>
                  setSelectedEquip(
                    e.target.value === "all" ? "all" : e.target.value
                  )
                }
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:bg-white"
              >
                <option value="all">Todos os equipamentos</option>
                {equipmentOptions.map((eq) => (
                  <option key={eq} value={eq}>
                    {eq}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-1 flex-wrap gap-4">
              <div className="min-w-[120px]">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Mês inicial
                </span>
                <select
                  value={startMonth}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setStartMonth(val);
                    if (val > endMonth) setEndMonth(val);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:bg-white"
                >
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[120px]">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Mês final
                </span>
                <select
                  value={endMonth}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setEndMonth(val);
                    if (val < startMonth) setStartMonth(val);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-slate-400 focus:bg-white"
                >
                  {monthOptions.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex-1 text-xs text-slate-500 md:text-right">
                {selectedEquip === "all"
                  ? "Visão geral da frota no período selecionado."
                  : `Equipamento: ${selectedEquip}`}
              </div>
            </div>
          </div>
        </section>

        {/* CARDS DE RESUMO */}
        <section className="grid gap-5 md:grid-cols-3">
          <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-slate-100">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Custo total GP Asfalto
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              {currency.format(summary.totalGp)}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Soma de todas as ordens de manutenção GP no período filtrado.
            </p>
          </div>

          <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-slate-100">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Custo total GOINFRA
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              {currency.format(summary.totalGoinfra)}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Horas trabalhadas × custo/hora de referência GOINFRA.
            </p>
          </div>

          <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-slate-100">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Diferença total (GP – GOINFRA)
            </div>
            <div
              className={`mt-2 text-2xl font-semibold tracking-tight ${
                summary.diff > 0 ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {currency.format(summary.diff)}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Valor positivo indica custo maior na operação GP em relação ao
              parâmetro GOINFRA.
            </p>
          </div>
        </section>

        {/* CARD CUSTO HORA */}
        <section className="grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-slate-100">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Custo hora GP Asfalto
            </div>
            <div className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
              {summary.custoHoraGp != null
                ? currency.format(summary.custoHoraGp)
                : "—"}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Custo total GP dividido pelas horas reais trabalhadas no período.
            </p>
          </div>

          <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-slate-100">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Custo hora GOINFRA (médio no período)
            </div>
            <div className="mt-2 text-xl font-semibold tracking-tight text-slate-900">
              {summary.custoHoraGoinfra != null
                ? currency.format(summary.custoHoraGoinfra)
                : "—"}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Custo teórico de referência ponderado pelas horas trabalhadas.
            </p>
          </div>
        </section>

        {/* GRÁFICO PRINCIPAL */}
        <section className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-slate-100">
          <div className="mb-3 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-slate-900">
              Custo mensal – GP (barras) x GOINFRA (linha)
            </h2>
            <span className="text-xs text-slate-500">
              Valores acumulados por mês no período filtrado.
            </span>
          </div>

          {error && (
            <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex h-72 items-center justify-center text-sm text-slate-500">
              Carregando dados...
            </div>
          ) : (
            <div className="h-80">
              <Bar data={chartData as any} options={chartOptions as any} />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
