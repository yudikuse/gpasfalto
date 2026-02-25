// FILE: app/sigasul/movimentos/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type IntervalRow = {
  pos_equip_id: string;
  codigo_equipamento: string | null;
  pos_placa: string | null;
  obra: string | null;
  ts_start: string;
  ts_end: string;
  dt_sec: number;
  status_operacao: "DESLIGADO" | "DESLOCANDO" | "LIGADO_PARADO" | "DESCONHECIDO" | string;
};

type LatestRow = {
  pos_equip_id: string;
  status_comunicacao: string | null;
  status_operacao: string | null;
  obra_final: string | null;
  data_ts: string | null;
};

type ObraRow = { obra: string };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function fmtBR(d: Date) {
  return d.toLocaleString("pt-BR");
}

function minutesToHHMM(mins: number) {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${pad2(h)}:${pad2(r)}`;
}

function getWindow(dateStr: string, hhStart = 6, hhEnd = 19) {
  const [y, mo, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const w0 = new Date(y, mo - 1, d, hhStart, 0, 0, 0);
  const w1 = new Date(y, mo - 1, d, hhEnd, 0, 0, 0);
  return { w0, w1 };
}

function statusColor(status: string) {
  const t = (status || "").toUpperCase();
  if (t === "DESLOCANDO") return "#22c55e"; // verde
  if (t === "LIGADO_PARADO") return "#ef4444"; // vermelho
  if (t === "DESLIGADO") return "#d4d4d8"; // cinza
  return "#a855f7"; // roxo (desconhecido)
}

function dotColor(com: string | null) {
  const t = (com || "").toUpperCase();
  if (t === "ONLINE") return "#22c55e";
  if (t === "OFFLINE") return "#ef4444";
  if (t === "SINCRONIZANDO") return "#a855f7";
  return "#a1a1aa";
}

export default function SigaSulMovimentosPage() {
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }, []);

  const [dateStr, setDateStr] = useState(todayStr);
  const [obra, setObra] = useState<string>("TODAS");
  const [obras, setObras] = useState<string[]>(["TODAS"]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [intervals, setIntervals] = useState<IntervalRow[]>([]);
  const [latest, setLatest] = useState<Record<string, LatestRow>>({});

  const { w0, w1 } = useMemo(() => getWindow(dateStr, 6, 19), [dateStr]);
  const windowMinutes = useMemo(() => Math.max(1, (w1.getTime() - w0.getTime()) / 60000), [w0, w1]);

  async function loadObras() {
    const { data, error } = await supabase.from("obras").select("obra").eq("ativo", true).order("obra");
    if (!error) {
      const list = ["TODAS", ...((data ?? []) as ObraRow[]).map((x) => x.obra)];
      setObras(list);
      if (!list.includes(obra)) setObra("TODAS");
    }
  }

  async function load() {
    setErr(null);
    setLoading(true);

    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setLoading(false);
      setErr("Sem sessão do Supabase (faça login no app).");
      return;
    }

    let q = supabase
      .from("sigasul_intervals")
      .select("pos_equip_id,codigo_equipamento,pos_placa,obra,ts_start,ts_end,dt_sec,status_operacao")
      .gte("ts_start", w0.toISOString())
      .lte("ts_start", w1.toISOString())
      .order("codigo_equipamento", { ascending: true })
      .order("ts_start", { ascending: true });

    if (obra !== "TODAS") q = q.eq("obra", obra);

    const { data, error } = await q;
    if (error) {
      setIntervals([]);
      setLatest({});
      setErr(error.message);
      setLoading(false);
      return;
    }

    const rows = ((data ?? []) as unknown) as IntervalRow[];
    setIntervals(rows);

    const ids = Array.from(new Set(rows.map((r) => r.pos_equip_id).filter(Boolean)));
    if (ids.length === 0) {
      setLatest({});
      setLoading(false);
      return;
    }

    const { data: latestRows, error: latestErr } = await supabase
      .from("sigasul_dashboard_latest")
      .select("pos_equip_id,status_comunicacao,status_operacao,obra_final,data_ts")
      .in("pos_equip_id", ids);

    if (latestErr) {
      setLatest({});
    } else {
      const map: Record<string, LatestRow> = {};
      for (const r of ((latestRows ?? []) as unknown) as LatestRow[]) {
        map[r.pos_equip_id] = r;
      }
      setLatest(map);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadObras();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr, obra]);

  const ticks = useMemo(() => {
    // linhas a cada 30 min, label só a cada 1h (pra não poluir)
    const out: { mins: number; label: string | null }[] = [];
    for (let hh = 6; hh <= 19; hh++) {
      const d0 = new Date(w0);
      d0.setHours(hh, 0, 0, 0);
      out.push({ mins: (d0.getTime() - w0.getTime()) / 60000, label: `${pad2(hh)}:00` });

      if (hh !== 19) {
        const d1 = new Date(w0);
        d1.setHours(hh, 30, 0, 0);
        out.push({ mins: (d1.getTime() - w0.getTime()) / 60000, label: null });
      }
    }
    return out;
  }, [w0]);

  const grouped = useMemo(() => {
    const byEquip = new Map<string, IntervalRow[]>();
    for (const r of intervals) {
      if (!byEquip.has(r.pos_equip_id)) byEquip.set(r.pos_equip_id, []);
      byEquip.get(r.pos_equip_id)!.push(r);
    }

    return Array.from(byEquip.entries())
      .map(([pos_equip_id, rows]) => {
        rows.sort((a, b) => new Date(a.ts_start).getTime() - new Date(b.ts_start).getTime());
        const codigo = rows[0]?.codigo_equipamento || rows[0]?.pos_placa || pos_equip_id;
        const placa = rows[0]?.pos_placa || "-";

        let secDesloc = 0;
        let secParado = 0;

        for (const x of rows) {
          const s = (x.status_operacao || "").toUpperCase();
          if (s === "DESLOCANDO") secDesloc += x.dt_sec;
          if (s === "LIGADO_PARADO") secParado += x.dt_sec;
        }

        return { pos_equip_id, codigo, placa, rows, secDesloc, secParado };
      })
      .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), "pt-BR"));
  }, [intervals]);

  const styles: Record<string, React.CSSProperties> = {
    page: { padding: 20, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" },
    h1: { fontSize: 26, fontWeight: 800, margin: "0 0 6px 0" },
    sub: { fontSize: 13, color: "#52525b", marginBottom: 12 },
    controls: { display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end", marginBottom: 12 },
    label: { fontSize: 12, color: "#52525b", marginBottom: 4 },
    input: { border: "1px solid #d4d4d8", borderRadius: 8, padding: "8px 10px", fontSize: 14, background: "white" },
    btn: { border: "1px solid #d4d4d8", borderRadius: 8, padding: "9px 12px", fontSize: 14, fontWeight: 700, background: "white", cursor: "pointer" },
    box: { border: "1px solid #e4e4e7", borderRadius: 12, overflow: "auto", background: "white" },
    tableMin: { minWidth: 1400 },
    headerRow: { display: "grid", gridTemplateColumns: "260px 1fr", borderBottom: "1px solid #e4e4e7", background: "#fafafa" },
    cellLeft: { padding: 12, fontSize: 12, fontWeight: 800, color: "#52525b" },
    cellRight: { padding: 12 },
    tickArea: { position: "relative", height: 34 },
    tickLine: { position: "absolute", top: 0, bottom: 0, width: 1, background: "#e4e4e7" },
    tickLabel: { position: "absolute", top: 0, fontSize: 11, color: "#71717a", transform: "translateX(-50%)" },

    row: { display: "grid", gridTemplateColumns: "260px 1fr", borderBottom: "1px solid #f0f0f0" },
    leftPad: { padding: 12 },
    equipTitle: { display: "flex", gap: 8, alignItems: "center", fontWeight: 800, fontSize: 14 },
    dot: { width: 10, height: 10, borderRadius: 999, display: "inline-block" },
    placa: { fontSize: 12, color: "#52525b", marginTop: 4 },
    mini: { fontSize: 12, color: "#52525b", marginTop: 8 },

    barOuter: { position: "relative", height: 30, borderRadius: 10, background: "#f4f4f5", overflow: "hidden" },
    seg: { position: "absolute", top: 0, bottom: 0 },
  };

  return (
    <div style={styles.page}>
      <div>
        <div style={styles.h1}>SigaSul — Movimentos (Timeline)</div>
        <div style={styles.sub}>
          Verde = deslocando (proxy trabalho) · Vermelho = parado ligado · Cinza = desligado · Roxo = desconhecido
        </div>
      </div>

      {err && (
        <div style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#991b1b", padding: 12, borderRadius: 10, marginBottom: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Erro</div>
          <div>{err}</div>
        </div>
      )}

      <div style={styles.controls}>
        <div>
          <div style={styles.label}>Data</div>
          <input type="date" style={styles.input} value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
        </div>

        <div>
          <div style={styles.label}>Obra</div>
          <select style={styles.input as any} value={obra} onChange={(e) => setObra(e.target.value)}>
            {obras.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <button style={styles.btn} onClick={load} disabled={loading}>
          {loading ? "Atualizando..." : "Atualizar agora"}
        </button>
      </div>

      <div style={styles.box}>
        <div style={styles.tableMin}>
          {/* header */}
          <div style={styles.headerRow}>
            <div style={styles.cellLeft}>Equipamento</div>
            <div style={styles.cellRight}>
              <div style={styles.tickArea}>
                {ticks.map((t, idx) => {
                  const leftPct = (t.mins / windowMinutes) * 100;
                  return (
                    <div key={idx}>
                      <div style={{ ...styles.tickLine, left: `${leftPct}%` }} />
                      {t.label && <div style={{ ...styles.tickLabel, left: `${leftPct}%` }}>{t.label}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* rows */}
          {grouped.map((g) => {
            const l = latest[g.pos_equip_id];
            const dot = dotColor(l?.status_comunicacao || null);

            return (
              <div key={g.pos_equip_id} style={styles.row}>
                <div style={styles.leftPad}>
                  <div style={styles.equipTitle}>
                    <span style={{ ...styles.dot, background: dot }} />
                    <span>{g.codigo}</span>
                  </div>
                  <div style={styles.placa}>{g.placa}</div>
                  <div style={styles.mini}>
                    <b>Desloc:</b> {minutesToHHMM(g.secDesloc / 60)} <span style={{ margin: "0 6px" }}>·</span>
                    <b>Parado:</b> {minutesToHHMM(g.secParado / 60)}
                  </div>
                </div>

                <div style={{ padding: 12 }}>
                  <div style={styles.barOuter}>
                    {/* linhas verticais */}
                    {ticks.map((t, idx) => {
                      const leftPct = (t.mins / windowMinutes) * 100;
                      return <div key={idx} style={{ ...styles.tickLine, left: `${leftPct}%`, background: "#e5e7eb" }} />;
                    })}

                    {/* segmentos */}
                    {g.rows.map((r, idx) => {
                      const s = new Date(r.ts_start);
                      const e = new Date(r.ts_end);

                      const start = Math.max(s.getTime(), w0.getTime());
                      const end = Math.min(e.getTime(), w1.getTime());
                      if (end <= start) return null;

                      const startMin = (start - w0.getTime()) / 60000;
                      const durMin = (end - start) / 60000;

                      const leftPct = (startMin / windowMinutes) * 100;
                      const widthPct = (durMin / windowMinutes) * 100;

                      return (
                        <div
                          key={`${r.pos_equip_id}-${r.ts_start}-${idx}`}
                          style={{
                            ...styles.seg,
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            background: statusColor(r.status_operacao),
                          }}
                          title={`${r.status_operacao} | ${fmtBR(new Date(r.ts_start))} → ${fmtBR(new Date(r.ts_end))} | ${r.obra ?? "SEM_OBRA"}`}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}

          {grouped.length === 0 && (
            <div style={{ padding: 14, color: "#52525b" }}>
              {loading ? "Carregando..." : "Sem dados no período/obra selecionados."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
