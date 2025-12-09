// FILE: app/page.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type OrderRow = {
  id: number;
  date: string; // "DD/MM/AAAA"
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
        .select(
          "id, date, time, mes_ano, numero_oc, codigo_equipamento, valor_menor"
        )
        .limit(10000);

      if (error) {
        console.error("Erro ao buscar dados:", error);
        setError(error.message);
        setLoading(false);
        return;
      }

      const rows = (data || []) as OrderRow[];
      setOrders(rows);

      const totalRegistros = rows.length;
      const totalValor = rows.reduce(
        (sum, row) => sum + (row.valor_menor || 0),
        0
      );

      const mapaMes: Record<string, number> = {};
      rows.forEach((row) => {
        const mes = row.mes_ano || "sem_mes";
        const val = row.valor_menor || 0;
        if (!mapaMes[mes]) mapaMes[mes] = 0;
        mapaMes[mes] += val;
      });

      const porMes = Object.entries(mapaMes)
        .filter(([mes]) => mes !== "sem_mes")
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
    <main className="page-root">
      <div className="page-container">
        {/* CABEÇALHO */}
        <header className="page-header">
          <div className="brand">
            {/* Coloque o arquivo da logo em /public/gpasfalto-logo.svg ou .png */}
            <img
              src="/gpasfalto-logo.svg"
              alt="GP Asfalto"
              className="brand-logo"
            />
            <div>
              <div className="brand-text-main">GP Asfalto</div>
              <div className="brand-text-sub">
                Dashboard de Manutenção · Ano-base 2025
              </div>
            </div>
          </div>

          <div className="header-right">
            <div className="header-pill">
              <span style={{ width: 6, height: 6, borderRadius: 9999, background: "#22c55e" }} />
              <span>Conectado ao Supabase</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <span>Fonte de dados: </span>
              <code>orders_2025_raw</code>
            </div>
          </div>
        </header>

        {/* FILTROS – por enquanto apenas UI, sem funcionalidade */}
        <section className="filter-bar">
          <span className="filter-label">Filtros rápidos</span>
          <div className="filter-group">
            <div className="filter-chip">Mês: todos</div>
            <div className="filter-chip">Equipamento: todos</div>
            <div className="filter-chip">Tipo: OC + Pedidos</div>
          </div>
        </section>

        {/* ESTADOS DE CARREGAMENTO / ERRO */}
        {loading && (
          <div className="state-card">
            Carregando dados do Supabase…
          </div>
        )}

        {error && !loading && (
          <div className="state-card">
            <strong>Erro ao carregar dados:</strong> {error}
          </div>
        )}

        {/* CONTEÚDO PRINCIPAL */}
        {!loading && !error && stats && (
          <>
            {/* CARDS RESUMO */}
            <section className="summary-grid">
              <div className="summary-card">
                <div className="summary-label">Registros (OC + Pedidos)</div>
                <div className="summary-value">
                  {stats.totalRegistros.toLocaleString("pt-BR")}
                </div>
                <div className="summary-subvalue">
                  Contagem de linhas na tabela bruta.
                </div>
              </div>

              <div className="summary-card">
                <div className="summary-label">
                  Valor total (menor cotação)
                </div>
                <div className="summary-value">
                  {stats.totalValor.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </div>
                <div className="summary-subvalue">
                  Soma de <code>valor_menor</code> para 2025.
                </div>
              </div>

              <div className="summary-card">
                <div className="summary-label">Meses com lançamentos</div>
                <div className="summary-value">{stats.porMes.length}</div>
                <div className="summary-subvalue">
                  Em breve: custo/hora GP × GOINFRA por mês.
                </div>
              </div>
            </section>

            {/* SEÇÃO TABELA DE AMOSTRA */}
            <section className="section-card">
              <div className="section-header">
                <div>
                  <div className="section-title">
                    Amostra de ordens / pedidos
                  </div>
                  <div className="section-subtitle">
                    Mostrando as 20 primeiras linhas (ordem cronológica).
                  </div>
                </div>
                <div className="section-subtitle">
                  Total de registros:{" "}
                  {stats.totalRegistros.toLocaleString("pt-BR")}
                </div>
              </div>

              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>OC</th>
                      <th>Equipamento</th>
                      <th>Valor (R$)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.slice(0, 20).map((row) => (
                      <tr key={row.id}>
                        <td>
                          {row.date}{" "}
                          <span style={{ color: "#6b7280", fontSize: "0.7rem" }}>
                            {row.time}
                          </span>
                        </td>
                        <td>
                          {row.numero_oc || (
                            <span style={{ color: "#6b7280" }}>—</span>
                          )}
                        </td>
                        <td>
                          {row.codigo_equipamento || (
                            <span style={{ color: "#6b7280" }}>—</span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {row.valor_menor != null ? (
                            row.valor_menor.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })
                          ) : (
                            <span style={{ color: "#6b7280" }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* SEÇÃO GRÁFICO SIMPLES POR MÊS */}
            <section className="section-card">
              <div className="section-header">
                <div>
                  <div className="section-title">
                    Soma de valor por mês (amostra)
                  </div>
                  <div className="section-subtitle">
                    Base para o comparativo GP Asfalto × GOINFRA.
                  </div>
                </div>
              </div>

              <div className="chart-container">
                {stats.porMes.length === 0 ? (
                  <div className="section-subtitle">
                    Sem lançamentos mensais na base atual.
                  </div>
                ) : (
                  <>
                    <div className="chart-bars">
                      {(() => {
                        const maxValor = stats.porMes.reduce(
                          (max, m) => Math.max(max, m.valor),
                          0
                        );
                        return stats.porMes.map((m) => {
                          const ratio = maxValor
                            ? Math.max(m.valor / maxValor, 0.05)
                            : 0.05;
                          return (
                            <div
                              key={m.mes_ano}
                              className="chart-bar"
                              style={{ height: `${ratio * 100}%` }}
                            >
                              <div className="chart-bar-inner" />
                              <div className="chart-bar-value">
                                {m.valor.toLocaleString("pt-BR", {
                                  style: "currency",
                                  currency: "BRL",
                                  maximumFractionDigits: 0,
                                })}
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      {stats.porMes.map((m) => (
                        <div key={m.mes_ano} className="chart-bar-label">
                          {m.mes_ano}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
