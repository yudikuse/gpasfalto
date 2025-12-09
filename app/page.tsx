// FILE: app/page.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type OrderRow = {
  id: number;
  date: string; // vem como texto "DD/MM/AAAA"
  time: string;
  mes_ano: string | null;
  numero_oc: string | null;
  codigo_equipamento: string | null;
  valor_menor: number | null;
};

type DashboardStats = {
  totalRegistros: number;
  totalValor: number;
  porMes: { mes_ano: string; valor: number }[];
};

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("orders_2025_raw")
        .select("id, date, time, mes_ano, numero_oc, codigo_equipamento, valor_menor")
        .limit(10000); // tem menos que isso, é só para garantir

      if (error) {
        console.error("Erro ao buscar dados:", error);
        setError(error.message);
        setLoading(false);
        return;
      }

      const rows = (data || []) as OrderRow[];
      setOrders(rows);

      // calcular estatísticas básicas
      const totalRegistros = rows.length;
      const totalValor = rows.reduce(
        (sum, row) => sum + (row.valor_menor || 0),
        0
      );

      const mapaMes: Record<string, number> = {};

      rows.forEach((row) => {
        const mes = row.mes_ano || "sem_mês";
        const val = row.valor_menor || 0;
        if (!mapaMes[mes]) mapaMes[mes] = 0;
        mapaMes[mes] += val;
      });

      const porMes = Object.entries(mapaMes)
        .filter(([mes]) => mes !== "sem_mês")
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([mes_ano, valor]) => ({ mes_ano, valor }));

      setStats({
        totalRegistros,
        totalValor,
        porMes,
      });

      setLoading(false);
    }

    fetchData();
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-6xl">
        {/* Título */}
        <header className="mb-8 flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            GP Asfalto – Dashboard de Manutenção 2025
          </h1>
          <p className="text-sm text-slate-400">
            Dados brutos importados do grupo de compras (WhatsApp) – tabela{" "}
            <code className="bg-slate-900 px-1 rounded">orders_2025_raw</code>.
          </p>
        </header>

        {/* Estados de loading / erro */}
        {loading && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-6">
            <p className="text-slate-300">Carregando dados do Supabase…</p>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl border border-red-700 bg-red-950 px-4 py-6">
            <p className="font-semibold text-red-300">Erro ao carregar dados</p>
            <p className="text-sm text-red-200 mt-2">{error}</p>
          </div>
        )}

        {/* Conteúdo principal */}
        {!loading && !error && stats && (
          <>
            {/* Cards principais */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 flex flex-col">
                <span className="text-xs uppercase tracking-wide text-slate-400">
                  Registros (OC + Pedidos)
                </span>
                <span className="mt-2 text-3xl font-semibold">
                  {stats.totalRegistros.toLocaleString("pt-BR")}
                </span>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 flex flex-col">
                <span className="text-xs uppercase tracking-wide text-slate-400">
                  Valor total (menor cotação)
                </span>
                <span className="mt-2 text-3xl font-semibold">
                  {stats.totalValor.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </span>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 flex flex-col">
                <span className="text-xs uppercase tracking-wide text-slate-400">
                  Meses com lançamentos
                </span>
                <span className="mt-2 text-3xl font-semibold">
                  {stats.porMes.length}
                </span>
              </div>
            </section>

            {/* Tabela simples de últimas ordens */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 mb-8">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold">
                  Amostra de ordens / pedidos
                </h2>
                <span className="text-xs text-slate-400">
                  mostrando as 20 primeiras linhas
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2 pr-4 text-left">Data</th>
                      <th className="py-2 pr-4 text-left">OC</th>
                      <th className="py-2 pr-4 text-left">Equipamento</th>
                      <th className="py-2 pr-4 text-right">Valor (R$)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.slice(0, 20).map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-slate-900/60 hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-2 pr-4">
                          {row.date}{" "}
                          <span className="text-xs text-slate-500">
                            {row.time}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {row.numero_oc || <span className="text-slate-500">—</span>}
                        </td>
                        <td className="py-2 pr-4">
                          {row.codigo_equipamento || (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          {row.valor_menor != null ? (
                            row.valor_menor.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Resumo por mês (sem gráfico ainda, só texto) */}
            <section className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-4 mb-8">
              <h2 className="text-base font-semibold mb-3">
                Soma de valor por mês (Amostra)
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {stats.porMes.map((m) => (
                  <div
                    key={m.mes_ano}
                    className="flex flex-col rounded-xl bg-slate-950/40 border border-slate-800 px-3 py-3"
                  >
                    <span className="text-xs uppercase text-slate-400">
                      {m.mes_ano}
                    </span>
                    <span className="mt-1 text-lg font-semibold">
                      {m.valor.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
