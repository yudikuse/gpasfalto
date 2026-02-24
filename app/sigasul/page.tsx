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

  status: "OFFLINE" | "DESLIGADO" | "DESLOCANDO" | "LIGADO_PARADO" | "DESCONHECIDO" | string;
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

function minutesAgo(s: string | null) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  return Math.floor(diffMs / 60000);
}

function Badge({ status }: { status: Row["status"] }) {
  const cls =
    status === "OFFLINE"
      ? "bg-red-100 text-red-800 border-red-200"
      : status === "DESLIGADO"
      ? "bg-slate-100 text-slate-800 border-slate-200"
      : status === "DESLOCANDO"
      ? "bg-blue-100 text-blue-800 border-blue-200"
      : status === "LIGADO_PARADO"
      ? "bg-amber-100 text-amber-900 border-amber-200"
      : "bg-zinc-100 text-zinc-800 border-zinc-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {status}
    </span>
  );
}

export default function SigaSulDashboardPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [obraFilter, setObraFilter] = useState<string>("TODAS");
  const [statusFilter, setStatusFilter] = useState<string>("TODOS");
  const [search, setSearch] = useState("");

  async function load() {
    setErr(null);
    setLoading(true);

    // Se você usa Supabase Auth no app, isso ajuda a não ficar “silencioso” quando não está logado
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      setLoading(false);
      setErr("Sem sessão do Supabase (faça login no app para ler as views protegidas por RLS).");
      return;
    }

    const { data, error } = await supabase
      .from("sigasul_dashboard_latest")
      .select(
        "pos_equip_id,codigo_equipamento,pos_placa,obra_final,gps_at,receb_at,ingested_at,pos_latitude,pos_longitude,pos_ignicao,pos_velocidade,pos_online,status"
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
    const t = setInterval(load, 15000); // 15s (cron roda 1 min, mas aqui dá sensação de "ao vivo")
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const obras = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add((r.obra_final || "SEM_OBRA").trim());
    return ["TODAS", ...Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"))];
  }, [rows]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) {
      const k = r.status || "DESCONHECIDO";
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows
      .map((r) => ({
        ...r,
        obra_final: (r.obra_final || "SEM_OBRA").trim(),
        codigo_equipamento: (r.codigo_equipamento || r.pos_placa || r.pos_equip_id || "").trim(),
      }))
      .filter((r) => (obraFilter === "TODAS" ? true : r.obra_final === obraFilter))
      .filter((r) => (statusFilter === "TODOS" ? true : (r.status || "DESCONHECIDO") === statusFilter))
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
  }, [rows, obraFilter, statusFilter, search]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">SigaSul — Tempo real (por obra)</h1>
        <div className="text-sm text-zinc-600">
          Atualiza a cada 15s. Fonte: <code className="px-1 rounded bg-zinc-100">sigasul_dashboard_latest</code>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-semibold">Erro</div>
          <div>{err}</div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {["OFFLINE", "DESLIGADO", "DESLOCANDO", "LIGADO_PARADO", "DESCONHECIDO"].map((k) => (
          <div key={k} className="rounded-lg border p-3">
            <div className="text-xs text-zinc-500">{k}</div>
            <div className="text-lg font-bold">{counts[k] || 0}</div>
          </div>
        ))}
        <div className="rounded-lg border p-3">
          <div className="text-xs text-zinc-500">TOTAL</div>
          <div className="text-lg font-bold">{rows.length}</div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-2 md:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-600">Obra</label>
          <select
            className="border rounded px-2 py-2 text-sm"
            value={obraFilter}
            onChange={(e) => setObraFilter(e.target.value)}
          >
            {obras.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-600">Status</label>
          <select
            className="border rounded px-2 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="TODOS">TODOS</option>
            <option value="OFFLINE">OFFLINE</option>
            <option value="DESLIGADO">DESLIGADO</option>
            <option value="DESLOCANDO">DESLOCANDO</option>
            <option value="LIGADO_PARADO">LIGADO_PARADO</option>
            <option value="DESCONHECIDO">DESCONHECIDO</option>
          </select>
        </div>

        <div className="flex-1 flex flex-col gap-1">
          <label className="text-xs text-zinc-600">Buscar (equip/placa/obra)</label>
          <input
            className="border rounded px-2 py-2 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ex: NKZ-3976, ANEL, 161002..."
          />
        </div>

        <button
          className="border rounded px-3 py-2 text-sm font-semibold"
          onClick={load}
          disabled={loading}
        >
          {loading ? "Atualizando..." : "Atualizar agora"}
        </button>
      </div>

      <div className="overflow-auto rounded-lg border">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-zinc-50">
            <tr className="text-left">
              <th className="p-3">Obra</th>
              <th className="p-3">Equipamento</th>
              <th className="p-3">Placa</th>
              <th className="p-3">Status</th>
              <th className="p-3">Ignição</th>
              <th className="p-3">Vel (km/h)</th>
              <th className="p-3">Online</th>
              <th className="p-3">Última (receb)</th>
              <th className="p-3">Atraso</th>
              <th className="p-3">GPS</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const last = r.receb_at || r.gps_at || r.ingested_at;
              const mins = minutesAgo(last);
              return (
                <tr key={r.pos_equip_id || Math.random()} className="border-t">
                  <td className="p-3 font-semibold">{r.obra_final || "SEM_OBRA"}</td>
                  <td className="p-3">{r.codigo_equipamento || "-"}</td>
                  <td className="p-3">{r.pos_placa || "-"}</td>
                  <td className="p-3">
                    <Badge status={(r.status || "DESCONHECIDO") as any} />
                  </td>
                  <td className="p-3">{r.pos_ignicao === null ? "-" : r.pos_ignicao ? "Ligado" : "Desligado"}</td>
                  <td className="p-3">{r.pos_velocidade ?? "-"}</td>
                  <td className="p-3">{r.pos_online === null ? "-" : r.pos_online ? "Sim" : "Não"}</td>
                  <td className="p-3">{fmtDt(last)}</td>
                  <td className="p-3">{mins === null ? "-" : `${mins} min`}</td>
                  <td className="p-3">
                    {r.pos_latitude && r.pos_longitude ? `${r.pos_latitude.toFixed(5)}, ${r.pos_longitude.toFixed(5)}` : "-"}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td className="p-3 text-zinc-500" colSpan={10}>
                  {loading ? "Carregando..." : "Nenhum registro com os filtros atuais."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-zinc-500">
        Dica: por enquanto a obra vem do seu log manual. Quando você ativar “cercas/obras” no SigaSul, dá pra automatizar.
      </div>
    </div>
  );
}
