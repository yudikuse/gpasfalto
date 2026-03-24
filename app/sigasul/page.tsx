"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Tipos ────────────────────────────────────────────────────────────────────

type PosRow = {
  pos_equip_id: string;
  pos_placa: string | null;
  pos_equip_modelo: string | null;
  pos_nome_motorista: string | null;
  gps_at: string | null;
  receb_at: string | null;
  ingested_at: string | null;
  pos_ignicao: boolean | null;
  pos_online: boolean | null;
  pos_velocidade: number | null;
  pos_odometro_calc: number | null;
  pos_odometro: number | null;
  obra: string | null;
  cerca_nome_ativa: string | null;
};

type DeviceRow = {
  pos_equip_id: string;
  codigo_equipamento: string | null;
  placa: string | null;
  obra: string | null;
};

type EquipSummary = {
  pos_equip_id: string;
  nome: string;
  placa: string;
  obra: string;
  primeiraIgnicao: Date | null;
  kmTotal: number;
  tempoLigadoSec: number;
  online: boolean | null;
  ignicaoAtual: boolean | null;
  velocidadeAtual: number | null;
  ultimaPos: Date | null;
  sessions: { start: Date; end: Date; moving: boolean }[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, "0"); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getBestTs(row: PosRow): Date | null {
  const s = row.gps_at || row.receb_at || row.ingested_at;
  if (!s) return null;
  try { return new Date(s); } catch { return null; }
}

function secToLabel(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${pad2(m % 60)}min`;
  return `${m}min`;
}

function fmtKm(km: number) {
  if (km >= 1) return `${km.toFixed(1).replace(".", ",")} km`;
  return `${(km * 1000).toFixed(0)} m`;
}

function fmtHora(d: Date) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function calcSessions(rows: PosRow[]): {
  sessions: { start: Date; end: Date; moving: boolean }[];
  totalSec: number;
} {
  const pts = rows
    .filter((r) => r.pos_ignicao === true)
    .map((r) => ({ ts: getBestTs(r), speed: r.pos_velocidade ?? 0 }))
    .filter((r): r is { ts: Date; speed: number } => r.ts !== null)
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());

  if (pts.length === 0) return { sessions: [], totalSec: 0 };

  const GAP_MS = 10 * 60 * 1000;
  const sessions: { start: Date; end: Date; moving: boolean }[] = [];
  let totalSec = 0;
  let sesStart = pts[0].ts, sesPrev = sesStart, sesMaxSpeed = pts[0].speed;

  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i].ts;
    if (cur.getTime() - sesPrev.getTime() > GAP_MS) {
      const dur = (sesPrev.getTime() - sesStart.getTime()) / 1000;
      sessions.push({ start: sesStart, end: sesPrev, moving: sesMaxSpeed > 2 });
      totalSec += Math.max(0, dur);
      sesStart = cur; sesMaxSpeed = pts[i].speed;
    } else {
      sesMaxSpeed = Math.max(sesMaxSpeed, pts[i].speed);
    }
    sesPrev = cur;
  }
  const dur = (sesPrev.getTime() - sesStart.getTime()) / 1000;
  sessions.push({ start: sesStart, end: sesPrev, moving: sesMaxSpeed > 2 });
  totalSec += Math.max(0, dur);

  return { sessions, totalSec };
}

function calcKm(rows: PosRow[]): number {
  const vals = rows
    .map((p) => p.pos_odometro_calc ?? p.pos_odometro ?? null)
    .filter((v): v is number => v !== null && v > 0);
  if (vals.length < 2) return 0;
  return Math.max(0, Math.max(...vals) - Math.min(...vals));
}

// ─── UI Components ────────────────────────────────────────────────────────────

function ActivityBar({ sessions, date }: {
  sessions: { start: Date; end: Date; moving: boolean }[];
  date: string;
}) {
  const [y, m, d] = date.split("-").map(Number);
  const dayStart = new Date(y, m - 1, d, 0, 0, 0).getTime();
  const total = 24 * 3600 * 1000;
  return (
    <div style={{ position: "relative", height: 6, borderRadius: 3, background: "#f1f5f9", overflow: "hidden" }}>
      {sessions.map((s, i) => {
        const left  = Math.max(0, Math.min(100, ((s.start.getTime() - dayStart) / total) * 100));
        const width = Math.max(0.5, Math.min(100 - left, ((s.end.getTime() - s.start.getTime()) / total) * 100));
        return <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${left}%`, width: `${width}%`, background: s.moving ? "#16a34a" : "#f59e0b", borderRadius: 2 }} />;
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
      <div style={{ fontSize: 14, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function EquipCard({ eq, date }: { eq: EquipSummary; date: string }) {
  const ligado  = eq.tempoLigadoSec > 0 || eq.sessions.length > 0;
  const onlineC = eq.online === true ? "#16a34a" : eq.online === false ? "#dc2626" : "#94a3b8";
  const onlineL = eq.online === true ? "ONLINE"  : eq.online === false ? "OFFLINE" : "—";
  const igC     = eq.ignicaoAtual === true ? "#16a34a" : eq.ignicaoAtual === false ? "#64748b" : "#94a3b8";
  const igL     = eq.ignicaoAtual === true ? "LIGADO"  : eq.ignicaoAtual === false ? "DESLIGADO" : "—";
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderLeft: `4px solid ${ligado ? "#2563eb" : "#cbd5e1"}`, borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a", letterSpacing: "-0.01em" }}>{eq.nome}</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{eq.placa}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <Pill color={onlineC} label={onlineL} />
          <Pill color={igC}     label={igL} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <Metric icon="🕐" label="Ligou às"   value={eq.primeiraIgnicao ? fmtHora(eq.primeiraIgnicao) : "—"} color="#2563eb" />
        <Metric icon="📍" label="KM Rodado"  value={eq.kmTotal > 0 ? fmtKm(eq.kmTotal) : "—"}               color="#16a34a" />
        <Metric icon="⏱"  label="Tempo Lig." value={eq.tempoLigadoSec > 0 ? secToLabel(eq.tempoLigadoSec) : "—"} color="#d97706" />
      </div>
      {eq.sessions.length > 0 && <ActivityBar sessions={eq.sessions} date={date} />}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8" }}>
        {eq.velocidadeAtual != null && eq.velocidadeAtual > 0
          ? <span style={{ color: "#16a34a", fontWeight: 700 }}>🚀 {eq.velocidadeAtual} km/h</span>
          : <span />}
        {eq.ultimaPos && <span>Última pos.: {fmtHora(eq.ultimaPos)}</span>}
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
  const TODAY = useMemo(todayStr, []);

  const [date, setDate]             = useState(TODAY);
  const [obraFiltro, setObraFiltro] = useState("TODAS");
  const [loading, setLoading]       = useState(true);
  const [err, setErr]               = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [devices, setDevices]       = useState<DeviceRow[]>([]);
  const [positions, setPositions]   = useState<PosRow[]>([]);

  // Tenta carregar device_map mas não bloqueia se falhar
  useEffect(() => {
    supabase
      .from("sigasul_device_map")
      .select("pos_equip_id,codigo_equipamento,placa,obra")
      .then(({ data }) => { if (data && data.length > 0) setDevices(data as DeviceRow[]); });
  }, []);

  async function load() {
    setLoading(true);
    setErr(null);

    const [y, m, d] = date.split("-").map(Number);

    // Janela do dia em BRT (UTC-3) → em UTC fica +3h
    // Ex: 24/03 00:00 BRT = 24/03 03:00 UTC → 24/03 03:00Z até 25/03 02:59Z
    const fromBRT = new Date(Date.UTC(y, m - 1, d,  3,  0,  0));  // 00:00 BRT
    const toBRT   = new Date(Date.UTC(y, m - 1, d, 26, 59, 59));  // 23:59 BRT (d+1 03:00 UTC)

    const fromISO = fromBRT.toISOString();
    const toISO   = toBRT.toISOString();

    const PAGE = 5000;
    let all: PosRow[] = [];
    let hasError = false;

    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("sigasul_positions_raw")
        .select("pos_equip_id,pos_placa,pos_equip_modelo,pos_nome_motorista,gps_at,receb_at,ingested_at,pos_ignicao,pos_online,pos_velocidade,pos_odometro_calc,pos_odometro,obra,cerca_nome_ativa")
        .gte("ingested_at", fromISO)
        .lte("ingested_at", toISO)
        .order("ingested_at", { ascending: true })
        .range(offset, offset + PAGE - 1);

      if (error) {
        // Se ingested_at não existe, tenta gps_at
        const { data: data2, error: error2 } = await supabase
          .from("sigasul_positions_raw")
          .select("pos_equip_id,pos_placa,pos_equip_modelo,pos_nome_motorista,gps_at,receb_at,ingested_at,pos_ignicao,pos_online,pos_velocidade,pos_odometro_calc,pos_odometro,obra,cerca_nome_ativa")
          .gte("gps_at", fromISO)
          .lte("gps_at", toISO)
          .order("gps_at", { ascending: true })
          .range(offset, offset + PAGE - 1);

        if (error2) {
          setErr(`Erro ao carregar posições: ${error2.message}`);
          hasError = true;
          break;
        }
        if (!data2 || data2.length === 0) break;
        all = all.concat(data2 as PosRow[]);
        if (data2.length < PAGE) break;
      } else {
        if (!data || data.length === 0) break;
        all = all.concat(data as PosRow[]);
        if (data.length < PAGE) break;
      }
    }

    if (!hasError) {
      setPositions(all);
      setLastUpdate(new Date());
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    if (date !== TODAY) return;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Mapa device_map por equip_id
  const equipMap = useMemo(() => {
    const m = new Map<string, DeviceRow>();
    for (const d of devices) m.set(d.pos_equip_id, d);
    return m;
  }, [devices]);

  // Agrega por equipamento
  const summaries = useMemo((): EquipSummary[] => {
    const byEquip = new Map<string, PosRow[]>();
    for (const p of positions) {
      if (!p.pos_equip_id) continue;
      if (!byEquip.has(p.pos_equip_id)) byEquip.set(p.pos_equip_id, []);
      byEquip.get(p.pos_equip_id)!.push(p);
    }

    if (byEquip.size === 0) return [];

    return Array.from(byEquip.entries())
      .map(([id, rows]) => {
        const dev = equipMap.get(id);

        // Nome: preferir device_map, senão identificação no mapa (pos_equip_modelo não é o nome)
        // A placa é o melhor identificador disponível na raw
        const placa = dev?.placa || rows[0]?.pos_placa || id;
        const nome  = dev?.codigo_equipamento || placa;

        // Obra: device_map > campo obra da posição > cerca > SEM OBRA
        const obra =
          dev?.obra ||
          rows.find((r) => r.obra)?.obra ||
          rows.find((r) => r.cerca_nome_ativa)?.cerca_nome_ativa ||
          "SEM OBRA";

        // Ordena por timestamp
        const sorted = [...rows].sort((a, b) => {
          const ta = getBestTs(a)?.getTime() ?? 0;
          const tb = getBestTs(b)?.getTime() ?? 0;
          return ta - tb;
        });

        const ligadas = sorted.filter((r) => r.pos_ignicao === true);
        const primeiraIgnicao = ligadas.length > 0 ? getBestTs(ligadas[0]) : null;
        const kmTotal = calcKm(sorted);
        const { sessions, totalSec } = calcSessions(sorted);
        const ultima = sorted[sorted.length - 1] ?? null;

        return {
          pos_equip_id:    id,
          nome, placa, obra,
          primeiraIgnicao,
          kmTotal,
          tempoLigadoSec:  totalSec,
          online:          ultima?.pos_online     ?? null,
          ignicaoAtual:    ultima?.pos_ignicao    ?? null,
          velocidadeAtual: ultima?.pos_velocidade ?? null,
          ultimaPos:       ultima ? getBestTs(ultima) : null,
          sessions,
        } satisfies EquipSummary;
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [positions, equipMap]);

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
    [summaries, obraFiltro]
  );

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
                {isToday ? "Hoje" : date} · {positions.length.toLocaleString("pt-BR")} posições{isToday && " · auto-refresh 1min"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px", fontSize: 13, color: "white" }} />
            <select value={obraFiltro} onChange={(e) => setObraFiltro(e.target.value)}
              style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "6px 10px", fontSize: 13, color: "white", minWidth: 140 }}>
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

          {/* Grupos */}
          {loading && positions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "80px 0", color: "#94a3b8", fontSize: 15 }}>Carregando…</div>
          ) : summaries.length === 0 ? (
            <div style={{ background: "#fefce8", border: "1px solid #fde68a", borderRadius: 10, padding: "16px 20px", color: "#92400e", fontSize: 14 }}>
              <strong>Nenhuma posição encontrada para {date}.</strong><br />
              Verifique se o cron <code>/api/cron/sigasul</code> está rodando e se a tabela <code>sigasul_positions_raw</code> tem dados para este dia.
              <br /><br />
              <span style={{ fontSize: 12, color: "#78716c" }}>
                Dica: acesse <code>/api/cron/sigasul?debug=1</code> no navegador para ver o status do cron.
              </span>
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
