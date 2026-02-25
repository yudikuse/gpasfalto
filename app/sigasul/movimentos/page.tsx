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

function minutesToHHMM(mins: number) {
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${pad2(h)}:${pad2(r)}`;
}

function getDayBounds(dateStr: string) {
  // dateStr: "YYYY-MM-DD" (local)
  const [y, mo, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const start = new Date(y, mo - 1, d, 0, 0, 0, 0);
  const end = new Date(y, mo - 1, d, 23, 59, 59, 999);
  return { start, end };
}

function getWindow(dateStr: string, hhStart = 6, hhEnd = 19) {
  const [y, mo, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const w0 = new Date(y, mo - 1, d, hhStart, 0, 0, 0);
  const w1 = new Date(y, mo - 1, d, hhEnd, 0, 0, 0);
  return { w0, w1 };
}

function statusColorCls(s: string) {
  const t = (s || "").toUpperCase();
  if (t === "DESLOCANDO") return "bg-emerald-500";
  if (t === "LIGADO_PARADO") return "bg-red-500";
  if (t === "DESLIGADO") return "bg-zinc-300";
  return "bg-purple-500";
}

function dotCls(com: string | null) {
  const t = (com || "").toUpperCase();
  if (t === "ONLINE") return "bg-emerald-500";
  if (t === "OFFLINE") return "bg-red-500";
  if (t === "SINCRONIZANDO") return "bg-purple-500";
  return "bg-zinc-400";
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

    const { w0, w1 } = getWindow(dateStr, 6, 19);

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
    const t = setInterval(load, 30000); // 30s (intervalos atualizam a cada 5 min, mas mantém vivo)
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr, obra]);

  const { w0, w1 } = useMemo(() => getWindow(dateStr, 6, 19), [dateStr]);
  const windowMinutes = useMemo(() => Math.max(1, (w1.getTime() - w0.getTime()) / 60000), [w0, w1]);

  const grouped = useMemo(() => {
    const byEquip = new Map<string, IntervalRow[]>();
    for (const r of intervals) {
      if (!byEquip.has(r.pos_equip_id)) byEquip.set(r.pos_equip_id, []);
      byEquip.get(r.pos_equip_id)!.push(r);
    }
    return Array.from(byEquip.entries()).map(([pos_equip_id, rows]) => {
      rows.sort((a, b) => new Date(a.ts_start).getTime() - new Date(b.ts_start).getTime());
      const codigo = rows[0]?.codigo_equipamento || rows[0]?.pos_placa || pos_equip_id;
      const placa = rows[0]?.pos_placa || "-";

      let secDesloc = 0;
      let secIdle = 0;
      let secOff = 0;
      let secUnk = 0;

      for (const x of rows) {
        const s = (x.status_operacao || "").toUpperCase();
        if (s === "DESLOCANDO") secDesloc += x.dt_sec;
        else if (s === "LIGADO_PARADO") secIdle += x.dt_sec;
        else if (s === "DESLIGADO") secOff += x.dt_sec;
        else secUnk += x.dt_sec;
      }

      return {
        pos_equip_id,
        codigo,
        placa,
        rows,
        secDesloc,
        secIdle,
        secOff,
        secUnk,
      };
    });
  }, [intervals]);

  const ticks = useMemo(() => {
    const t: { label: string; leftPct: number }[] = [];
    for (let hh = 6; hh <= 19; hh++) {
      const d = new Date(w0);
      d.setHours(hh, 0, 0, 0);
      const mins = (d.getTime() - w0.getTime()) / 60000;
      const leftPct = (mins / windowMinutes) * 100;
      t.push({ label: `${pad2(hh)}:00`, leftPct });
      if (hh !== 19) {
        const d2 = new Date(w0);
        d2.setHours(hh, 30, 0, 0);
        const mins2 = (d2.getTime() - w0.getTime()) / 60000;
        const leftPct2 = (mins2 / windowMinutes) * 100;
        t.push({ label: `${pad2(hh)}:30`, leftPct: leftPct2 });
      }
    }
    return t;
  }, [w0, windowMinutes]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">SigaSul — Movimentos (Timeline)</h1>
        <div className="text-sm text-zinc-600">
          Verde = deslocando (proxy trabalho) · Vermelho = parado ligado · Cinza = desligado · Roxo = desconhecido
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-semibold">Erro</div>
          <div>{err}</div>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-2 md:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-600">Data</label>
          <input
            type="date"
            className="border rounded px-2 py-2 text-sm"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-600">Obra</label>
          <select className="border rounded px-2 py-2 text-sm" value={obra} onChange={(e) => setObra(e.target.value)}>
            {obras.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <button className="border rounded px-3 py-2 text-sm font-semibold" onClick={load} disabled={loading}>
          {loading ? "Atualizando..." : "Atualizar agora"}
        </button>
      </div>

      <div className="overflow-auto rounded-lg border">
        <div className="min-w-[1250px]">
          {/* Header com ticks */}
          <div className="grid grid-cols-[220px_1fr] border-b bg-zinc-50">
            <div className="p-3 text-xs font-semibold text-zinc-600">Equipamento</div>
            <div className="p-3">
              <div className="relative h-6">
                {ticks.map((t) => (
                  <div key={t.label} className="absolute top-0" style={{ left: `${t.leftPct}%` }}>
                    <div className="text-[10px] text-zinc-500 -translate-x-1/2">{t.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Linhas */}
          {grouped.map((g) => {
            const l = latest[g.pos_equip_id];
            const dot = dotCls(l?.status_comunicacao || null);

            return (
              <div key={g.pos_equip_id} className="grid grid-cols-[220px_1fr] border-b">
                <div className="p-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
                    <div className="font-semibold text-sm">{g.codigo}</div>
                  </div>
                  <div className="text-xs text-zinc-600 mt-1">{g.placa}</div>
                  <div className="text-xs text-zinc-600 mt-2">
                    <span className="font-semibold">Desloc:</span> {minutesToHHMM(g.secDesloc / 60)}{" "}
                    <span className="mx-1">·</span>
                    <span className="font-semibold">Parado:</span> {minutesToHHMM(g.secIdle / 60)}
                  </div>
                </div>

                <div className="p-3">
                  <div className="relative h-8 rounded bg-zinc-100 overflow-hidden">
                    {/* linhas verticais a cada 30 min */}
                    {ticks.map((t) => (
                      <div
                        key={t.label}
                        className="absolute top-0 bottom-0 w-px bg-zinc-200"
                        style={{ left: `${t.leftPct}%` }}
                      />
                    ))}

                    {/* segmentos */}
                    {g.rows.map((r, idx) => {
                      const s = new Date(r.ts_start);
                      const e = new Date(r.ts_end);

                      // clamp na janela
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
                          className={`absolute top-0 bottom-0 ${statusColorCls(r.status_operacao)}`}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          title={`${r.status_operacao} | ${fmt(new Date(r.ts_start))} → ${fmt(new Date(r.ts_end))} | ${r.obra ?? "SEM_OBRA"}`}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}

          {grouped.length === 0 && (
            <div className="p-4 text-sm text-zinc-600">{loading ? "Carregando..." : "Sem dados no período/obra selecionados."}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function fmt(d: Date) {
  return d.toLocaleString("pt-BR");
}
