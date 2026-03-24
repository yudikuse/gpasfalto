"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Design tokens (mesmo padrão do dash de materiais) ────────────────────────

const C = {
  bg:       "#f4f5f7",
  surface:  "#ffffff",
  border:   "#e8eaed",
  text:     "#1a1f36",
  textMid:  "#4b5563",
  textMute: "#9ca3af",
  primary:  "#4361ee",
  success:  "#0d9f6e",
  danger:   "#dc2626",
  warning:  "#d97706",
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

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
};

type SigasulEvento = {
  data_hora_inicial: string;
  data_hora_final: string;
  distancia: number;
  tempoLigado: string; // "HH:MM:SS"
};

type SigasulVeiculo = {
  placa: string;
  identificacaoMapa: string;
  eventos: SigasulEvento[];
};

type SigasulPosition = {
  pos_equip_id: string;
  pos_placa: string;
  pos_ignicao: boolean;
  pos_online: boolean;
  pos_velocidade: number;
  pos_data_hora_gps: string;
};

type EquipRow = {
  pos_equip_id: string;
  nome: string;
  placa: string;
  obra: string;
  online: boolean | null;
  ignicao: boolean | null;
  velocidade: number | null;
  ultimaPos: string | null;
  primeiraIgnicao: string | null;
  kmTotal: number;
  tempoLigadoSec: number;
  eventos: SigasulEvento[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, "0"); }

function todayBRT() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return `${brt.getUTCFullYear()}-${pad2(brt.getUTCMonth() + 1)}-${pad2(brt.getUTCDate())}`;
}

function hhmmssToSec(s: string) {
  if (!s) return 0;
  const [h, m, sec] = s.split(":").map(Number);
  return (h || 0) * 3600 + (m || 0) * 60 + (sec || 0);
}

function secToLabel(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${pad2(m % 60)}min`;
  if (m > 0) return `${m}min`;
  return `<1min`;
}

function fmtKm(metros: number) {
  if (metros >= 1000) return `${(metros / 1000).toFixed(1).replace(".", ",")} km`;
  return `${metros.toFixed(0)} m`;
}

/**
 * Sigasul retorna datas já em BRT ("2026-03-24 07:57:11").
 * Extraímos só a parte HH:MM diretamente — sem conversão de fuso.
 */
function fmtHoraFromStr(dt: string): string {
  if (!dt) return "—";
  // Formato "YYYY-MM-DD HH:MM:SS" ou "YYYY-MM-DDTHH:MM:SS"
  const match = dt.match(/[T ](\d{2}:\d{2})/);
  return match ? match[1] : "—";
}

/**
 * Datas do Supabase chegam como ISO UTC (timestamptz).
 * Converte corretamente para BRT.
 */
function fmtHoraFromISO(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
    });
  } catch { return "—"; }
}

// ─── Componentes ──────────────────────────────────────────────────────────────

function StatusDot({ online, ignicao }: { online: boolean | null; ignicao: boolean | null }) {
  const color = online === false ? C.danger : ignicao === true ? C.success : C.textMute;
  const label = online === false ? "OFFLINE" : ignicao === true ? "LIGADO" : "DESLIGADO";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label}
    </span>
  );
}

function MiniBar({ eventos, date }: { eventos: SigasulEvento[]; date: string }) {
  if (eventos.length === 0) return <div style={{ height: 4, background: C.border, borderRadius: 2 }} />;
  const [y, m, d] = date.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d, 0, 0, 0).getTime();
  const total = 24 * 3600 * 1000;
  return (
    <div style={{ position: "relative", height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
      {eventos.map((ev, i) => {
        const s = new Date(ev.data_hora_inicial.replace(" ", "T")).getTime() - dayStart;
        const e = new Date(ev.data_hora_final.replace(" ", "T")).getTime() - dayStart;
        const left  = Math.max(0, (s / total) * 100);
        const width = Math.max(0.5, ((e - s) / total) * 100);
        return (
          <div key={i} style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${left}%`, width: `${width}%`,
            background: ev.distancia > 50 ? C.success : C.warning,
          }} />
        );
      })}
    </div>
  );
}

// Card compacto — estilo tabela/lista como no materiais
function EquipRow({ eq, date }: { eq: EquipRow; date: string }) {
  const ligado = eq.tempoLigadoSec > 0;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "180px 1fr 90px 90px 80px 80px",
      alignItems: "center",
      gap: 12,
      padding: "10px 16px",
      borderBottom: `1px solid ${C.border}`,
      background: C.surface,
      fontSize: 13,
    }}>
      {/* Nome + placa */}
      <div>
        <div style={{ fontWeight: 700, color: C.text, fontSize: 13 }}>{eq.nome}</div>
        <div style={{ fontSize: 11, color: C.textMute, marginTop: 1 }}>{eq.placa}</div>
      </div>

      {/* Barra de atividade */}
      <MiniBar eventos={eq.eventos} date={date} />

      {/* Ligou às */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 10, color: C.textMute, textTransform: "uppercase", letterSpacing: "0.04em" }}>Ligou às</div>
        <div style={{ fontWeight: 700, color: ligado ? C.primary : C.textMute, fontSize: 13 }}>
          {eq.primeiraIgnicao ?? "—"}
        </div>
      </div>

      {/* KM */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 10, color: C.textMute, textTransform: "uppercase", letterSpacing: "0.04em" }}>KM</div>
        <div style={{ fontWeight: 700, color: eq.kmTotal > 0 ? C.success : C.textMute, fontSize: 13 }}>
          {eq.kmTotal > 0 ? fmtKm(eq.kmTotal) : "—"}
        </div>
      </div>

      {/* Tempo ligado */}
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 10, color: C.textMute, textTransform: "uppercase", letterSpacing: "0.04em" }}>Tempo</div>
        <div style={{ fontWeight: 700, color: ligado ? C.warning : C.textMute, fontSize: 13 }}>
          {ligado ? secToLabel(eq.tempoLigadoSec) : "—"}
        </div>
      </div>

      {/* Status */}
      <div style={{ textAlign: "right" }}>
        <StatusDot online={eq.online} ignicao={eq.ignicao} />
        {eq.velocidade != null && eq.velocidade > 0 && (
          <div style={{ fontSize: 10, color: C.success, marginTop: 2, fontWeight: 600 }}>🚀 {eq.velocidade} km/h</div>
        )}
        {eq.ultimaPos && (
          <div style={{ fontSize: 10, color: C.textMute, marginTop: 1 }}>{eq.ultimaPos}</div>
        )}
      </div>
    </div>
  );
}

function ObraSection({ obra, equips, date }: { obra: string; equips: EquipRow[]; date: string }) {
  const trabalhando = equips.filter((e) => e.tempoLigadoSec > 0).length;
  const online      = equips.filter((e) => e.online === true).length;

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Cabeçalho da obra */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "8px 16px",
        background: "#f8f9fb",
        border: `1px solid ${C.border}`,
        borderBottom: "none",
        borderRadius: "8px 8px 0 0",
      }}>
        <div style={{ width: 3, height: 16, borderRadius: 2, background: obra === "SEM OBRA" ? C.textMute : C.primary }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{obra}</span>
        <span style={{ fontSize: 12, color: C.textMute }}>{equips.length} equip.</span>
        <span style={{ fontSize: 12, color: C.success, fontWeight: 600 }}>{trabalhando} trabalhando</span>
        <span style={{ fontSize: 12, color: C.primary, fontWeight: 600, marginLeft: "auto" }}>{online} online</span>
      </div>

      {/* Header das colunas */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "180px 1fr 90px 90px 80px 80px",
        gap: 12,
        padding: "6px 16px",
        background: "#fafafa",
        border: `1px solid ${C.border}`,
        borderBottom: "none",
        fontSize: 10,
        color: C.textMute,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}>
        <div>Equipamento</div>
        <div>Atividade do dia</div>
        <div style={{ textAlign: "center" }}>Ligou às</div>
        <div style={{ textAlign: "center" }}>KM</div>
        <div style={{ textAlign: "center" }}>Tempo</div>
        <div style={{ textAlign: "right" }}>Status</div>
      </div>

      {/* Linhas */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
        {equips.map((eq) => <EquipRow key={eq.pos_equip_id} eq={eq} date={date} />)}
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 16px" }}>
      <div style={{ fontSize: 11, color: C.textMute, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function SigasulPage() {
  const TODAY = useMemo(todayBRT, []);

  const [date, setDate]               = useState(TODAY);
  const [obraFiltro, setObraFiltro]   = useState("TODAS");
  const [loading, setLoading]         = useState(true);
  const [err, setErr]                 = useState<string | null>(null);
  const [lastUpdate, setLastUpdate]   = useState<Date | null>(null);
  const [latest, setLatest]           = useState<LatestRow[]>([]);
  const [simplificada, setSimplificada] = useState<SigasulVeiculo[]>([]);
  const [positions, setPositions]     = useState<SigasulPosition[]>([]);

  async function load() {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase
      .from("sigasul_dashboard_latest")
      .select("pos_equip_id,codigo_equipamento,pos_placa,obra_final,gps_at,ingested_at,pos_ignicao,pos_online,pos_velocidade");

    if (error) { setErr(error.message); setLoading(false); return; }
    setLatest((data ?? []) as LatestRow[]);

    try {
      const res = await fetch(`/api/sigasul/today?date=${date}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.simplificada)) setSimplificada(json.simplificada);
        if (Array.isArray(json.positions))    setPositions(json.positions);
      }
    } catch (e) { console.warn("today API:", e); }

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

  const posMap = useMemo(() => {
    const m = new Map<string, SigasulPosition>();
    for (const p of positions) if (p.pos_placa) m.set(p.pos_placa.replace(/\W/g, "").toUpperCase(), p);
    return m;
  }, [positions]);

  const simpMap = useMemo(() => {
    const m = new Map<string, SigasulVeiculo>();
    for (const v of simplificada) if (v.placa) m.set(v.placa.replace(/\W/g, "").toUpperCase(), v);
    return m;
  }, [simplificada]);

  const equips = useMemo((): EquipRow[] => {
    return latest
      .map((row): EquipRow => {
        const nome  = row.codigo_equipamento || row.pos_placa || row.pos_equip_id;
        const placa = row.pos_placa || "—";
        const obra  = row.obra_final && row.obra_final !== "SEM_OBRA" ? row.obra_final : "SEM OBRA";

        const key  = placa.replace(/\W/g, "").toUpperCase();
        const simp = simpMap.get(key);
        const pos  = posMap.get(key);

        const eventos         = simp?.eventos ?? [];
        const kmTotal         = eventos.reduce((a, e) => a + (e.distancia ?? 0), 0);
        const tempoLigadoSec  = eventos.reduce((a, e) => a + hhmmssToSec(e.tempoLigado), 0);
        const primeiraIgnicao = eventos.length > 0 ? fmtHoraFromStr(eventos[0].data_hora_inicial) : null;

        const online    = pos ? pos.pos_online    : row.pos_online;
        const ignicao   = pos ? pos.pos_ignicao   : row.pos_ignicao;
        const velocidade = pos ? pos.pos_velocidade : row.pos_velocidade;
        const ultimaPos = pos
          ? fmtHoraFromStr(pos.pos_data_hora_gps)
          : fmtHoraFromISO(row.gps_at ?? row.ingested_at);

        return { pos_equip_id: row.pos_equip_id, nome, placa, obra, online, ignicao, velocidade, ultimaPos, primeiraIgnicao, kmTotal, tempoLigadoSec, eventos };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [latest, simpMap, posMap]);

  const obras = useMemo(() => {
    const s = new Set(equips.map((e) => e.obra));
    return ["TODAS", ...Array.from(s).sort((a, b) => {
      if (a === "SEM OBRA") return 1;
      if (b === "SEM OBRA") return -1;
      return a.localeCompare(b, "pt-BR");
    })];
  }, [equips]);

  const filtered = useMemo(() =>
    obraFiltro === "TODAS" ? equips : equips.filter((e) => e.obra === obraFiltro),
    [equips, obraFiltro]);

  const groups = useMemo(() => {
    const m = new Map<string, EquipRow[]>();
    for (const e of filtered) {
      if (!m.has(e.obra)) m.set(e.obra, []);
      m.get(e.obra)!.push(e);
    }
    return m;
  }, [filtered]);

  const totals = useMemo(() => ({
    total:   equips.length,
    online:  equips.filter((e) => e.online === true).length,
    ligados: equips.filter((e) => e.tempoLigadoSec > 0).length,
    km:      equips.reduce((a, e) => a + e.kmTotal, 0),
  }), [equips]);

  const isToday = date === TODAY;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui,-apple-system,sans-serif" }}>

      {/* Topbar compacta */}
      <div style={{
        background: C.surface,
        borderBottom: `1px solid ${C.border}`,
        padding: "10px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: C.text }}>🚛 Monitoramento de Frota</span>
          <span style={{ fontSize: 12, color: C.textMute }}>
            {isToday ? "Hoje" : date} · {equips.length} equip.{isToday && " · refresh 1min"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 8px", fontSize: 13, color: C.text, background: C.surface }} />
          <select value={obraFiltro} onChange={(e) => setObraFiltro(e.target.value)}
            style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 8px", fontSize: 13, color: C.text, background: C.surface, minWidth: 150 }}>
            {obras.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button onClick={load} disabled={loading}
            style={{ background: loading ? C.border : C.primary, border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 13, fontWeight: 600, color: loading ? C.textMute : "#fff", cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "Atualizando…" : "↺ Atualizar"}
          </button>
          {lastUpdate && (
            <span style={{ fontSize: 11, color: C.textMute }}>
              {lastUpdate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: "16px 24px", maxWidth: 1400, margin: "0 auto" }}>

        {err && (
          <div style={{ background: "#fef2f2", border: `1px solid #fecaca`, borderRadius: 8, padding: "10px 14px", color: C.danger, marginBottom: 12, fontSize: 13 }}>
            <strong>Erro:</strong> {err}
          </div>
        )}

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
          <StatBox label="Equipamentos"     value={String(totals.total)}   color={C.text} />
          <StatBox label="Online agora"     value={String(totals.online)}  color={C.primary} />
          <StatBox label="Trabalharam hoje" value={String(totals.ligados)} color={C.success} />
          <StatBox label="KM total frota"   value={totals.km > 0 ? fmtKm(totals.km) : "—"} color={C.warning} />
        </div>

        {/* Legenda */}
        <div style={{ display: "flex", gap: 14, marginBottom: 12, fontSize: 11, color: C.textMute, alignItems: "center" }}>
          {[["#0d9f6e","Deslocando"],["#d97706","Parado (motor on)"]].map(([c, l]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 16, height: 4, borderRadius: 2, background: c, display: "inline-block" }} />{l}
            </span>
          ))}
        </div>

        {/* Conteúdo */}
        {loading && equips.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.textMute }}>Carregando…</div>
        ) : equips.length === 0 ? (
          <div style={{ background: "#fffbeb", border: `1px solid #fde68a`, borderRadius: 8, padding: "14px 16px", color: C.warning, fontSize: 13 }}>
            Nenhum equipamento encontrado. Verifique a tabela <code>sigasul_dashboard_latest</code>.
          </div>
        ) : (
          [...groups.entries()].map(([obra, rows]) => (
            <ObraSection key={obra} obra={obra} equips={rows} date={date} />
          ))
        )}
      </div>
    </div>
  );
}
