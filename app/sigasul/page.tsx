"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Tipos ────────────────────────────────────────────────────────────────────

// sigasul_dashboard_latest
type LatestRow = {
  pos_equip_id: string;
  codigo_equipamento: string | null;
  pos_placa: string | null;
  obra_final: string | null;
  gps_at: string | null;
  ingested_at: string | null;
  pos_ignicao: boolean | null;
  pos_online: boolean | null;
  pos_velocidade: number | null;
  pos_latitude: number | null;
  pos_longitude: number | null;
};

// jornadas/simplificada
type SigasulEvento = {
  data_hora_inicial: string;
  data_hora_final: string;
  distancia: number;       // metros
  motorista: string | null;
  tempoLigado: string;     // "HH:MM:SS"
};
type SigasulVeiculo = {
  placa: string;
  identificacaoMapa: string;
  eventos: SigasulEvento[];
};

// v2/positions/controls/all
type SigasulPosition = {
  pos_equip_id: string;
  pos_placa: string;
  pos_ignicao: boolean;
  pos_online: boolean;
  pos_velocidade: number;
  pos_data_hora_gps: string;
  pos_cercas: { pos_cerca_id: number; pos_cerca_nome: string }[];
  pos_ponto?: { ponto_nome: string; ponto_tipo: string } | null;
};

type EquipSummary = {
  pos_equip_id: string;
  nome: string;            // codigo_equipamento
  placa: string;
  obra: string;
  // da simplificada
  primeiraIgnicao: string | null;  // "HH:MM"
  kmTotal: number;                 // metros
  tempoLigadoSec: number;
  eventos: SigasulEvento[];
  // da positions (tempo real)
  online: boolean | null;
  ignicaoAtual: boolean | null;
  velocidadeAtual: number | null;
  ultimaPos: string | null;        // "HH:MM"
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, "0"); }

function todayBRT() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return `${brt.getUTCFullYear()}-${pad2(brt.getUTCMonth() + 1)}-${pad2(brt.getUTCDate())}`;
}

/** "HH:MM:SS" → segundos */
function hhmmssToSec(s: string): number {
  if (!s) return 0;
  const [h, m, sec] = s.split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (sec || 0);
}

function secToLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${pad2(m % 60)}min`;
  if (m > 0) return `${m}min`;
  return `${s}s`;
}

function fmtKm(metros: number): string {
  if (metros >= 1000) return `${(metros / 1000).toFixed(1).replace(".", ",")} km`;
  return `${metros.toFixed(0)} m`;
}

function fmtHoraFromStr(datetime: string): string {
  // "2026-03-24 07:57:11" ou ISO
  try {
    const normalized = datetime.replace(" ", "T");
    const d = new Date(normalized);
    // Subtrai 3h se for UTC (Supabase sempre salva UTC)
    const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    return brt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  } catch { return "—"; }
}

function fmtHoraFromISO(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  } catch { return "—"; }
}

// ─── Componentes ──────────────────────────────────────────────────────────────

function ActivityBar({ eventos, date }: { eventos: SigasulEvento[]; date: string }) {
  if (eventos.length === 0) return null;
  const [y, m, d] = date.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d, 0, 0, 0).getTime();
  const total    = 24 * 3600 * 1000;

  return (
    <div style={{ position: "relative", height: 6, borderRadius: 3, background: "#f1f5f9", overflow: "hidden" }}>
      {eventos.map((ev, i) => {
        const s = new Date(ev.data_hora_inicial.replace(" ", "T")).getTime() - dayStart;
        const e = new Date(ev.data_hora_final.replace(" ", "T")).getTime() - dayStart;
        const left  = Math.max(0, (s / total) * 100);
        const width = Math.max(0.5, ((e - s) / total) * 100);
        const moving = ev.distancia > 50;
        return <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${left}%`, width: `${width}%`, background: moving ? "#16a34a" : "#f59e0b", borderRadius: 2 }} />;
      })}
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 8px", borderRadius: 999, background: color + "18", border: `1px solid ${color}40`, fontSize: 11, fontWeight: 700, color }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

function Metric({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>{icon} {label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color, lineHeight: 1 }}>{value || "—"}</div>
    </div>
  );
}

function EquipCard({ eq, date }: { eq: EquipSummary; date: string }) {
  const ligado  = eq.tempoLigadoSec > 0;
  const onlineC = eq.online === true ? "#16a34a" : eq.online === false ? "#dc2626" : "#94a3b8";
  const onlineL = eq.online === true ? "ONLINE"  : eq.online === false ? "OFFLINE" : "—";
  const igC     = eq.ignicaoAtual === true ? "#16a34a" : eq.ignicaoAtual === false ? "#64748b" : "#94a3b8";
  const igL     = eq.ignicaoAtual === true ? "LIGADO"  : eq.ignicaoAtual === false ? "DESLIGADO" : "—";

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderLeft: `4px solid ${ligado ? "#2563eb" : "#cbd5e1"}`, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a", letterSpacing: "-0.01em" }}>{eq.nome}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 1 }}>{eq.placa}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <Pill color={onlineC} label={onlineL} />
          <Pill color={igC}     label={igL} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <Metric icon="🕐" label="Ligou às"   value={eq.primeiraIgnicao ?? "—"}                        color="#2563eb" />
        <Metric icon="📍" label="KM Rodado"  value={eq.kmTotal > 0 ? fmtKm(eq.kmTotal) : "—"}         color="#16a34a" />
        <Metric icon="⏱"  label="Tempo Lig." value={eq.tempoLigadoSec > 0 ? secToLabel(eq.tempoLigadoSec) : "—"} color="#d97706" />
      </div>

      {eq.eventos.length > 0 && <ActivityBar eventos={eq.eventos} date={date} />}

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8" }}>
        {eq.velocidadeAtual != null && eq.velocidadeAtual > 0
          ? <span style={{ color: "#16a34a", fontWeight: 700 }}>🚀 {eq.velocidadeAtual} km/h</span>
          : <span />}
        {eq.ultimaPos && <span>Última pos.: {eq.ultimaPos}</span>}
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 600, marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color, letterSpacing: "-0.03em", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function SigasulPage() {
  const TODAY = useMemo(todayBRT, []);

  const [date, setDate]             = useState(TODAY);
  const [obraFiltro, setObraFiltro] = useState("TODAS");
  const [loading, setLoading]       = useState(true);
  const [err, setErr]               = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Da API
  const [latest, setLatest]         = useState<LatestRow[]>([]);
  const [simplificada, setSimplificada] = useState<SigasulVeiculo[]>([]);
  const [positions, setPositions]   = useState<SigasulPosition[]>([]);

  async function load() {
    setLoading(true);
    setErr(null);

    // 1. Busca sigasul_dashboard_latest do Supabase (status atual + obra + codigo)
    const { data: latestData, error: latestErr } = await supabase
      .from("sigasul_dashboard_latest")
      .select("pos_equip_id,codigo_equipamento,pos_placa,obra_final,gps_at,ingested_at,pos_ignicao,pos_online,pos_velocidade,pos_latitude,pos_longitude");

    if (latestErr) {
      setErr(`Erro ao carregar equipamentos: ${latestErr.message}`);
      setLoading(false);
      return;
    }
    setLatest((latestData ?? []) as LatestRow[]);

    // 2. Busca simplificada + positions via API route (server-side, esconde token)
    try {
      const res = await fetch(`/api/sigasul/today?date=${date}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.simplificada)) setSimplificada(json.simplificada);
        if (Array.isArray(json.positions))    setPositions(json.positions);
        if (json.errors?.simplificada) console.warn("simplificada:", json.errors.simplificada);
        if (json.errors?.positions)    console.warn("positions:", json.errors.positions);
      }
    } catch (e) {
      console.warn("API today:", e);
    }

    setLastUpdate(new Date());
    setLoading(false);
  }

  useEffect(() => {
    load();
    if (date !== TODAY) return;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // ── Mapa de posições em tempo real (por placa) ────────────────────────────
  const posMap = useMemo(() => {
    const m = new Map<string, SigasulPosition>();
    for (const p of positions) if (p.pos_placa) m.set(p.pos_placa.toUpperCase(), p);
    return m;
  }, [positions]);

  // ── Mapa da simplificada (por placa normalizada) ──────────────────────────
  const simpMap = useMemo(() => {
    const m = new Map<string, SigasulVeiculo>();
    for (const v of simplificada) if (v.placa) m.set(v.placa.replace(/[^A-Z0-9]/gi, "").toUpperCase(), v);
    return m;
  }, [simplificada]);

  // ── Monta summaries ───────────────────────────────────────────────────────
  const summaries = useMemo((): EquipSummary[] => {
    return latest
      .map((row) => {
        const nome  = row.codigo_equipamento || row.pos_placa || row.pos_equip_id;
        const placa = row.pos_placa || "—";
        const obra  = row.obra_final && row.obra_final !== "SEM_OBRA" ? row.obra_final : "SEM OBRA";

        // Simplificada: tenta por placa (sem traço e maiúsculo)
        const placaKey = placa.replace(/[^A-Z0-9]/gi, "").toUpperCase();
        const simp = simpMap.get(placaKey);

        const eventos = simp?.eventos ?? [];
        const kmTotal = eventos.reduce((a, e) => a + (e.distancia ?? 0), 0);
        const tempoLigadoSec = eventos.reduce((a, e) => a + hhmmssToSec(e.tempoLigado), 0);
        const primeiraIgnicao = eventos.length > 0 ? fmtHoraFromStr(eventos[0].data_hora_inicial) : null;

        // Posição em tempo real: por placa
        const pos = posMap.get(placa.replace(/[^A-Z0-9]/gi, "").toUpperCase());

        // Status: preferir tempo real (pos), senão dashboard_latest
        const online         = pos ? pos.pos_online         : row.pos_online;
        const ignicaoAtual   = pos ? pos.pos_ignicao        : row.pos_ignicao;
        const velocidadeAtual = pos ? pos.pos_velocidade    : row.pos_velocidade;
        const ultimaPos = pos
          ? fmtHoraFromStr(pos.pos_data_hora_gps)
          : fmtHoraFromISO(row.gps_at ?? row.ingested_at);

        return {
          pos_equip_id:  row.pos_equip_id,
          nome, placa, obra,
          primeiraIgnicao,
          kmTotal,
          tempoLigadoSec,
          eventos,
          online, ignicaoAtual, velocidadeAtual, ultimaPos,
        } satisfies EquipSummary;
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [latest, simpMap, posMap]);

  // ── Filtros ───────────────────────────────────────────────────────────────
  const obras = useMemo(() => {
    const s = new Set(summaries.map((e) => e.obra));
    return ["TODAS", ...Array.from(s).sort((a, b) => {
      if (a === "SEM OBRA") return 1;
      if (b === "SEM OBRA") return -1;
      return a.localeCompare(b, "pt-BR");
    })];
  }, [summaries]);

  const filtered = useMemo(() =>
    obraFiltro === "TODAS" ? summaries : summaries.filter((e) => e.obra === obraFiltro),
    [summaries, obraFiltro]);

  const groups = useMemo(() => {
    const m = new Map<string, EquipSummary[]>();
    for (const e of filtered) {
      if (!m.has(e.obra)) m.set(e.obra, []);
      m.get(e.obra)!.push(e);
    }
    return m;
  }, [filtered]);

  const totals = useMemo(() => ({
    total:   summaries.length,
    online:  summaries.filter((e) => e.online === true).length,
    ligados: summaries.filter((e) => e.tempoLigadoSec > 0).length,
    km:      summaries.reduce((a, e) => a + e.kmTotal, 0),
  }), [summaries]);

  const isToday = date === TODAY;

  return (
    <>
      <style>{`* { box-sizing: border-box; }`}</style>
      <div style={{ minHeight: "100vh", background: "#f1f5f9", fontFamily: "system-ui,-apple-system,sans-serif" }}>

        {/* Top Bar */}
        <div style={{ background: "#0f172a", color: "white", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, position: "sticky", top: 0, zIndex: 100, borderBottom: "1px solid #1e293b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#2563eb,#0ea5e9)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 12 }}>GP</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: "-0.02em", lineHeight: 1 }}>GP Asfalto — Monitoramento</div>
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                {isToday ? "Hoje" : date} · {summaries.length} equipamentos{isToday && " · auto-refresh 1min"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px", fontSize: 13, color: "white" }} />
            <select value={obraFiltro} onChange={(e) => setObraFiltro(e.target.value)}
              style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px", fontSize: 13, color: "white", minWidth: 150 }}>
              {obras.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <button onClick={load} disabled={loading}
              style={{ background: loading ? "#1e293b" : "#2563eb", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 700, color: loading ? "#64748b" : "white", cursor: loading ? "not-allowed" : "pointer" }}>
              {loading ? "Atualizando…" : "↺ Atualizar"}
            </button>
          </div>
        </div>

        {/* Conteúdo */}
        <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>

          {err && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", color: "#991b1b", marginBottom: 16, fontSize: 13 }}>
              <strong>Erro:</strong> {err}
            </div>
          )}

          {/* Resumo */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
            <SummaryCard icon="🚛" label="Equipamentos"     value={String(totals.total)}   color="#0f172a" />
            <SummaryCard icon="📡" label="Online agora"     value={String(totals.online)}  color="#2563eb" />
            <SummaryCard icon="⚙️" label="Trabalharam hoje" value={String(totals.ligados)} color="#16a34a" />
            <SummaryCard icon="🛣️" label="KM total frota"   value={totals.km > 0 ? fmtKm(totals.km) : "—"} color="#d97706" />
          </div>

          {/* Legenda */}
          <div style={{ display: "flex", gap: 16, marginBottom: 16, fontSize: 12, color: "#64748b", alignItems: "center" }}>
            <span style={{ fontWeight: 700, color: "#374151" }}>Barra:</span>
            {[["#16a34a","Deslocando"],["#f59e0b","Parado (motor on)"]].map(([c,l]) => (
              <span key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 12, height: 6, borderRadius: 2, background: c, display: "inline-block" }} />
                {l}
              </span>
            ))}
            {lastUpdate && <span style={{ marginLeft: "auto" }}>Atualizado às {lastUpdate.toLocaleTimeString("pt-BR")}</span>}
          </div>

          {/* Grupos por obra */}
          {loading && summaries.length === 0 ? (
            <div style={{ textAlign: "center", padding: "80px 0", color: "#94a3b8" }}>Carregando…</div>
          ) : summaries.length === 0 ? (
            <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 10, padding: "16px 20px", color: "#92400e", fontSize: 14 }}>
              <strong>Nenhum equipamento encontrado.</strong><br />
              Verifique se a tabela <code>sigasul_dashboard_latest</code> tem dados e se o RLS permite leitura com anon key.
            </div>
          ) : (
            [...groups.entries()].map(([obraName, equips]) => (
              <div key={obraName} style={{ marginBottom: 28 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 4, height: 22, borderRadius: 2, background: obraName === "SEM OBRA" ? "#94a3b8" : "#2563eb" }} />
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.02em" }}>{obraName}</h2>
                  <span style={{ fontSize: 12, color: "#64748b", background: "#e2e8f0", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>{equips.length} equip.</span>
                  <span style={{ fontSize: 12, color: "#16a34a", background: "#dcfce7", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>
                    {equips.filter((e) => e.tempoLigadoSec > 0).length} trabalhando
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
                  {equips.map((eq) => <EquipCard key={eq.pos_equip_id} eq={eq} date={date} />)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
