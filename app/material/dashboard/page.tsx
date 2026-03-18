// FILE: app/material/dashboard/page.tsx
"use client";

import { useEffect, useState, useCallback, type CSSProperties } from "react";
import { supabase } from "@/lib/supabaseClient";

// ─────────────────────────────────────────────
// TIPOS — inalterados
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
// NORMALIZAÇÃO CAP / OGR (front-end)
// Enquanto o UPDATE no banco não roda, consolida aqui.
// ─────────────────────────────────────────────

function normalizeMaterial(m: string): string {
  const u = (m || "").trim().toUpperCase()
    .replace(/[ÓÒÔÕ]/g, "O")
    .replace(/[ÁÀÃÂ]/g, "A")
    .replace(/[ÉÈÊ]/g, "E")
    .replace(/[ÍÌÎ]/g, "I")
    .replace(/[ÚÙÛ]/g, "U");
  if (u.startsWith("CAP"))                          return "CAP";
  if (u.startsWith("OGR"))                          return "OGR";
  if (u.includes("PO") && u.includes("BRITA"))      return "PO BRITA";
  return m.trim();
}

function normalizeSaldos(rows: SaldoAgregado[]): SaldoAgregado[] {
  const map: Record<string, SaldoAgregado> = {};
  for (const r of rows) {
    const key = normalizeMaterial(r.material);
    if (!map[key]) {
      map[key] = { ...r, material: key };
    } else {
      map[key].entrada_t += r.entrada_t;
      map[key].consumo_t += r.consumo_t;
      map[key].ajuste_t += r.ajuste_t;
      map[key].saldo_t += r.saldo_t;
      map[key].qtd_tickets_entrada += r.qtd_tickets_entrada;
      map[key].qtd_ajustes += r.qtd_ajustes;
    }
  }
  return Object.values(map).sort((a, b) => a.material.localeCompare(b.material));
}

function normalizeTickets(rows: TicketRow[]): TicketRow[] {
  return rows.map((r) => ({ ...r, material: normalizeMaterial(r.material) }));
}

function normalizeSaldoPorData(rows: SaldoPorData[]): SaldoPorData[] {
  const map: Record<string, SaldoPorData> = {};
  for (const r of rows) {
    const key = `${r.data}__${normalizeMaterial(r.material)}`;
    if (!map[key]) {
      map[key] = { ...r, material: normalizeMaterial(r.material) };
    } else {
      map[key].movimento_t += r.movimento_t;
      map[key].saldo_acumulado_t += r.saldo_acumulado_t;
    }
  }
  return Object.values(map);
}

// ─────────────────────────────────────────────
// HELPERS — inalterados
// ─────────────────────────────────────────────

function fmtT(v: number | null | undefined, d = 3) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtN(v: number | null | undefined, d = 0) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

function isoToday() { return new Date().toISOString().slice(0, 10); }

function isoMinus(days: number) {
  const d = new Date(); d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function dateBR(iso: string) {
  const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`;
}

function pct(part: number | null, total: number | null) {
  if (!part || !total || total === 0) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}

const MAT_COLOR: Record<string, string> = {
  "PO BRITA":   "#f59e0b",
  "BRITA ZERO": "#3b82f6",
  "BRITA 01":   "#8b5cf6",
  "CAP":        "#ef4444",
  "OGR":        "#10b981",
};

function matColor(m: string) {
  const key = Object.keys(MAT_COLOR).find((k) => normalizeMaterial(m).toUpperCase().includes(k));
  return key ? MAT_COLOR[key] : "#94a3b8";
}

// ─────────────────────────────────────────────
// DESIGN TOKENS
// ─────────────────────────────────────────────

const C = {
  bg:        "#f4f5f7",
  surface:   "#ffffff",
  border:    "#e8eaed",
  borderMid: "#d1d5db",
  text:      "#1a1f36",
  textMid:   "#4b5563",
  textMute:  "#9ca3af",
  primary:   "#4361ee",
  primaryBg: "#eef1fd",
  success:   "#0d9f6e",
  successBg: "#ecfdf5",
  danger:    "#dc2626",
  dangerBg:  "#fef2f2",
  warning:   "#d97706",
  warningBg: "#fffbeb",
};

// ─────────────────────────────────────────────
// COMPONENTES
// ─────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      background: C.surface,
      borderRadius: 10,
      border: `1px solid ${C.border}`,
      boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
      ...style,
    }}>
      {children}
    </div>
  );
}

function CardHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: C.textMute, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 4, fontSize: 11, fontWeight: 600,
      background: ok ? C.successBg : C.dangerBg,
      color: ok ? C.success : C.danger,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: ok ? C.success : C.danger, flexShrink: 0 }} />
      {label ?? (ok ? "OK" : "Atenção")}
    </span>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
      background: color + "18", color,
    }}>
      {label}
    </span>
  );
}

function ProgressBar({ value, total, color }: { value: number | null; total: number | null; color: string }) {
  const p = pct(value, total);
  return (
    <div style={{ height: 5, borderRadius: 3, background: C.border, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.min(p, 100)}%`, background: p >= 100 ? C.danger : color, borderRadius: 3, transition: "width 0.5s ease" }} />
    </div>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} style={{ textAlign: "center", padding: "28px 0", color: C.textMute, fontSize: 13 }}>
        Nenhum registro no período
      </td>
    </tr>
  );
}

// Cabeçalho e célula de tabela
const TH: CSSProperties = {
  textAlign: "left", padding: "9px 14px", fontSize: 11, fontWeight: 600,
  color: C.textMute, textTransform: "uppercase", letterSpacing: "0.06em",
  borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", background: "#fafafa",
};
const THR: CSSProperties = { ...TH, textAlign: "right" };
const TD: CSSProperties = {
  padding: "10px 14px", borderBottom: `1px solid ${C.border}`,
  color: C.textMid, verticalAlign: "middle", fontSize: 13,
};
const TDR: CSSProperties = { ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums" };

// ─────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────

export default function MaterialDashboardPage() {

  // ── Estado — inalterado ──────────────────
  const [dateStart, setDateStart]     = useState(isoMinus(30));
  const [dateEnd,   setDateEnd]       = useState(isoToday());
  const [filterObra, setFilterObra]   = useState("");
  const [filterMat,  setFilterMat]    = useState("");

  const [saldos,       setSaldos]       = useState<SaldoAgregado[]>([]);
  const [tickets,      setTickets]      = useState<TicketRow[]>([]);
  const [entradaPlans, setEntradaPlans] = useState<EntradaPlanResumo[]>([]);
  const [ocSaldos,     setOcSaldos]     = useState<OcSaldo[]>([]);
  const [saldoPorData, setSaldoPorData] = useState<SaldoPorData[]>([]);
  const [diarios,      setDiarios]      = useState<DiarioUsina[]>([]);
  const [ajustes,      setAjustes]      = useState<{id:number;data:string;material:string;quantidade_t:number;motivo:string;observacao:string|null;saldo_fisico_t:number|null}[]>([]);
  const [obras,        setObras]        = useState<string[]>([]);
  const [materiais,    setMateriais]    = useState<string[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [activeTab, setActiveTab] = useState<"estoque"|"producao"|"entradas"|"saidas"|"pedidos">("estoque");
  const [reconcOpen,   setReconcOpen]   = useState(false);

  // ── Fetch — inalterado ───────────────────
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
        { data: ajustesData },
      ] = await Promise.all([
        supabase.from("material_saldo_agregados_v").select("*"),
        supabase.from("material_tickets")
          .select("id,tipo,data,material,origem,obra,peso_t,veiculo")
          .gte("data", dateStart).lte("data", dateEnd)
          .order("data", { ascending: false }),
        supabase.from("material_entrada_resumo_por_plano_v")
          .select("plan_id,origem,obra,produto,pedido,volume_entr,saldo_rest"),
        supabase.from("material_oc_saldo_v")
          .select("plan_id,obra,oc,material,ilimitado,total_t,entrada_t,saida_t,saldo_t")
          .order("obra"),
        supabase.from("material_saldo_por_data_v")
          .select("data,material,movimento_t,saldo_acumulado_t")
          .gte("data", dateStart).lte("data", dateEnd)
          .order("data"),
        supabase.from("material_diario_usina")
          .select("data,hrm_inicial,hrm_final,ogr_litros")
          .gte("data", dateStart).lte("data", dateEnd)
          .order("data", { ascending: false }),
        supabase.from("material_ajuste_estoque")
          .select("id,data,material,quantidade_t,motivo,observacao,saldo_fisico_t")
          .order("data", { ascending: false }),
      ]);

      const tks = normalizeTickets((ticketsData as TicketRow[]) ?? []);
      setSaldos(normalizeSaldos((saldosData as SaldoAgregado[]) ?? []));
      setTickets(tks);
      setEntradaPlans((plansData as EntradaPlanResumo[]) ?? []);
      setOcSaldos((ocData as OcSaldo[]) ?? []);
      setSaldoPorData(normalizeSaldoPorData((evolData as SaldoPorData[]) ?? []));
      setDiarios((diariosData as DiarioUsina[]) ?? []);
      setAjustes((ajustesData as any[]) ?? []);
      setObras(Array.from(new Set(tks.map(t => t.obra).filter(Boolean))).sort());
      setMateriais(Array.from(new Set(tks.map(t => t.material).filter(Boolean))).sort());
    } finally { setLoading(false); }
  }, [dateStart, dateEnd]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Cálculos — inalterados ───────────────
  const tks = tickets.filter(t => {
    if (filterObra && t.obra !== filterObra) return false;
    if (filterMat  && t.material !== filterMat) return false;
    return true;
  });

  const saidas   = tks.filter(t => t.tipo === "SAIDA");
  const entradas = tks.filter(t => t.tipo === "ENTRADA");

  const producaoMap: Record<string, number> = {};
  for (const t of saidas) producaoMap[t.material] = (producaoMap[t.material] ?? 0) + Number(t.peso_t);

  const entradasMap: Record<string, { total: number; qtd: number }> = {};
  for (const t of entradas) {
    if (!entradasMap[t.material]) entradasMap[t.material] = { total: 0, qtd: 0 };
    entradasMap[t.material].total += Number(t.peso_t);
    entradasMap[t.material].qtd  += 1;
  }

  const saidasObraMap: Record<string, number> = {};
  for (const t of saidas) saidasObraMap[t.obra] = (saidasObraMap[t.obra] ?? 0) + Number(t.peso_t);

  const hrmTotal = diarios.reduce((acc, d) =>
    d.hrm_inicial != null && d.hrm_final != null ? acc + (d.hrm_final - d.hrm_inicial) : acc, 0);
  const ogrTotal = diarios.reduce((acc, d) => acc + (d.ogr_litros ?? 0), 0);
  const totalProducaoT = Object.values(producaoMap).reduce((a, b) => a + b, 0);
  const materiaisGrafico = Array.from(new Set(saldoPorData.map(s => s.material)));

  // ── Estilos inline ───────────────────────
  const inp: CSSProperties = {
    height: 34, border: `1px solid ${C.border}`, borderRadius: 6,
    padding: "0 10px", fontSize: 13, color: C.text, background: C.surface,
    outline: "none", fontFamily: "inherit",
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: C.textMute, fontSize: 13 }}>Carregando…</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>

      {/* ── TOPBAR ─────────────────────────── */}
      <header style={{
        height: 56, background: C.surface, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 28px", position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 1px 0 rgba(0,0,0,0.05)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/gpasfalto-logo.png" alt="GP Asfalto" style={{ height: 44, width: "auto", objectFit: "contain" }} />
        </div>
        <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Materiais</span>
          <span style={{ fontSize: 13, color: C.textMute }}>/ Controle de Estoque</span>
        </div>
        <button onClick={fetchAll} style={{
          height: 32, padding: "0 14px", border: `1px solid ${C.border}`,
          borderRadius: 6, background: C.surface, fontSize: 12, fontWeight: 500,
          color: C.textMid, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" strokeLinecap="round"/>
            <path d="M10.5 1.5v3h-3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Atualizar
        </button>
      </header>

      <div style={{ maxWidth: 1320, margin: "0 auto", padding: "24px 20px" }}>

        {/* ── FILTROS ──────────────────────── */}
        <Card style={{ marginBottom: 20 }}>
          <div style={{ padding: "10px 18px 10px", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 6, flexWrap: "wrap" as const }}>
            {([
              ["Hoje",      isoToday(),    isoToday()],
              ["7 dias",    isoMinus(7),   isoToday()],
              ["15 dias",   isoMinus(15),  isoToday()],
              ["Mês atual", (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`; })(),  isoToday()],
              ["Mês ant.",  (() => { const d = new Date(); d.setMonth(d.getMonth()-1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`; })(),
                            (() => { const d = new Date(); d.setDate(0); return d.toISOString().slice(0,10); })()],
              ["2026",      "2026-01-01",  isoToday()],
            ] as [string, string, string][]).map(([label, s, e]) => {
              const active = dateStart === s && dateEnd === e;
              return (
                <button key={label} onClick={() => { setDateStart(s); setDateEnd(e); }} style={{
                  height: 28, padding: "0 12px", border: `1px solid ${active ? C.primary : C.border}`,
                  borderRadius: 5, fontSize: 12, fontWeight: active ? 600 : 400,
                  background: active ? C.primaryBg : C.surface,
                  color: active ? C.primary : C.textMid,
                  cursor: "pointer", transition: "all 0.1s",
                }}>
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ padding: "10px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" as const }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.textMute, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>Período</span>
            <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)} style={inp} />
            <span style={{ fontSize: 12, color: C.textMute }}>até</span>
            <input type="date" value={dateEnd}   onChange={e => setDateEnd(e.target.value)}   style={inp} />
            <div style={{ width: 1, height: 20, background: C.border, margin: "0 4px" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: C.textMute, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>Obra</span>
            <select value={filterObra} onChange={e => setFilterObra(e.target.value)} style={{ ...inp, paddingRight: 28 }}>
              <option value="">Todas</option>
              {obras.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <span style={{ fontSize: 11, fontWeight: 600, color: C.textMute, textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>Material</span>
            <select value={filterMat} onChange={e => setFilterMat(e.target.value)} style={{ ...inp, paddingRight: 28 }}>
              <option value="">Todos</option>
              {materiais.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <button onClick={() => { setFilterObra(""); setFilterMat(""); setDateStart(isoMinus(30)); setDateEnd(isoToday()); }}
              style={{ marginLeft: "auto", height: 32, padding: "0 14px", border: `1px solid ${C.border}`, borderRadius: 6, background: C.surface, fontSize: 12, color: C.textMid, cursor: "pointer" }}>
              Limpar filtros
            </button>
          </div>
        </Card>

        {/* ── KPI CARDS ────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
          {[
            {
              label: "Produção",
              value: fmtN(totalProducaoT, 1),
              unit: "toneladas",
              sub: `${Object.keys(producaoMap).length} produto(s) · ${saidas.length} tickets`,
              icon: "📦", accent: C.primary,
            },
            {
              label: "Entradas de agregados",
              value: fmtN(entradas.reduce((a, t) => a + Number(t.peso_t), 0), 1),
              unit: "toneladas",
              sub: `${entradas.length} tickets no período`,
              icon: "📥", accent: "#0d9f6e",
            },
            {
              label: "Horímetro",
              value: fmtN(hrmTotal, 1),
              unit: "HRM",
              sub: `${diarios.length} dias registrados · OGR ${fmtN(ogrTotal, 0)} L`,
              icon: "⏱", accent: "#7c3aed",
            },
            {
              label: "Ton / hora",
              value: hrmTotal > 0 ? fmtN(totalProducaoT / hrmTotal, 1) : "—",
              unit: "média",
              sub: totalProducaoT > 0 && ogrTotal > 0 ? `${fmtN(ogrTotal / totalProducaoT, 2)} L/ton OGR` : "Sem dados HRM",
              icon: "⚡", accent: "#d97706",
            },
          ].map(k => (
            <Card key={k.label} style={{ padding: "18px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 12, color: C.textMute, marginBottom: 6, fontWeight: 500 }}>{k.label}</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: C.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: C.textMute, marginTop: 3 }}>{k.unit}</div>
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: k.accent + "15", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                  {k.icon}
                </div>
              </div>
              <div style={{ fontSize: 11, color: C.textMute, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>{k.sub}</div>
            </Card>
          ))}
        </div>

        {/* ── TABS ─────────────────────────── */}
        <div style={{ display: "flex", gap: 2, marginBottom: 18, borderBottom: `1px solid ${C.border}` }}>
          {([
            ["estoque",  "Saldo Estoque"],
            ["producao", "Produção"],
            ["entradas", "Entradas"],
            ["saidas",   "Saídas / Obras"],
            ["pedidos",  "Pedidos / OC"],
          ] as const).map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)} style={{
              padding: "10px 18px", border: "none", background: "none",
              fontSize: 13, fontWeight: activeTab === key ? 600 : 400,
              color: activeTab === key ? C.primary : C.textMid,
              cursor: "pointer",
              borderBottom: activeTab === key ? `2px solid ${C.primary}` : "2px solid transparent",
              marginBottom: -1, transition: "all 0.15s",
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════
            TAB: SALDO ESTOQUE
        ══════════════════════════════════════ */}
        {activeTab === "estoque" && (
          <div>
            {/* Cards de saldo */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, marginBottom: 20 }}>
              {saldos.map(s_ => {
                const cor = matColor(s_.material);
                const alerta = s_.saldo_t < 50;
                // cobertura em dias baseada no consumo médio diário (todos os dados disponíveis)
                const linhas = saldoPorData.filter(s => s.material === s_.material && s.movimento_t < 0);
                const diasComConsumo = linhas.length;
                const consumoDiario = diasComConsumo > 0
                  ? linhas.reduce((acc, l) => acc + Math.abs(l.movimento_t), 0) / diasComConsumo
                  : 0;
                const diasCobertura = consumoDiario > 0 ? Math.round(s_.saldo_t / consumoDiario) : null;
                return (
                  <Card key={s_.material} style={{ padding: "16px 18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.textMute, textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>
                        {s_.material}
                      </span>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: alerta ? C.danger : C.success, display: "inline-block" }} />
                    </div>
                    <div style={{ fontSize: 30, fontWeight: 700, color: alerta ? C.danger : C.text, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                      {fmtN(s_.saldo_t, 1)}
                    </div>
                    <div style={{ fontSize: 11, color: C.textMute, marginTop: 2 }}>toneladas em estoque</div>
                    {diasCobertura != null && (
                      <div style={{ fontSize: 11, color: diasCobertura < 7 ? C.danger : diasCobertura < 15 ? C.warning : C.textMute, marginTop: 4, fontWeight: 600 }}>
                        ~{diasCobertura} dias de cobertura
                      </div>
                    )}
                    {alerta && (
                      <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: C.warning, display: "flex", alignItems: "center", gap: 4 }}>
                        ⚠ Estoque baixo
                      </div>
                    )}
                  </Card>
                );
              })}
              {saldos.length === 0 && (
                <Card style={{ gridColumn: "1/-1", padding: 32, textAlign: "center" }}>
                  <div style={{ color: C.textMute, fontSize: 13 }}>Nenhum saldo. Verifique os ajustes iniciais.</div>
                </Card>
              )}
            </div>

            {/* Gráfico de evolução — curva do saldo acumulado */}
            <Card style={{ marginBottom: 16 }}>
              <CardHeader title="Evolução do saldo" sub="Curva de estoque por material — período selecionado" />
              <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 20 }}>
                {materiaisGrafico.length === 0 ? (
                  <div style={{ color: C.textMute, fontSize: 13, textAlign: "center", padding: "16px 0" }}>Sem dados de evolução</div>
                ) : materiaisGrafico.filter(m => ["PO BRITA","BRITA ZERO","BRITA 01","CAP"].includes(m)).map(mat => {
                  const linhas = saldoPorData.filter(s => s.material === mat).sort((a,b) => a.data.localeCompare(b.data));
                  if (linhas.length < 2) return null;
                  const vals = linhas.map(l => l.saldo_acumulado_t);
                  const minVal = Math.min(...vals);
                  const maxVal = Math.max(...vals);
                  const range = Math.max(1, maxVal - minVal);
                  const H = 64, W = 100;
                  const cor = matColor(mat);
                  const ultimo = vals[vals.length - 1];
                  // gera path SVG da linha
                  const pts = linhas.map((l, i) => {
                    const x = (i / (linhas.length - 1)) * W;
                    const y = H - ((l.saldo_acumulado_t - minVal) / range) * H;
                    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
                  }).join(" ");
                  // área abaixo
                  const areaPath = pts + ` L${W},${H} L0,${H} Z`;
                  return (
                    <div key={mat}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: C.textMid }}>{mat}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: cor, fontVariantNumeric: "tabular-nums" }}>{fmtN(ultimo, 1)} t</span>
                      </div>
                      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 64, display: "block", overflow: "visible" }}
                        preserveAspectRatio="none">
                        <path d={areaPath} fill={cor} fillOpacity="0.1" stroke="none" />
                        <path d={pts} fill="none" stroke={cor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                      </svg>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.textMute, marginTop: 2 }}>
                        <span>{dateBR(linhas[0].data)}</span>
                        <span>{dateBR(linhas[linhas.length - 1].data)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Reconciliação — colapsável */}
            <Card>
              <button onClick={() => setReconcOpen(o => !o)} style={{
                width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "16px 20px", background: "none", border: "none", cursor: "pointer",
                borderBottom: reconcOpen ? `1px solid ${C.border}` : "none",
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text, textAlign: "left" }}>Reconciliação de estoque</div>
                  <div style={{ fontSize: 12, color: C.textMute, marginTop: 2, textAlign: "left" }}>
                    Saldo inicial (06/01) → entradas → consumo traço → inventário físico (16/03)
                  </div>
                </div>
                <span style={{ fontSize: 18, color: C.textMute, transform: reconcOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                  ⌄
                </span>
              </button>
              {reconcOpen && (
                <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={TH}>Material</th>
                      <th style={THR}>Inv. 06/01</th>
                      <th style={THR}>+ Entradas</th>
                      <th style={THR}>− Consumo traço</th>
                      <th style={{ ...THR, borderLeft: `2px solid ${C.border}` }}>= Calculado</th>
                      <th style={THR}>Inv. físico</th>
                      <th style={THR}>Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saldos.map(s_ => {
                      const saldoInicialAjuste = ajustes.find(a => a.motivo === 'SALDO INICIAL' && normalizeMaterial(a.material) === s_.material);
                      const ajusteInv = ajustes.find(a => a.motivo === 'AJUSTE INVENTARIO' && normalizeMaterial(a.material) === s_.material);
                      const saldoInicial = saldoInicialAjuste?.quantidade_t ?? 0;
                      const calculado = saldoInicial + s_.entrada_t - s_.consumo_t;
                      const diferenca = ajusteInv?.quantidade_t ?? null;
                      const inventarioFisico = ajusteInv?.saldo_fisico_t ?? null;
                      return (
                        <tr key={s_.material}>
                          <td style={TD}><Tag label={s_.material} color={matColor(s_.material)} /></td>
                          <td style={TDR}>{fmtN(saldoInicial, 1)}</td>
                          <td style={{ ...TDR, color: C.success }}>+{fmtN(s_.entrada_t, 1)}</td>
                          <td style={{ ...TDR, color: C.danger }}>−{fmtN(s_.consumo_t, 1)}</td>
                          <td style={{ ...TDR, fontWeight: 700, color: C.text, borderLeft: `2px solid ${C.border}` }}>
                            {fmtN(calculado, 1)}
                          </td>
                          <td style={{ ...TDR, fontWeight: 700, color: inventarioFisico != null ? C.primary : C.textMute }}>
                            {inventarioFisico != null ? fmtN(inventarioFisico, 1) : "—"}
                          </td>
                          <td style={{ ...TDR, fontWeight: 700, color: diferenca == null ? C.textMute : diferenca >= 0 ? C.success : C.danger }}>
                            {diferenca != null ? `${diferenca >= 0 ? "+" : ""}${fmtN(diferenca, 1)}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={7} style={{ padding: "10px 14px", fontSize: 11, color: C.textMute, borderTop: `1px solid ${C.border}` }}>
                        Positivo = sobra física (traço superestimou consumo ou entradas não lançadas). Negativo = falta física (traço subestimou ou perdas não registradas).
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: PRODUÇÃO
        ══════════════════════════════════════ */}
        {activeTab === "producao" && (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>

            <Card style={{ gridColumn: "1/-1" }}>
              <CardHeader title="Produção por produto usinado" sub={`${dateStart ? dateBR(dateStart) : ""} — ${dateEnd ? dateBR(dateEnd) : ""}`} />
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={TH}>Produto</th>
                    <th style={THR}>Tickets</th>
                    <th style={THR}>Total (ton)</th>
                    <th style={THR}>% do total</th>
                    <th style={{ ...TH, width: 140 }}>Participação</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(producaoMap).length === 0 ? <EmptyRow cols={5} /> :
                    Object.entries(producaoMap).sort((a, b) => b[1] - a[1]).map(([mat, ton]) => {
                      const qtd = saidas.filter(t => t.material === mat).length;
                      const p   = totalProducaoT > 0 ? (ton / totalProducaoT) * 100 : 0;
                      const cor = matColor(mat);
                      return (
                        <tr key={mat} style={{ background: "white" }}>
                          <td style={TD}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div style={{ width: 10, height: 10, borderRadius: 2, background: cor, flexShrink: 0 }} />
                              <span style={{ fontWeight: 500, color: C.text }}>{mat}</span>
                            </div>
                          </td>
                          <td style={TDR}>{qtd}</td>
                          <td style={{ ...TDR, fontWeight: 600, color: C.text }}>{fmtT(ton, 1)}</td>
                          <td style={TDR}>{p.toFixed(1)}%</td>
                          <td style={TD}>
                            <ProgressBar value={ton} total={totalProducaoT} color={cor} />
                          </td>
                        </tr>
                      );
                    })
                  }
                  {Object.keys(producaoMap).length > 0 && (
                    <tr style={{ background: "#fafafa" }}>
                      <td style={{ ...TD, fontWeight: 700, color: C.text }}>Total</td>
                      <td style={{ ...TDR, fontWeight: 700 }}>{saidas.length}</td>
                      <td style={{ ...TDR, fontWeight: 700, color: C.text }}>{fmtT(totalProducaoT, 1)}</td>
                      <td style={TDR}>100%</td>
                      <td style={TD} />
                    </tr>
                  )}
                </tbody>
              </table>
            </Card>

            <Card>
              <CardHeader title="Saídas por destino" />
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr><th style={TH}>Obra</th><th style={THR}>Ton</th></tr></thead>
                <tbody>
                  {Object.entries(saidasObraMap).length === 0 ? <EmptyRow cols={2} /> :
                    Object.entries(saidasObraMap).sort((a, b) => b[1] - a[1]).map(([obra, ton]) => (
                      <tr key={obra}>
                        <td style={{ ...TD, fontSize: 12 }}>{obra}</td>
                        <td style={{ ...TDR, fontWeight: 600 }}>{fmtT(ton, 1)}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </Card>

            <Card>
              <CardHeader title="Horímetro e OGR" sub="Por dia" />
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr><th style={TH}>Data</th><th style={THR}>HRM</th><th style={THR}>OGR (L)</th></tr></thead>
                <tbody>
                  {diarios.length === 0 ? <EmptyRow cols={3} /> :
                    diarios.map(d => {
                      const hrm = d.hrm_inicial != null && d.hrm_final != null ? d.hrm_final - d.hrm_inicial : null;
                      return (
                        <tr key={d.data}>
                          <td style={TD}>{dateBR(d.data)}</td>
                          <td style={TDR}>{fmtN(hrm, 1)}</td>
                          <td style={TDR}>{fmtN(d.ogr_litros, 0)}</td>
                        </tr>
                      );
                    })
                  }
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
            <Card>
              <CardHeader title="Entradas por material" />
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr><th style={TH}>Material</th><th style={THR}>Tickets</th><th style={THR}>Total (ton)</th></tr></thead>
                <tbody>
                  {Object.keys(entradasMap).length === 0 ? <EmptyRow cols={3} /> :
                    Object.entries(entradasMap).sort((a, b) => b[1].total - a[1].total).map(([mat, v]) => (
                      <tr key={mat}>
                        <td style={TD}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 10, height: 10, borderRadius: 2, background: matColor(mat), flexShrink: 0 }} />
                            <span style={{ fontWeight: 500 }}>{mat}</span>
                          </div>
                        </td>
                        <td style={TDR}>{v.qtd}</td>
                        <td style={{ ...TDR, fontWeight: 600, color: C.text }}>{fmtT(v.total, 1)}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </Card>

            <Card>
              <CardHeader title="Tickets de entrada" sub="Últimos 50 registros do período" />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={TH}>Data</th>
                      <th style={TH}>Veículo</th>
                      <th style={TH}>Origem</th>
                      <th style={TH}>Material</th>
                      <th style={THR}>Peso (ton)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entradas.length === 0 ? <EmptyRow cols={5} /> :
                      entradas.slice(0, 50).map(t => (
                        <tr key={t.id}>
                          <td style={{ ...TD, whiteSpace: "nowrap" }}>{dateBR(t.data)}</td>
                          <td style={{ ...TD, fontFamily: "monospace", fontSize: 12 }}>{t.veiculo}</td>
                          <td style={{ ...TD, fontSize: 12, color: C.textMute }}>{t.origem}</td>
                          <td style={TD}><Tag label={t.material} color={matColor(t.material)} /></td>
                          <td style={{ ...TDR, fontWeight: 600 }}>{fmtT(t.peso_t)}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
              {entradas.length > 50 && (
                <div style={{ padding: "12px 14px", fontSize: 12, color: C.textMute, borderTop: `1px solid ${C.border}` }}>
                  Exibindo 50 de {entradas.length}. Refine os filtros para ver mais.
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: SAÍDAS / OBRAS
        ══════════════════════════════════════ */}
        {activeTab === "saidas" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

            <Card>
              <CardHeader title="Saídas por destino" sub="Total entregue por obra no período" />
              <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={TH}>Obra / Destino</th>
                    <th style={THR}>Tickets</th>
                    <th style={THR}>Total (ton)</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const map: Record<string, { qtd: number; total: number }> = {};
                    for (const t of saidas) {
                      if (!map[t.obra]) map[t.obra] = { qtd: 0, total: 0 };
                      map[t.obra].qtd += 1;
                      map[t.obra].total += Number(t.peso_t);
                    }
                    const rows = Object.entries(map).sort((a, b) => b[1].total - a[1].total);
                    const totalGeral = rows.reduce((s, [, v]) => s + v.total, 0);
                    if (rows.length === 0) return <EmptyRow cols={3} />;
                    return (<>
                      {rows.map(([obra, v]) => (
                        <tr key={obra}>
                          <td style={{ ...TD, fontWeight: 500, color: C.text, fontSize: 12 }}>{obra}</td>
                          <td style={TDR}>{v.qtd}</td>
                          <td style={{ ...TDR, fontWeight: 600 }}>{fmtT(v.total, 1)}</td>
                        </tr>
                      ))}
                      <tr style={{ background: "#fafafa" }}>
                        <td style={{ ...TD, fontWeight: 700, color: C.text }}>Total</td>
                        <td style={{ ...TDR, fontWeight: 700 }}>{rows.reduce((s, [, v]) => s + v.qtd, 0)}</td>
                        <td style={{ ...TDR, fontWeight: 700, color: C.text }}>{fmtT(totalGeral, 1)}</td>
                      </tr>
                    </>);
                  })()}
                </tbody>
              </table>
            </Card>

            <Card>
              <CardHeader title="Saídas por material" sub="Total por produto usinado no período" />
              <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={TH}>Material</th>
                    <th style={THR}>Tickets</th>
                    <th style={THR}>Total (ton)</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const map: Record<string, { qtd: number; total: number }> = {};
                    for (const t of saidas) {
                      if (!map[t.material]) map[t.material] = { qtd: 0, total: 0 };
                      map[t.material].qtd += 1;
                      map[t.material].total += Number(t.peso_t);
                    }
                    const rows = Object.entries(map).sort((a, b) => b[1].total - a[1].total);
                    if (rows.length === 0) return <EmptyRow cols={3} />;
                    return rows.map(([mat, v]) => (
                      <tr key={mat}>
                        <td style={TD}><Tag label={mat} color={matColor(mat)} /></td>
                        <td style={TDR}>{v.qtd}</td>
                        <td style={{ ...TDR, fontWeight: 600 }}>{fmtT(v.total, 1)}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </Card>

            <Card style={{ gridColumn: "1/-1" }}>
              <CardHeader title="Tickets de saída" sub="Detalhado — últimos 50 no período" />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" as const, fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th style={TH}>Data</th>
                      <th style={TH}>Veículo</th>
                      <th style={TH}>Destino</th>
                      <th style={TH}>Material</th>
                      <th style={THR}>Peso (ton)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saidas.length === 0 ? <EmptyRow cols={5} /> :
                      saidas.slice(0, 50).map(t => (
                        <tr key={t.id}>
                          <td style={{ ...TD, whiteSpace: "nowrap" as const }}>{dateBR(t.data)}</td>
                          <td style={{ ...TD, fontFamily: "monospace", fontSize: 12 }}>{t.veiculo}</td>
                          <td style={{ ...TD, fontSize: 12, color: C.textMute }}>{t.obra}</td>
                          <td style={TD}><Tag label={t.material} color={matColor(t.material)} /></td>
                          <td style={{ ...TDR, fontWeight: 600 }}>{fmtT(t.peso_t)}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
              {saidas.length > 50 && (
                <div style={{ padding: "12px 14px", fontSize: 12, color: C.textMute, borderTop: `1px solid ${C.border}` }}>
                  Exibindo 50 de {saidas.length}. Refine os filtros para ver mais.
                </div>
              )}
            </Card>
          </div>
        )}

        {/* ══════════════════════════════════════
            TAB: PEDIDOS / OC
        ══════════════════════════════════════ */}
        {activeTab === "pedidos" && (
          <Card>
            <CardHeader title="Pedidos de compra" sub="Entradas planejadas × realizadas" />
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={TH}>Origem</th>
                    <th style={TH}>Obra / Destino</th>
                    <th style={TH}>Produto</th>
                    <th style={THR}>Pedido (ton)</th>
                    <th style={THR}>Entrado (ton)</th>
                    <th style={THR}>Saldo (ton)</th>
                    <th style={{ ...TH, width: 160 }}>Progresso</th>
                  </tr>
                </thead>
                <tbody>
                  {entradaPlans.length === 0 ? <EmptyRow cols={7} /> :
                    entradaPlans
                      .filter(p => !filterObra || p.obra.toLowerCase().includes(filterObra.toLowerCase()))
                      .sort((a, b) => String(a.produto).localeCompare(String(b.produto)))
                      .map(p => {
                        const ok = p.saldo_rest == null || Number(p.saldo_rest) >= 0;
                        const cor = matColor(p.produto ?? "");
                        return (
                          <tr key={p.plan_id}>
                            <td style={{ ...TD, fontSize: 12, color: C.textMute }}>{p.origem}</td>
                            <td style={{ ...TD, fontSize: 12, fontWeight: 500, color: C.text }}>{p.obra}</td>
                            <td style={TD}><Tag label={p.produto ?? "—"} color={cor} /></td>
                            <td style={TDR}>{p.pedido != null ? fmtT(p.pedido, 1) : "—"}</td>
                            <td style={TDR}>{fmtT(p.volume_entr, 1)}</td>
                            <td style={{ ...TDR, fontWeight: 600, color: ok ? C.text : C.danger }}>
                              {p.saldo_rest != null ? fmtT(p.saldo_rest, 1) : "—"}
                            </td>
                            <td style={TD}>
                              {p.pedido != null && p.volume_entr != null ? (
                                <div>
                                  <div style={{ fontSize: 11, color: C.textMute, marginBottom: 4 }}>
                                    {pct(p.volume_entr, p.pedido).toFixed(0)}%
                                  </div>
                                  <ProgressBar value={p.volume_entr} total={p.pedido} color={cor} />
                                </div>
                              ) : (
                                <span style={{ fontSize: 11, color: C.textMute }}>sem pedido definido</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                  }
                </tbody>
              </table>
            </div>
          </Card>
        )}

      </div>
    </div>
  );
}
