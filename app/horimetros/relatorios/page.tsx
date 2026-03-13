// FILE: app/relatorios/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { supabase } from "@/lib/supabaseClient";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
);

// ─── Types ────────────────────────────────────────────────────────────────────

type ObraRow    = { id: number; obra: string };
type EquipRow   = { id: number; codigo: string };
type LeituraRow = {
  id: number;
  data: string;
  obra_id: number | null;
  equipamento_id: number;
  horas_trabalhadas: number | null;
  horimetro_inicial: number | null;
  horimetro_final: number | null;
  odometro_inicial: number | null;
  odometro_final: number | null;
  km_rodados: number | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(n: number) { return String(n).padStart(2, "0"); }

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoShift(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoToBr(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function datesInRange(start: string, end: string): string[] {
  const dates: string[] = [];
  let cur = start;
  while (cur <= end) {
    dates.push(cur);
    cur = isoShift(cur, 1);
  }
  return dates;
}

function fmt1(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RelatoriosPage() {
  const today = isoToday();

  const [startDate, setStartDate] = useState(() => isoShift(today, -6));
  const [endDate, setEndDate]     = useState(today);
  const [filterObra, setFilterObra]   = useState("__all__");
  const [filterEquip, setFilterEquip] = useState("__all__");
  const [viewMode, setViewMode]       = useState<"horas" | "km">("horas");
  const [loading, setLoading] = useState(true);

  const [obras, setObras]       = useState<ObraRow[]>([]);
  const [equips, setEquips]     = useState<EquipRow[]>([]);
  const [leituras, setLeituras] = useState<LeituraRow[]>([]);

  // ─── Load ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    const [obrasRes, equipsRes, leiturasRes] = await Promise.all([
      supabase.from("obras").select("id,obra").eq("ativo", true).order("obra").limit(500),
      supabase.from("horimetro_equipamentos").select("id,codigo").eq("ativo", true).order("codigo").limit(500),
      supabase
        .from("horimetro_leituras_diarias")
        .select("id,data,obra_id,equipamento_id,horas_trabalhadas,horimetro_inicial,horimetro_final,odometro_inicial,odometro_final,km_rodados")
        .gte("data", startDate)
        .lte("data", endDate)
        .order("data")
        .limit(5000),
    ]);
    setObras((obrasRes.data ?? []) as ObraRow[]);
    setEquips((equipsRes.data ?? []) as EquipRow[]);
    setLeituras((leiturasRes.data ?? []) as LeituraRow[]);
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => { void load(); }, [load]);

  // ─── Derived data ─────────────────────────────────────────────────────────

  const obraMap  = useMemo(() => new Map(obras.map(o => [o.id, o.obra])), [obras]);
  const equipMap = useMemo(() => new Map(equips.map(e => [e.id, e.codigo])), [equips]);
  const dates    = useMemo(() => datesInRange(startDate, endDate), [startDate, endDate]);

  // Leituras filtradas por obra e equipamento
  const filtered = useMemo(() => leituras.filter(l => {
    if (filterObra  !== "__all__" && String(l.obra_id) !== filterObra)   return false;
    if (filterEquip !== "__all__" && String(l.equipamento_id) !== filterEquip) return false;
    return true;
  }), [leituras, filterObra, filterEquip]);

  // Cards por obra
  const obraCards = useMemo(() => {
    const map = new Map<number, { obra: string; horas: number; km: number; equips: Set<number> }>();
    for (const l of filtered) {
      const obraId = l.obra_id ?? -1;
      const nome   = obraMap.get(obraId) ?? "Sem obra";
      if (!map.has(obraId)) map.set(obraId, { obra: nome, horas: 0, km: 0, equips: new Set() });
      const c = map.get(obraId)!;
      c.horas += l.horas_trabalhadas ?? 0;
      c.km    += l.km_rodados ?? 0;
      c.equips.add(l.equipamento_id);
    }
    return Array.from(map.values()).sort((a, b) => b.horas + b.km - a.horas - a.km);
  }, [filtered, obraMap]);

  // Totais gerais
  const totals = useMemo(() => ({
    horas:  filtered.reduce((s, l) => s + (l.horas_trabalhadas ?? 0), 0),
    km:     filtered.reduce((s, l) => s + (l.km_rodados      ?? 0), 0),
    equips: new Set(filtered.map(l => l.equipamento_id)).size,
    obras:  new Set(filtered.map(l => l.obra_id)).size,
  }), [filtered]);

  // Pivot: equipamento → data → valor
  const pivot = useMemo(() => {
    type Cell = { horas: number | null; km: number | null; obraId: number | null };
    const map = new Map<number, Map<string, Cell>>();

    for (const l of filtered) {
      if (!map.has(l.equipamento_id)) map.set(l.equipamento_id, new Map());
      const existing = map.get(l.equipamento_id)!.get(l.data);
      if (existing) {
        existing.horas = (existing.horas ?? 0) + (l.horas_trabalhadas ?? 0);
        existing.km    = (existing.km    ?? 0) + (l.km_rodados      ?? 0);
      } else {
        map.get(l.equipamento_id)!.set(l.data, {
          horas: l.horas_trabalhadas,
          km:    l.km_rodados,
          obraId: l.obra_id,
        });
      }
    }

    // Equipamentos que têm pelo menos 1 leitura no período filtrado
    const activeEquipIds = Array.from(map.keys());
    const rows = activeEquipIds
      .map(eid => ({
        equipId: eid,
        codigo:  equipMap.get(eid) ?? String(eid),
        byDate:  map.get(eid)!,
        total:   Array.from(map.get(eid)!.values()).reduce(
          (s, c) => s + (viewMode === "horas" ? (c.horas ?? 0) : (c.km ?? 0)), 0
        ),
      }))
      .sort((a, b) => b.total - a.total);

    return rows;
  }, [filtered, equipMap, viewMode]);

  // ─── Charts ───────────────────────────────────────────────────────────────

  // Barras: total por equipamento (top 15)
  const barChartData = useMemo(() => {
    const top = pivot.slice(0, 15);
    return {
      labels: top.map(r => r.codigo),
      datasets: [{
        label: viewMode === "horas" ? "Horas trabalhadas" : "Km rodados",
        data: top.map(r => r.total),
        backgroundColor: top.map(r =>
          r.total > 0 ? "rgba(255,75,43,0.85)" : "rgba(156,163,175,0.5)"
        ),
        borderRadius: 8,
        maxBarThickness: 36,
      }],
    };
  }, [pivot, viewMode]);

  const barChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false as const,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: any) =>
            `${ctx.dataset.label}: ${fmt1(ctx.parsed.y)}${viewMode === "horas" ? " h" : " km"}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      y: {
        beginAtZero: true,
        grid: { color: "#f3f4f6" },
        ticks: {
          font: { size: 11 },
          callback: (v: any) => `${Number(v).toLocaleString("pt-BR")}${viewMode === "horas" ? "h" : "km"}`,
        },
      },
    },
  }), [viewMode]);

  // Linha: total por dia
  const lineChartData = useMemo(() => {
    const byDay = dates.map(d =>
      filtered
        .filter(l => l.data === d)
        .reduce((s, l) => s + (viewMode === "horas" ? (l.horas_trabalhadas ?? 0) : (l.km_rodados ?? 0)), 0)
    );
    return {
      labels: dates.map(d => isoToBr(d)),
      datasets: [{
        label: viewMode === "horas" ? "Horas totais/dia" : "Km totais/dia",
        data: byDay,
        borderColor: "#ff4b2b",
        backgroundColor: "rgba(255,75,43,0.08)",
        borderWidth: 2.5,
        tension: 0.35,
        fill: true,
        pointRadius: dates.length <= 14 ? 4 : 2,
        pointBackgroundColor: "#ff4b2b",
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
      }],
    };
  }, [dates, filtered, viewMode]);

  const lineChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false as const,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: any) =>
            `${ctx.dataset.label}: ${fmt1(ctx.parsed.y)}${viewMode === "horas" ? " h" : " km"}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 }, maxTicksLimit: 14 } },
      y: {
        beginAtZero: true,
        grid: { color: "#f3f4f6" },
        ticks: {
          font: { size: 11 },
          callback: (v: any) => `${Number(v).toLocaleString("pt-BR")}${viewMode === "horas" ? "h" : "km"}`,
        },
      },
    },
  }), [viewMode]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const unit = viewMode === "horas" ? "h" : " km";

  return (
    <div className="page-root">
      <style>{`
        .rel-nav-btn {
          display:inline-flex;align-items:center;justify-content:center;
          width:30px;height:30px;border-radius:8px;border:1px solid #e5e7eb;
          background:#fff;cursor:pointer;font-size:14px;color:var(--gp-muted);
          box-shadow:0 2px 6px rgba(15,23,42,.05);transition:.15s;
        }
        .rel-nav-btn:hover{background:var(--gp-accent-soft);border-color:rgba(255,75,43,.3);color:var(--gp-accent);}
        .rel-seg{display:inline-flex;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden;background:#f9fafb;}
        .rel-seg button{padding:5px 14px;border:none;background:transparent;font-size:.8rem;font-weight:600;color:var(--gp-muted);cursor:pointer;}
        .rel-seg button.active{background:var(--gp-accent);color:#fff;}
        .obra-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;}
        .obra-card{background:#fff;border-radius:14px;border:1px solid #e5e7eb;padding:14px 16px;box-shadow:0 4px 12px rgba(15,23,42,.04);}
        .obra-card-name{font-size:.75rem;font-weight:700;color:var(--gp-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .obra-card-val{font-size:1.5rem;font-weight:700;letter-spacing:-.02em;color:var(--gp-text);}
        .obra-card-sub{font-size:.72rem;color:var(--gp-muted-soft);margin-top:2px;}
        .pivot-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}
        .pivot-table{border-collapse:collapse;font-size:.78rem;min-width:100%;}
        .pivot-table th{padding:6px 10px;text-align:right;color:var(--gp-muted);border-bottom:2px solid #e5e7eb;white-space:nowrap;font-weight:600;}
        .pivot-table th.sticky{position:sticky;left:0;background:#fff;text-align:left;z-index:2;}
        .pivot-table td{padding:5px 10px;text-align:right;border-bottom:1px solid #f3f4f6;white-space:nowrap;}
        .pivot-table td.sticky{position:sticky;left:0;background:#fff;font-weight:700;text-align:left;z-index:1;}
        .pivot-table tbody tr:hover td{background:#fafafa;}
        .pivot-table tbody tr:hover td.sticky{background:#fafafa;}
        .pivot-cell-hot{color:var(--gp-accent);font-weight:700;}
        .pivot-cell-zero{color:#d1d5db;}
        .pivot-total-row td{font-weight:700;border-top:2px solid #e5e7eb;background:#f9fafb!important;color:var(--gp-text);}
        .pivot-total-col{font-weight:700;color:var(--gp-text);border-left:1px solid #e5e7eb;}
        .summary-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
        @media(max-width:700px){.summary-grid-4{grid-template-columns:repeat(2,1fr);}.obra-grid{grid-template-columns:1fr 1fr;}}
      `}</style>

      <div className="page-container">

        {/* ── Header ── */}
        <header className="page-header">
          <div className="brand">
            <img src="/gpasfalto-logo.png" alt="GP Asfalto" className="brand-logo" />
            <div>
              <div className="brand-text-main">Relatório de Horímetros</div>
              <div className="brand-text-sub">Horas trabalhadas e km rodados por equipamento e obra</div>
            </div>
          </div>
          <a href="/" style={{ fontSize: ".8rem", color: "var(--gp-muted)", textDecoration: "none" }}>
            ← Início
          </a>
        </header>

        {/* ── Filtros ── */}
        <section className="section-card">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>

            {/* Período */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button className="rel-nav-btn" title="Recuar 7 dias"
                onClick={() => { setStartDate(d => isoShift(d, -7)); setEndDate(d => isoShift(d, -7)); }}>
                ‹‹
              </button>
              <button className="rel-nav-btn" title="Recuar 1 dia"
                onClick={() => { setStartDate(d => isoShift(d, -1)); setEndDate(d => isoShift(d, -1)); }}>
                ‹
              </button>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="date" className="gp-input" value={startDate}
                  onChange={e => { if (e.target.value <= endDate) setStartDate(e.target.value); }} />
                <span style={{ color: "var(--gp-muted-soft)", fontSize: ".8rem" }}>até</span>
                <input type="date" className="gp-input" value={endDate}
                  onChange={e => { if (e.target.value >= startDate) setEndDate(e.target.value); }} />
              </div>
              <button className="rel-nav-btn" title="Avançar 1 dia"
                onClick={() => { setStartDate(d => isoShift(d, 1)); setEndDate(d => isoShift(d, 1)); }}>
                ›
              </button>
              <button className="rel-nav-btn" title="Avançar 7 dias"
                onClick={() => { setStartDate(d => isoShift(d, 7)); setEndDate(d => isoShift(d, 7)); }}>
                ››
              </button>
            </div>

            {/* Atalhos rápidos */}
            <div style={{ display: "flex", gap: 4 }}>
              {[
                { label: "Hoje",     days: 0 },
                { label: "7d",       days: 6 },
                { label: "30d",      days: 29 },
              ].map(({ label, days }) => (
                <button key={label} className="gp-btn gp-btn-ghost"
                  style={{ fontSize: ".75rem", padding: "4px 10px", height: 28 }}
                  onClick={() => { setEndDate(today); setStartDate(isoShift(today, -days)); }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Obra */}
            <select className="gp-select" value={filterObra} onChange={e => setFilterObra(e.target.value)}>
              <option value="__all__">Todas as obras</option>
              {obras.map(o => <option key={o.id} value={String(o.id)}>{o.obra}</option>)}
            </select>

            {/* Equipamento */}
            <select className="gp-select" value={filterEquip} onChange={e => setFilterEquip(e.target.value)}>
              <option value="__all__">Todos os equips.</option>
              {equips.map(e => <option key={e.id} value={String(e.id)}>{e.codigo}</option>)}
            </select>

            {/* Toggle HOR / KM */}
            <div className="rel-seg">
              <button className={viewMode === "horas" ? "active" : ""} onClick={() => setViewMode("horas")}>HOR</button>
              <button className={viewMode === "km"    ? "active" : ""} onClick={() => setViewMode("km")}>ODO</button>
            </div>

            {loading && (
              <span style={{ fontSize: ".78rem", color: "var(--gp-muted-soft)" }}>Carregando…</span>
            )}
          </div>
        </section>

        {/* ── Cards totais ── */}
        <div className="summary-grid-4">
          {[
            { label: "Total de horas",      value: fmt1(totals.horas) + " h",  sub: "no período filtrado" },
            { label: "Total de km",          value: fmt1(totals.km)   + " km", sub: "no período filtrado" },
            { label: "Equipamentos",         value: String(totals.equips),      sub: "com leituras" },
            { label: "Obras",                value: String(totals.obras),       sub: "envolvidas" },
          ].map(c => (
            <div key={c.label} className="summary-card">
              <div className="summary-label">{c.label}</div>
              <div className="summary-value" style={{ fontSize: "1.5rem" }}>{c.value}</div>
              <div className="summary-subvalue">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Cards por obra ── */}
        {obraCards.length > 0 && (
          <section className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">Resumo por obra</div>
                <div className="section-subtitle">Total acumulado no período filtrado</div>
              </div>
            </div>
            <div className="obra-grid">
              {obraCards.map(o => (
                <div key={o.obra} className="obra-card">
                  <div className="obra-card-name">{o.obra}</div>
                  <div className="obra-card-val">{fmt1(o.horas)}<span style={{ fontSize: ".9rem", fontWeight: 400, marginLeft: 3 }}>h</span></div>
                  <div className="obra-card-sub">{fmt1(o.km)} km · {o.equips.size} equip{o.equips.size !== 1 ? "s" : "."}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Gráfico linha: evolução diária ── */}
        <section className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Evolução diária — {viewMode === "horas" ? "horas trabalhadas" : "km rodados"}</div>
              <div className="section-subtitle">Total de todos os equipamentos filtrados por dia</div>
            </div>
          </div>
          {loading ? <div className="state-card">Carregando…</div> : (
            <div style={{ height: 220 }}>
              <Line data={lineChartData} options={lineChartOptions as any} />
            </div>
          )}
        </section>

        {/* ── Gráfico barras: por equipamento ── */}
        <section className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Total por equipamento — {viewMode === "horas" ? "horas trabalhadas" : "km rodados"}</div>
              <div className="section-subtitle">Top 15 equipamentos com maior volume no período</div>
            </div>
          </div>
          {loading ? <div className="state-card">Carregando…</div> :
           pivot.length === 0 ? <div className="state-card">Nenhuma leitura encontrada para os filtros aplicados.</div> : (
            <div style={{ height: 240 }}>
              <Bar data={barChartData} options={barChartOptions as any} />
            </div>
          )}
        </section>

        {/* ── Tabela pivô: equipamento × data ── */}
        <section className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Detalhamento diário — {viewMode === "horas" ? "horas (h)" : "km rodados"}</div>
              <div className="section-subtitle">
                Linhas = equipamentos · Colunas = datas · Célula = valor do dia · {pivot.length} equipamentos
              </div>
            </div>
          </div>

          {loading ? <div className="state-card">Carregando…</div> :
           pivot.length === 0 ? <div className="state-card">Nenhuma leitura encontrada para os filtros aplicados.</div> : (
            <div className="pivot-wrap">
              <table className="pivot-table">
                <thead>
                  <tr>
                    <th className="sticky">Equipamento</th>
                    {dates.map(d => (
                      <th key={d} title={isoToBr(d)}>
                        {/* Mostra dia/mês de forma compacta */}
                        {d.slice(8)}/{d.slice(5, 7)}
                      </th>
                    ))}
                    <th className="pivot-total-col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pivot.map(row => (
                    <tr key={row.equipId}>
                      <td className="sticky">{row.codigo}</td>
                      {dates.map(d => {
                        const cell = row.byDate.get(d);
                        const val  = cell ? (viewMode === "horas" ? cell.horas : cell.km) : null;
                        if (val == null || val === 0) {
                          return <td key={d} className="pivot-cell-zero">—</td>;
                        }
                        return (
                          <td key={d} className={val > 0 ? "pivot-cell-hot" : ""}>
                            {fmt1(val)}
                          </td>
                        );
                      })}
                      <td className="pivot-total-col">{fmt1(row.total)}{unit}</td>
                    </tr>
                  ))}

                  {/* Linha de totais por dia */}
                  <tr className="pivot-total-row">
                    <td className="sticky">Total</td>
                    {dates.map(d => {
                      const sum = filtered
                        .filter(l => l.data === d)
                        .reduce((s, l) => s + (viewMode === "horas" ? (l.horas_trabalhadas ?? 0) : (l.km_rodados ?? 0)), 0);
                      return <td key={d}>{sum > 0 ? fmt1(sum) : "—"}</td>;
                    })}
                    <td className="pivot-total-col">
                      {fmt1(filtered.reduce((s, l) => s + (viewMode === "horas" ? (l.horas_trabalhadas ?? 0) : (l.km_rodados ?? 0)), 0))}{unit}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
