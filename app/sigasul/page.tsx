"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Tipos (mantidos idênticos ao original) ───────────────────────────────────

type IntervalRow = {
  pos_equip_id: string;
  codigo_equipamento: string | null;
  pos_placa: string | null;
  obra: string | null;
  ts_start: string;
  ts_end: string;
  dt_sec: number;
  status_operacao: "DESLIGADO" | "DESLOCANDO" | "PARADO" | "DESCONHECIDO" | string;
};

type LatestRow = {
  pos_equip_id: string;
  status_comunicacao: string | null;
  status_operacao: string | null;
  obra_final: string | null;
  data_ts: string | null;
};

type ObraRow = { obra: string };
type DeviceRow = {
  pos_equip_id: string;
  codigo_equipamento: string | null;
  placa: string | null;
  ativo: boolean;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Utilitários ──────────────────────────────────────────────────────────────

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function secondsToHHMM(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `${pad2(h)}h ${pad2(m % 60)}min`;
}

function getWindow(dateStr: string) {
  const [y, mo, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  return {
    w0: new Date(y, mo - 1, d, 0, 0, 0, 0),
    w1: new Date(y, mo - 1, d, 23, 59, 59, 999),
  };
}

function formatKm(meters: number) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2).replace(".", ",")} km`;
  return `${meters.toFixed(0)} m`;
}

// ─── Componentes de status ─────────────────────────────────────────────────────

function ComDot({ status }: { status: string | null }) {
  const t = (status || "").toUpperCase();
  const map: Record<string, [string, string]> = {
    ONLINE: ["#16a34a", "ONLINE"],
    OFFLINE: ["#dc2626", "OFFLINE"],
    SINCRONIZANDO: ["#d97706", "SYNC"],
  };
  const [color, label] = map[t] ?? ["#9ca3af", "—"];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "2px 8px",
        borderRadius: 999,
        background: color + "18",
        border: `1px solid ${color}40`,
        fontSize: 11,
        fontWeight: 700,
        color,
        letterSpacing: "0.04em",
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          boxShadow: t === "ONLINE" ? `0 0 0 2px ${color}40` : undefined,
        }}
      />
      {label}
    </span>
  );
}

function OpBadge({ status }: { status: string | null }) {
  const t = (status || "").toUpperCase();
  const map: Record<string, [string, string]> = {
    DESLOCANDO: ["#16a34a", "DESLOCANDO"],
    PARADO: ["#dc2626", "PARADO"],
    DESLIGADO: ["#6b7280", "DESLIGADO"],
  };
  const [color, label] = map[t] ?? ["#a855f7", t || "—"];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 700,
        color,
        background: color + "14",
        letterSpacing: "0.03em",
      }}
    >
      {label}
    </span>
  );
}

// ─── Card de Equipamento ───────────────────────────────────────────────────────

interface EquipStats {
  device: DeviceRow;
  segs: IntervalRow[];
  secDesloc: number;
  secParado: number;
  kmTotal: number;
  primeiraIgnicao: string | null;
  latest: LatestRow | undefined;
}

function EquipCard({ stats }: { stats: EquipStats }) {
  const { device, segs, secDesloc, secParado, kmTotal, primeiraIgnicao, latest } = stats;

  const nome = device.codigo_equipamento || device.placa || device.pos_equip_id;
  const placa = device.placa || "—";
  const ligado = secDesloc + secParado > 0;
  const tempoLigado = secDesloc + secParado;
  const lastSeen = latest?.data_ts ? new Date(latest.data_ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        transition: "box-shadow 0.15s",
        borderLeft: `4px solid ${ligado ? "#16a34a" : "#d1d5db"}`,
      }}
    >
      {/* Cabeçalho */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#111827", letterSpacing: "-0.01em" }}>
            {nome}
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{placa}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <ComDot status={latest?.status_comunicacao ?? null} />
          <OpBadge status={latest?.status_operacao ?? null} />
        </div>
      </div>

      {/* Métricas */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          paddingTop: 6,
          borderTop: "1px solid #f3f4f6",
        }}
      >
        <Metric
          label="Ligou às"
          value={primeiraIgnicao ?? "—"}
          color="#2563eb"
          icon="🕐"
        />
        <Metric
          label="KM Rodado"
          value={ligado ? formatKm(kmTotal) : "—"}
          color="#16a34a"
          icon="📍"
        />
        <Metric
          label="Tempo Ligado"
          value={ligado ? secondsToHHMM(tempoLigado) : "—"}
          color="#d97706"
          icon="⏱"
        />
      </div>

      {/* Barra de atividade mini */}
      {segs.length > 0 && (
        <ActivityBar segs={segs} />
      )}

      {/* Rodapé */}
      {lastSeen && (
        <div style={{ fontSize: 11, color: "#9ca3af", textAlign: "right", marginTop: -4 }}>
          Última pos.: {lastSeen}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, color, icon }: { label: string; value: string; color: string; icon: string }) {
  return (
    <div style={{ background: "#f9fafb", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

function ActivityBar({ segs }: { segs: IntervalRow[] }) {
  const sorted = [...segs].sort((a, b) => new Date(a.ts_start).getTime() - new Date(b.ts_start).getTime());
  const dayStart = new Date(sorted[0].ts_start);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);
  const total = dayEnd.getTime() - dayStart.getTime();

  const colorMap: Record<string, string> = {
    DESLOCANDO: "#16a34a",
    PARADO: "#ef4444",
    DESLIGADO: "#e5e7eb",
    DESCONHECIDO: "#a855f7",
  };

  return (
    <div style={{ position: "relative", height: 6, borderRadius: 4, background: "#f3f4f6", overflow: "hidden" }}>
      {sorted.map((seg, i) => {
        const s = Math.max(new Date(seg.ts_start).getTime(), dayStart.getTime());
        const e = Math.min(new Date(seg.ts_end).getTime(), dayEnd.getTime());
        if (e <= s) return null;
        const left = ((s - dayStart.getTime()) / total) * 100;
        const width = ((e - s) / total) * 100;
        const color = colorMap[(seg.status_operacao || "").toUpperCase()] ?? "#a855f7";
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: 0, bottom: 0,
              left: `${left}%`,
              width: `${Math.max(width, 0.3)}%`,
              background: color,
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Página Principal ──────────────────────────────────────────────────────────

export default function GPAsfaltoMovimentosPage() {
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }, []);

  const [dateStr, setDateStr] = useState(todayStr);
  const [obraFiltro, setObraFiltro] = useState<string>("TODAS");
  const [obras, setObras] = useState<string[]>(["TODAS"]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [intervals, setIntervals] = useState<IntervalRow[]>([]);
  const [latest, setLatest] = useState<Record<string, LatestRow>>({});
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const { w0, w1 } = useMemo(() => getWindow(dateStr), [dateStr]);

  async function loadObras() {
    const { data, error } = await supabase.from("obras").select("obra").eq("ativo", true).order("obra");
    if (!error) {
      const list = ["TODAS", ...((data ?? []) as ObraRow[]).map((x) => x.obra)];
      setObras(list);
      if (!list.includes(obraFiltro)) setObraFiltro("TODAS");
    }
  }

  async function loadDevices() {
    const { data, error } = await supabase
      .from("sigasul_device_map")
      .select("pos_equip_id,codigo_equipamento,placa,ativo")
      .eq("ativo", true)
      .order("codigo_equipamento");
    if (!error) setDevices((data ?? []) as unknown as DeviceRow[]);
  }

  async function fetchIntervalsPaged() {
    const pageSize = 1000;
    const w0iso = w0.toISOString();
    const w1iso = w1.toISOString();
    let out: IntervalRow[] = [];

    for (let from = 0; from < 50000; from += pageSize) {
      let q = supabase
        .from("sigasul_intervals")
        .select("pos_equip_id,codigo_equipamento,pos_placa,obra,ts_start,ts_end,dt_sec,status_operacao")
        .lte("ts_start", w1iso)
        .gte("ts_end", w0iso)
        .order("ts_start", { ascending: true })
        .range(from, from + pageSize - 1);

      if (obraFiltro !== "TODAS") q = q.eq("obra", obraFiltro);

      const { data, error } = await q;
      if (error) throw error;

      const batch = (data ?? []) as unknown as IntervalRow[];
      out = out.concat(batch);
      if (batch.length < pageSize) break;
    }

    return out;
  }

  async function load() {
    setErr(null);
    setLoading(true);

    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setLoading(false);
      setErr("Sem sessão. Faça login no app.");
      return;
    }

    try {
      const rows = await fetchIntervalsPaged();
      setIntervals(rows);
    } catch (e: any) {
      setIntervals([]);
      setErr(e?.message || String(e));
      setLoading(false);
      return;
    }

    const ids = devices.map((d) => d.pos_equip_id).filter(Boolean);
    if (ids.length > 0) {
      const { data: latestRows, error } = await supabase
        .from("sigasul_dashboard_latest")
        .select("pos_equip_id,status_comunicacao,status_operacao,obra_final,data_ts")
        .in("pos_equip_id", ids);

      if (!error) {
        const map: Record<string, LatestRow> = {};
        for (const r of (latestRows ?? []) as unknown as LatestRow[]) map[r.pos_equip_id] = r;
        setLatest(map);
      }
    }

    setLastUpdate(new Date());
    setLoading(false);
  }

  useEffect(() => {
    loadObras();
    loadDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (devices.length === 0) return;
    load();
    if (dateStr !== todayStr) return;
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr, obraFiltro, devices.length, todayStr]);

  // ─── Cálculo por equipamento ──────────────────────────────────────────────

  const byEquip = useMemo(() => {
    const m = new Map<string, IntervalRow[]>();
    for (const r of intervals) {
      if (!m.has(r.pos_equip_id)) m.set(r.pos_equip_id, []);
      m.get(r.pos_equip_id)!.push(r);
    }
    return m;
  }, [intervals]);

  const equipStats: EquipStats[] = useMemo(() => {
    return devices
      .map((d) => {
        const segs = byEquip.get(d.pos_equip_id) ?? [];
        let secDesloc = 0;
        let secParado = 0;
        let kmTotal = 0;
        let primeiraIgnicao: string | null = null;

        // Ordena por ts_start
        const sorted = [...segs].sort(
          (a, b) => new Date(a.ts_start).getTime() - new Date(b.ts_start).getTime()
        );

        for (const x of sorted) {
          const sMs = new Date(x.ts_start).getTime();
          const eMs = new Date(x.ts_end).getTime();
          const start = Math.max(sMs, w0.getTime());
          const end = Math.min(eMs, w1.getTime());
          if (end <= start) continue;

          const sec = Math.round((end - start) / 1000);
          const st = (x.status_operacao || "").toUpperCase();

          if (st === "DESLOCANDO") {
            secDesloc += sec;
            // Distância proporcional (usando dt_sec original)
            const totalSec = Math.max(1, (eMs - sMs) / 1000);
            kmTotal += (x.dt_sec > 0 ? (sec / totalSec) : 0);
          }
          if (st === "PARADO") secParado += sec;

          // Primeira vez ligado no dia
          if ((st === "DESLOCANDO" || st === "PARADO") && !primeiraIgnicao) {
            primeiraIgnicao = new Date(x.ts_start).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            });
          }
        }

        // KM vem do campo dt_sec quando status=DESLOCANDO (distância em metros por segundo?)
        // Ou soma direta de dt_sec filtrado
        const kmMetros = sorted
          .filter((x) => (x.status_operacao || "").toUpperCase() === "DESLOCANDO")
          .reduce((acc, x) => {
            const sMs = new Date(x.ts_start).getTime();
            const eMs = new Date(x.ts_end).getTime();
            const start = Math.max(sMs, w0.getTime());
            const end = Math.min(eMs, w1.getTime());
            if (end <= start) return acc;
            const frac = (end - start) / Math.max(1, eMs - sMs);
            return acc + x.dt_sec * frac;
          }, 0);

        return {
          device: d,
          segs: sorted,
          secDesloc,
          secParado,
          kmTotal: kmMetros,
          primeiraIgnicao,
          latest: latest[d.pos_equip_id],
        };
      })
      .sort((a, b) =>
        String(a.device.codigo_equipamento ?? a.device.placa ?? "").localeCompare(
          String(b.device.codigo_equipamento ?? b.device.placa ?? ""),
          "pt-BR"
        )
      );
  }, [devices, byEquip, w0, w1, latest]);

  // ─── Agrupar por obra ─────────────────────────────────────────────────────

  const obraGroups = useMemo(() => {
    if (obraFiltro !== "TODAS") {
      return new Map([[obraFiltro, equipStats]]);
    }

    const map = new Map<string, EquipStats[]>();

    for (const stat of equipStats) {
      // Obra do latest ou do primeiro intervalo
      const obraName =
        stat.latest?.obra_final ||
        stat.segs[0]?.obra ||
        "SEM OBRA";
      if (!map.has(obraName)) map.set(obraName, []);
      map.get(obraName)!.push(stat);
    }

    // Ordena: obras com nome antes de "SEM OBRA"
    const sorted = new Map(
      [...map.entries()].sort(([a], [b]) => {
        if (a === "SEM OBRA") return 1;
        if (b === "SEM OBRA") return -1;
        return a.localeCompare(b, "pt-BR");
      })
    );
    return sorted;
  }, [equipStats, obraFiltro]);

  // ─── Totais globais ───────────────────────────────────────────────────────

  const totals = useMemo(() => {
    const online = equipStats.filter(
      (e) => (e.latest?.status_comunicacao || "").toUpperCase() === "ONLINE"
    ).length;
    const ligados = equipStats.filter((e) => e.secDesloc + e.secParado > 0).length;
    const kmTotal = equipStats.reduce((a, e) => a + e.kmTotal, 0);
    return { online, ligados, total: equipStats.length, kmTotal };
  }, [equipStats]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const isToday = dateStr === todayStr;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f1f5f9",
        fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* ── Top Bar ── */}
      <div
        style={{
          background: "#0f172a",
          color: "white",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          position: "sticky",
          top: 0,
          zIndex: 100,
          borderBottom: "1px solid #1e293b",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg,#2563eb,#0ea5e9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
              fontSize: 13,
              letterSpacing: "-0.02em",
            }}
          >
            GP
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.02em", lineHeight: 1 }}>
              GP Asfalto — Monitoramento
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
              Frota em tempo real · {isToday ? "Hoje" : dateStr}
            </div>
          </div>
        </div>

        {/* Filtros */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="date"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "7px 10px",
              fontSize: 13,
              color: "white",
              cursor: "pointer",
            }}
          />
          <select
            value={obraFiltro}
            onChange={(e) => setObraFiltro(e.target.value)}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 8,
              padding: "7px 10px",
              fontSize: 13,
              color: "white",
              cursor: "pointer",
              minWidth: 140,
            }}
          >
            {obras.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <button
            onClick={load}
            disabled={loading}
            style={{
              background: loading ? "#1e293b" : "#2563eb",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 700,
              color: loading ? "#64748b" : "white",
              cursor: loading ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {loading ? "Atualizando…" : "↺ Atualizar"}
          </button>
        </div>
      </div>

      {/* ── Conteúdo ── */}
      <div style={{ padding: "20px 24px", maxWidth: 1400, margin: "0 auto" }}>

        {/* Erro */}
        {err && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 10,
              padding: "12px 16px",
              color: "#991b1b",
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            <strong>Erro ao carregar dados:</strong> {err}
          </div>
        )}

        {/* ── Cards de resumo ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <SummaryCard label="Total de Equipamentos" value={String(totals.total)} icon="🚛" color="#0f172a" />
          <SummaryCard label="Online agora" value={String(totals.online)} icon="📡" color="#2563eb" />
          <SummaryCard label="Trabalhando hoje" value={String(totals.ligados)} icon="⚙️" color="#16a34a" />
          <SummaryCard label="KM total da frota" value={formatKm(totals.kmTotal)} icon="🛣️" color="#d97706" />
        </div>

        {/* Legenda */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 16,
            fontSize: 12,
            color: "#6b7280",
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 700, color: "#374151" }}>Legenda:</span>
          {[
            ["#16a34a", "Deslocando"],
            ["#ef4444", "Parado (motor on)"],
            ["#e5e7eb", "Desligado"],
            ["#a855f7", "Desconhecido"],
          ].map(([color, label]) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: color,
                  display: "inline-block",
                  border: "1px solid #e5e7eb",
                }}
              />
              {label}
            </span>
          ))}
          {lastUpdate && (
            <span style={{ marginLeft: "auto" }}>
              Atualizado às {lastUpdate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              {isToday && " · auto-refresh 30s"}
            </span>
          )}
        </div>

        {/* ── Grupos por obra ── */}
        {loading && equipStats.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#9ca3af", fontSize: 15 }}>
            Carregando dados…
          </div>
        ) : (
          [...obraGroups.entries()].map(([obraName, stats]) => (
            <div key={obraName} style={{ marginBottom: 28 }}>
              {/* Cabeçalho da obra */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    width: 4,
                    height: 22,
                    borderRadius: 2,
                    background: obraName === "SEM OBRA" ? "#9ca3af" : "#2563eb",
                  }}
                />
                <h2
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 800,
                    color: "#0f172a",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {obraName}
                </h2>
                <span
                  style={{
                    fontSize: 12,
                    color: "#6b7280",
                    background: "#e5e7eb",
                    borderRadius: 20,
                    padding: "2px 8px",
                    fontWeight: 600,
                  }}
                >
                  {stats.length} equipamento{stats.length !== 1 ? "s" : ""}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: "#16a34a",
                    background: "#dcfce7",
                    borderRadius: 20,
                    padding: "2px 8px",
                    fontWeight: 600,
                  }}
                >
                  {stats.filter((s) => s.secDesloc + s.secParado > 0).length} trabalhando
                </span>
              </div>

              {/* Grid de cards */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 12,
                }}
              >
                {stats.map((s) => (
                  <EquipCard key={s.device.pos_equip_id} stats={s} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: "14px 16px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, marginBottom: 4 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 900, color, letterSpacing: "-0.03em", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}
