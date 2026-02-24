// FILE: app/sigasul/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

type Row = {
  pos_equip_id: string | null;
  codigo_equipamento: string | null;
  pos_placa: string | null;
  obra_final: string | null;

  gps_at: string | null;
  receb_at: string | null;
  ingested_at: string | null;

  pos_latitude: number | null;
  pos_longitude: number | null;

  pos_ignicao: boolean | null;
  pos_velocidade: number | null;
  pos_online: boolean | null;

  status: string;

  // novas colunas
  data_ts: string | null;
  data_age_min: number | null;
  ingest_lag_min: number | null;
  status_comunicacao: "ONLINE" | "OFFLINE" | "SINCRONIZANDO" | string;
  status_operacao: "DESLIGADO" | "DESLOCANDO" | "LIGADO_PARADO" | "DESCONHECIDO" | string;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function fmtDt(s: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("pt-BR");
}

function Badge({ text }: { text: string }) {
  const t = (text || "").toUpperCase();
  const cls =
    t === "OFFLINE"
      ? "bg-red-100 text-red-800 border-red-200"
      : t === "ONLINE"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : t === "SINCRONIZANDO"
      ? "bg-purple-100 text-purple-800 border-purple-200"
      : t === "LIGADO_PARADO"
      ? "bg-amber-100 text-amber-900 border-amber-200"
      : t === "DESLOCANDO"
      ? "bg-blue-100 text-blue-800 border-blue-200"
      : t === "DESLIGADO"
      ? "bg-slate-100 text-slate-800 border-slate-200"
      : "bg-zinc-100 text-zinc-800 border-zinc-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {text}
    </span>
  );
}

export default function SigaSulDashboardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [obraFilter, setObraFilter] = useState<string>("TODAS");
  const [comFilter, setComFilter] = useState<string>("TODOS");
  const [opFilter, setOpFilter] = useState<string>("TODOS");
  const [search, setSearch] = useState("");
  const [onlyIdle, setOnlyIdle] = useState(false); // parado ligado ONLINE

  async function load() {
    setErr(null);
    setLoading(true);

    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setLoading(false);
      setErr("Sem sessão do Supabase (faça login no app para ler as views protegidas por RLS).");
      return;
    }

    const { data, error } = await supabase
      .from("sigasul_dashboard_latest")
      .select(
        [
          "pos_equip_id",
          "codigo_equipamento",
          "pos_placa",
          "obra_final",
          "gps_at",
          "receb_at",
          "ingested_at",
          "pos_latitude",
          "pos_longitude",
          "pos_ignicao",
          "pos_velocidade",
          "pos_online",
          "status",
          "data_ts",
          "data_age_min",
          "ingest_lag_min",
          "status_comunicacao",
          "status_operacao",
        ].join(",")
      );

    if (error) {
      setErr(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const obras = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(((r.obra_final || "SEM_OBRA") + "").trim());
    return ["TODAS", ...Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"))];
  }, [rows]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) {
      const key = `${r.status_comunicacao || "?"}__${r.status_operacao || "?"}`;
      c[key] = (c[key] || 0) + 1;
    }
    return c;
  }, [rows]);

  const k = (com: string, op: string) => `${com}__${op}`;

  const totals = useMemo(() => {
    const total = rows.length;
    const online = rows.filter((r) => (r.status_comunicacao || "") === "ONLINE").length;
    const offline = rows.filter((r) => (r.status_comunicacao || "") === "OFFLINE").length;
    const sync = rows.filter((r) => (r.status_comunicacao || "") === "SINCRONIZANDO").length;
    const idleOnline = rows.filter((r) => r.status_comunicacao === "ONLINE" && r.status_operacao === "LIGADO_PARADO").length;
    return { total, online, offline, sync, idleOnline };
  }, [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows
      .map((r) => ({
        ...r,
        obra_final: ((r.obra_final || "SEM_OBRA") + "").trim(),
        codigo_equipamento: ((r.codigo_equipamento || r.pos_placa || r.pos_equip_id || "") + "").trim(),
      }))
      .filter((r) => (obraFilter === "TODAS" ? true : r.obra_final === obraFilter))
      .filter((r) => (comFilter === "TODOS" ? true : (r.status_comunicacao || "") === comFilter))
      .filter((r) => (opFilter === "TODOS" ? true : (r.status_operacao || "") === opFilter))
      .filter((r) => (onlyIdle ? r.status_comunicacao === "ONLINE" && r.status_operacao === "LIGADO_PARADO" : true))
      .filter((r) => {
        if (!s) return true;
        return (
          (r.codigo_equipamento || "").toLowerCase().includes(s) ||
          (r.pos_placa || "").toLowerCase().includes(s) ||
          (r.pos_equip_id || "").toLowerCase().includes(s) ||
          (r.obra_final || "").toLowerCase().includes(s)
        );
      })
      .sort((a, b) => (a.obra_final || "").localeCompare(b.obra_final || "", "pt-BR"));
  }, [rows, obraFilter, comFilter, opFilter, search, onlyIdle]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">SigaSul — Tempo real (por obra)</h1>
        <div className="text-sm text-zinc-600">
          Comunicação e operação separadas (evita “offline + ignição ligada”). Fonte:{" "}
          <code className="px-1 rounded bg-zinc-100">sigasul_dashboard_latest</code>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-semibold">Erro</div>
          <div>{err}</div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <div className="rounded-lg border p-3">
          <div className="text-xs text-zinc-500">TOTAL</div>
          <div className="text-lg font-bold">{totals.total}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-zinc-500">ONLINE</div>
          <div className="text-lg font-bold">{totals.online}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-zinc-500">OFFLINE</div>
          <div className="text-lg font-bold">{totals.offline}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-zinc-500">SINCRONIZANDO</div>
          <div className="text-lg font-bold">{totals.sync}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-zinc-500">PARADO LIGADO (ONLINE)</div>
          <div className="text-lg font-bold">{totals.idleOnline}</div>
        </div>
        <div className="rounded-lg border p-3">
          <div className="text-xs text-zinc-500">DESLOCANDO (ONLINE)</div>
          <div className="text-lg font-bold">{counts[k("ONLINE", "DESLOCANDO")] || 0}</div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-2 md:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-600">Obra</label>
          <select className="border rounded px-2 py-2 text-sm" value={obraFilter} onChange={(e) => setObraFilter(e.target.value)}>
            {obras.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-600">Comunicação</label>
          <select className="border rounded px-2 py-2 text-sm" value={comFilter} onChange={(e) => setComFilter(e.target.value)}>
            <option value="TODOS">TODOS</option>
            <option value="ONLINE">ONLINE</option>
            <option value="OFFLINE">OFFLINE</option>
            <option value="SINCRONIZANDO">SINCRONIZANDO</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-600">Operação</label>
          <select className="border rounded px-2 py-2 text-sm" value={opFilter} onChange={(e) => setOpFilter(e.target.value)}>
            <option value="TODOS">TODOS</option>
            <option value="DESLIGADO">DESLIGADO</option>
            <option value="DESLOCANDO">DESLOCANDO</option>
            <option value="LIGADO_PARADO">LIGADO_PARADO</option>
            <option value="DESCONHECIDO">DESCONHECIDO</option>
          </select>
        </div>

        <div className="flex items-center gap-2 border rounded px-3 py-2">
          <input id="onlyIdle" type="checkbox" checked={onlyIdle} onChange={(e) => setOnlyIdle(e.target.checked)} />
          <label htmlFor="onlyIdle" className="text-sm">
            só parado ligado (online)
          </label>
        </div>

        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs text-zinc-600">Buscar (equip/placa/obra)</label>
          <input className="border rounded px-2 py-2 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ex: CB-08, ANEL, NKZ..." />
        </div>

        <button className="border rounded px-3 py-2 text-sm font-semibold" onClick={load} disabled={loading}>
          {loading ? "Atualizando..." : "Atualizar agora"}
        </button>
      </div>

      <div className="overflow-auto rounded-lg border">
        <table className="min-w-[1200px] w-full text-sm">
          <thead className="bg-zinc-50">
            <tr className="text-left">
              <th className="p-3">Obra</th>
              <th className="p-3">Equipamento</th>
              <th className="p-3">Placa</th>
              <th className="p-3">Comunicação</th>
              <th className="p-3">Operação</th>
              <th className="p-3">Vel (km/h)</th>
              <th className="p-3">Ignição (última)</th>
              <th className="p-3">Online (última)</th>
              <th className="p-3">Última posição</th>
              <th className="p-3">Idade (min)</th>
              <th className="p-3">Lag ingest (min)</th>
              <th className="p-3">GPS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.pos_equip_id || Math.random()} className="border-t">
                <td className="p-3 font-semibold">{r.obra_final || "SEM_OBRA"}</td>
                <td className="p-3">{r.codigo_equipamento || "-"}</td>
                <td className="p-3">{r.pos_placa || "-"}</td>
                <td className="p-3">
                  <Badge text={r.status_comunicacao || "?"} />
                </td>
                <td className="p-3">
                  <Badge text={r.status_operacao || "?"} />
                </td>
                <td className="p-3">{r.pos_velocidade ?? "-"}</td>
                <td className="p-3">{r.pos_ignicao === null ? "-" : r.pos_ignicao ? "Ligado" : "Desligado"}</td>
                <td className="p-3">{r.pos_online === null ? "-" : r.pos_online ? "Sim" : "Não"}</td>
                <td className="p-3">{fmtDt(r.data_ts || r.receb_at || r.gps_at || r.ingested_at)}</td>
                <td className="p-3">{r.data_age_min == null ? "-" : Math.round(r.data_age_min)}</td>
                <td className="p-3">{r.ingest_lag_min == null ? "-" : Math.round(r.ingest_lag_min)}</td>
                <td className="p-3">
                  {r.pos_latitude && r.pos_longitude ? `${r.pos_latitude.toFixed(5)}, ${r.pos_longitude.toFixed(5)}` : "-"}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td className="p-3 text-zinc-500" colSpan={12}>
                  {loading ? "Carregando..." : "Nenhum registro com os filtros atuais."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-zinc-500">
        * Ignição/Online são “da última leitura”; operação só é confiável quando comunicação está ONLINE.
      </div>
    </div>
  );
}
