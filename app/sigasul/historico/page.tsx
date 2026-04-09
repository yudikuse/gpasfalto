"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const C = {
  bg: "#f4f5f7",
  surface: "#ffffff",
  border: "#e5e7eb",
  text: "#111827",
  textMid: "#4b5563",
  textMute: "#9ca3af",
  primary: "#4361ee",
  primarySoft: "#eef2ff",
  success: "#0d9f6e",
  successSoft: "#ecfdf5",
  danger: "#dc2626",
  dangerSoft: "#fef2f2",
  warning: "#d97706",
  warningSoft: "#fff7ed",
};

type TabKey = "dia" | "obra" | "equip" | "kombis";

type DailySummaryRow = {
  dia: string;
  codigo: string;
  placa: string | null;
  obra: string | null;
  primeira_ignicao: string | null;
  ultima_ignicao: string | null;
  km_metros: number | null;
  trabalhou: boolean | null;
  created_at: string | null;
};

type KbEventRow = {
  pos_equip_id: string | null;
  codigo_equipamento: string | null;
  evento_at: string | null;
  dia_brt: string;
  hora_brt: string | null;
  evento: string | null;
  obra: string | null;
  obra_origem: string | null;
  obra_destino: string | null;
};

type ObraDailyAgg = {
  dia: string;
  obra: string;
  equipamentos: number;
  trabalharam: number;
  parados: number;
  km: number;
};

type KbCell = {
  ent: string | null;
  sai: string | null;
};

type KbGridRow = {
  obra: string;
  byDay: Record<string, KbCell>;
};

type KbGridCard = {
  kombi: string;
  rows: KbGridRow[];
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayBRT() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return `${brt.getUTCFullYear()}-${pad2(brt.getUTCMonth() + 1)}-${pad2(brt.getUTCDate())}`;
}

function daysAgo(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fmtDateShort(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split("-");
  return `${d}/${m}`;
}

function fmtDateLabel(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split("-");
  const months = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${d}/${months[Number(m) - 1] ?? m}`;
}

function fmtHour(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return "—";
  }
}

function fmtKm(meters: number | null | undefined) {
  const v = Number(meters || 0);
  if (!v) return "—";
  return `${(v / 1000).toFixed(1).replace(".", ",")} km`;
}

function toNumber(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function sortObra(a: string, b: string) {
  return a.localeCompare(b, "pt-BR");
}

function buildDateRange(start: string, end: string) {
  const out: string[] = [];
  const cur = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);
  while (cur <= last) {
    out.push(`${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function mergedHeaderCellStyle(): React.CSSProperties {
  return {
    border: `1px solid ${C.border}`,
    background: "#f8fafc",
    color: C.text,
    fontSize: 12,
    fontWeight: 800,
    textAlign: "center",
    padding: "8px 6px",
    whiteSpace: "nowrap",
  };
}

function subHeaderCellStyle(): React.CSSProperties {
  return {
    border: `1px solid ${C.border}`,
    background: "#fafafa",
    color: C.textMute,
    fontSize: 11,
    fontWeight: 800,
    textAlign: "center",
    padding: "6px 4px",
    whiteSpace: "nowrap",
  };
}

function bodyCellStyle(): React.CSSProperties {
  return {
    border: `1px solid ${C.border}`,
    background: C.surface,
    color: C.text,
    fontSize: 12,
    padding: "8px 6px",
    textAlign: "center",
    whiteSpace: "nowrap",
  };
}

function SectionTitle({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        justifyContent: "space-between",
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 3, height: 16, borderRadius: 999, background: C.primary }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{title}</div>
      </div>
      {right}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "primary" | "success" | "warning";
}) {
  const color =
    tone === "primary"
      ? C.primary
      : tone === "success"
        ? C.success
        : tone === "warning"
          ? C.warning
          : C.text;

  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      <div style={{ fontSize: 11, color: C.textMute, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, lineHeight: 1, fontWeight: 900, color }}>{value}</div>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: active ? `1px solid ${C.primary}` : `1px solid ${C.border}`,
        background: active ? C.primarySoft : C.surface,
        color: active ? C.primary : C.textMid,
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function FilterInput({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.textMute }}>{label}</span>
      {children}
    </label>
  );
}

const controlStyle: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  color: C.text,
  background: C.surface,
  minWidth: 0,
};

function DailyDayTable({ rows }: { rows: DailySummaryRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
        <thead>
          <tr>
            {["Código", "Placa", "Obra", "Status", "Ligou", "Último", "KM", "Horas"].map((h) => (
              <th
                key={h}
                style={{
                  ...subHeaderCellStyle(),
                  textAlign: h === "Código" || h === "Placa" || h === "Obra" ? "left" : "center",
                  padding: "8px 10px",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const worked = !!r.trabalhou;
            return (
              <tr key={`${r.dia}-${r.codigo}`}>
                <td style={{ ...bodyCellStyle(), textAlign: "left", fontWeight: 800 }}>{r.codigo}</td>
                <td style={{ ...bodyCellStyle(), textAlign: "left", color: C.textMid }}>{r.placa || "—"}</td>
                <td style={{ ...bodyCellStyle(), textAlign: "left" }}>{r.obra || "SEM OBRA"}</td>
                <td
                  style={{
                    ...bodyCellStyle(),
                    fontWeight: 800,
                    color: worked ? C.success : C.textMute,
                  }}
                >
                  {worked ? "TRABALHOU" : "PARADO"}
                </td>
                <td style={bodyCellStyle()}>{fmtHour(r.primeira_ignicao)}</td>
                <td style={bodyCellStyle()}>{fmtHour(r.ultima_ignicao)}</td>
                <td style={{ ...bodyCellStyle(), fontWeight: 700 }}>{fmtKm(r.km_metros)}</td>
                <td style={{ ...bodyCellStyle(), color: C.textMute }}>Em implantação</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ObraHistoryTable({ rows }: { rows: ObraDailyAgg[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
        <thead>
          <tr>
            {["Dia", "Obra", "Equip.", "Trabalharam", "Parados", "KM", "Horas"].map((h) => (
              <th
                key={h}
                style={{
                  ...subHeaderCellStyle(),
                  textAlign: h === "Obra" ? "left" : "center",
                  padding: "8px 10px",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.dia}-${r.obra}`}>
              <td style={bodyCellStyle()}>{fmtDateShort(r.dia)}</td>
              <td style={{ ...bodyCellStyle(), textAlign: "left", fontWeight: 700 }}>{r.obra}</td>
              <td style={bodyCellStyle()}>{String(r.equipamentos)}</td>
              <td style={{ ...bodyCellStyle(), color: C.success, fontWeight: 800 }}>{String(r.trabalharam)}</td>
              <td style={{ ...bodyCellStyle(), color: C.textMute, fontWeight: 700 }}>{String(r.parados)}</td>
              <td style={{ ...bodyCellStyle(), fontWeight: 700 }}>{fmtKm(r.km * 1000)}</td>
              <td style={{ ...bodyCellStyle(), color: C.textMute }}>Em implantação</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EquipHistoryTable({ rows }: { rows: DailySummaryRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
        <thead>
          <tr>
            {["Dia", "Código", "Placa", "Obra", "Status", "Ligou", "Último", "KM", "Horas"].map((h) => (
              <th
                key={h}
                style={{
                  ...subHeaderCellStyle(),
                  textAlign: h === "Código" || h === "Placa" || h === "Obra" ? "left" : "center",
                  padding: "8px 10px",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const worked = !!r.trabalhou;
            return (
              <tr key={`${r.dia}-${r.codigo}`}>
                <td style={bodyCellStyle()}>{fmtDateShort(r.dia)}</td>
                <td style={{ ...bodyCellStyle(), textAlign: "left", fontWeight: 800 }}>{r.codigo}</td>
                <td style={{ ...bodyCellStyle(), textAlign: "left" }}>{r.placa || "—"}</td>
                <td style={{ ...bodyCellStyle(), textAlign: "left" }}>{r.obra || "SEM OBRA"}</td>
                <td style={{ ...bodyCellStyle(), color: worked ? C.success : C.textMute, fontWeight: 800 }}>
                  {worked ? "TRABALHOU" : "PARADO"}
                </td>
                <td style={bodyCellStyle()}>{fmtHour(r.primeira_ignicao)}</td>
                <td style={bodyCellStyle()}>{fmtHour(r.ultima_ignicao)}</td>
                <td style={{ ...bodyCellStyle(), fontWeight: 700 }}>{fmtKm(r.km_metros)}</td>
                <td style={{ ...bodyCellStyle(), color: C.textMute }}>Em implantação</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function KbGridTable({
  card,
  dayCols,
}: {
  card: KbGridCard;
  dayCols: string[];
}) {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      <div
        style={{
          padding: "10px 14px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "#fafafa",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{card.kombi}</div>
        <div style={{ fontSize: 12, color: C.textMute }}>{card.rows.length} obras com evento</div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: Math.max(520, dayCols.length * 120 + 180) }}>
          <thead>
            <tr>
              <th rowSpan={2} style={{ ...mergedHeaderCellStyle(), minWidth: 180 }}>
                Obra
              </th>
              {dayCols.map((d) => (
                <th key={d} colSpan={2} style={mergedHeaderCellStyle()}>
                  {fmtDateLabel(d)}
                </th>
              ))}
            </tr>
            <tr>
              {dayCols.flatMap((d) => [
                <th key={`${d}-ent`} style={subHeaderCellStyle()}>
                  ENT
                </th>,
                <th key={`${d}-sai`} style={subHeaderCellStyle()}>
                  SAI
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row) => (
              <tr key={`${card.kombi}-${row.obra}`}>
                <td style={{ ...bodyCellStyle(), textAlign: "left", fontWeight: 700 }}>{row.obra}</td>
                {dayCols.flatMap((d) => {
                  const cell = row.byDay[d] || { ent: null, sai: null };
                  return [
                    <td key={`${row.obra}-${d}-ent`} style={bodyCellStyle()}>
                      {cell.ent || "—"}
                    </td>,
                    <td key={`${row.obra}-${d}-sai`} style={bodyCellStyle()}>
                      {cell.sai || "—"}
                    </td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function SigasulHistoricoPage() {
  const today = useMemo(todayBRT, []);
  const defaultStart = useMemo(() => daysAgo(today, 6), [today]);

  const [tab, setTab] = useState<TabKey>("dia");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [dia, setDia] = useState(today);
  const [obraDiaFiltro, setObraDiaFiltro] = useState("TODAS");
  const [statusDiaFiltro, setStatusDiaFiltro] = useState("TODOS");

  const [obraHist, setObraHist] = useState("TODAS");
  const [obraHistIni, setObraHistIni] = useState(defaultStart);
  const [obraHistFim, setObraHistFim] = useState(today);

  const [equipHist, setEquipHist] = useState("TODOS");
  const [equipHistIni, setEquipHistIni] = useState(defaultStart);
  const [equipHistFim, setEquipHistFim] = useState(today);

  const [kbIni, setKbIni] = useState(defaultStart);
  const [kbFim, setKbFim] = useState(today);
  const [kbFiltro, setKbFiltro] = useState("TODAS");

  const [dayRows, setDayRows] = useState<DailySummaryRow[]>([]);
  const [obraRows, setObraRows] = useState<ObraDailyAgg[]>([]);
  const [equipRows, setEquipRows] = useState<DailySummaryRow[]>([]);
  const [kbRows, setKbRows] = useState<KbEventRow[]>([]);

  const loadDay = useCallback(async () => {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase
      .from("sigasul_daily_summary")
      .select("dia,codigo,placa,obra,primeira_ignicao,ultima_ignicao,km_metros,trabalhou,created_at")
      .eq("dia", dia)
      .order("obra", { ascending: true })
      .order("codigo", { ascending: true });

    if (error) {
      setErr(error.message);
      setDayRows([]);
      setLoading(false);
      return;
    }

    setDayRows((data ?? []) as DailySummaryRow[]);
    setLoading(false);
  }, [dia]);

  const loadObraHistory = useCallback(async () => {
    setLoading(true);
    setErr(null);

    const { data, error } = await supabase
      .from("sigasul_daily_summary")
      .select("dia,codigo,obra,km_metros,trabalhou")
      .gte("dia", obraHistIni)
      .lte("dia", obraHistFim)
      .order("dia", { ascending: false })
      .order("obra", { ascending: true });

    if (error) {
      setErr(error.message);
      setObraRows([]);
      setLoading(false);
      return;
    }

    const source = ((data ?? []) as Array<Pick<DailySummaryRow, "dia" | "codigo" | "obra" | "km_metros" | "trabalhou">>)
      .filter((r) => obraHist === "TODAS" || (r.obra || "SEM OBRA") === obraHist);

    const map = new Map<string, ObraDailyAgg>();

    for (const r of source) {
      const obra = r.obra || "SEM OBRA";
      const key = `${r.dia}__${obra}`;
      const prev = map.get(key) || {
        dia: r.dia,
        obra,
        equipamentos: 0,
        trabalharam: 0,
        parados: 0,
        km: 0,
      };
      prev.equipamentos += 1;
      if (r.trabalhou) prev.trabalharam += 1;
      else prev.parados += 1;
      prev.km += toNumber(r.km_metros) / 1000;
      map.set(key, prev);
    }

    const rows = Array.from(map.values()).sort((a, b) => {
      if (a.dia === b.dia) return sortObra(a.obra, b.obra);
      return a.dia < b.dia ? 1 : -1;
    });

    setObraRows(rows);
    setLoading(false);
  }, [obraHist, obraHistFim, obraHistIni]);

  const loadEquipHistory = useCallback(async () => {
    setLoading(true);
    setErr(null);

    let query = supabase
      .from("sigasul_daily_summary")
      .select("dia,codigo,placa,obra,primeira_ignicao,ultima_ignicao,km_metros,trabalhou,created_at")
      .gte("dia", equipHistIni)
      .lte("dia", equipHistFim)
      .order("dia", { ascending: false });

    if (equipHist !== "TODOS") {
      query = query.eq("codigo", equipHist);
    }

    const { data, error } = await query;

    if (error) {
      setErr(error.message);
      setEquipRows([]);
      setLoading(false);
      return;
    }

    setEquipRows((data ?? []) as DailySummaryRow[]);
    setLoading(false);
  }, [equipHist, equipHistFim, equipHistIni]);

  const loadKb = useCallback(async () => {
    setLoading(true);
    setErr(null);

    let query = supabase
      .from("sigasul_geofence_events_v")
      .select("pos_equip_id,codigo_equipamento,evento_at,dia_brt,hora_brt,evento,obra,obra_origem,obra_destino")
      .gte("dia_brt", kbIni)
      .lte("dia_brt", kbFim)
      .ilike("codigo_equipamento", "KB-%")
      .order("codigo_equipamento", { ascending: true })
      .order("dia_brt", { ascending: true })
      .order("evento_at", { ascending: true });

    if (kbFiltro !== "TODAS") {
      query = query.eq("codigo_equipamento", kbFiltro);
    }

    const { data, error } = await query;

    if (error) {
      setErr(error.message);
      setKbRows([]);
      setLoading(false);
      return;
    }

    setKbRows((data ?? []) as KbEventRow[]);
    setLoading(false);
  }, [kbFiltro, kbFim, kbIni]);

  useEffect(() => {
    if (tab === "dia") loadDay();
  }, [tab, loadDay]);

  const allObras = useMemo(() => {
    const s = new Set<string>();
    for (const r of dayRows) s.add(r.obra || "SEM OBRA");
    for (const r of obraRows) s.add(r.obra || "SEM OBRA");
    return ["TODAS", ...Array.from(s).sort(sortObra)];
  }, [dayRows, obraRows]);

  const allEquips = useMemo(() => {
    const s = new Set<string>();
    for (const r of dayRows) s.add(r.codigo);
    for (const r of equipRows) s.add(r.codigo);
    return ["TODOS", ...Array.from(s).sort((a, b) => a.localeCompare(b, "pt-BR"))];
  }, [dayRows, equipRows]);

  const allKbs = useMemo(() => {
    const s = new Set<string>();
    for (const r of kbRows) if (r.codigo_equipamento) s.add(r.codigo_equipamento);
    return ["TODAS", ...Array.from(s).sort((a, b) => a.localeCompare(b, "pt-BR"))];
  }, [kbRows]);

  const filteredDayRows = useMemo(() => {
    return dayRows.filter((r) => {
      const obraOk = obraDiaFiltro === "TODAS" || (r.obra || "SEM OBRA") === obraDiaFiltro;
      const statusOk =
        statusDiaFiltro === "TODOS"
          ? true
          : statusDiaFiltro === "TRABALHOU"
            ? !!r.trabalhou
            : !r.trabalhou;
      return obraOk && statusOk;
    });
  }, [dayRows, obraDiaFiltro, statusDiaFiltro]);

  const dayStats = useMemo(() => {
    const total = filteredDayRows.length;
    const trabalharam = filteredDayRows.filter((r) => !!r.trabalhou).length;
    const parados = total - trabalharam;
    const km = filteredDayRows.reduce((acc, r) => acc + toNumber(r.km_metros), 0);
    const obras = new Set(filteredDayRows.map((r) => r.obra || "SEM OBRA")).size;
    return { total, trabalharam, parados, km, obras };
  }, [filteredDayRows]);

  const dayByObra = useMemo(() => {
    const map = new Map<string, DailySummaryRow[]>();
    for (const r of filteredDayRows) {
      const obra = r.obra || "SEM OBRA";
      if (!map.has(obra)) map.set(obra, []);
      map.get(obra)!.push(r);
    }
    return Array.from(map.entries()).sort((a, b) => sortObra(a[0], b[0]));
  }, [filteredDayRows]);

  const kbDayCols = useMemo(() => buildDateRange(kbIni, kbFim), [kbFim, kbIni]);

  const kbCards = useMemo((): KbGridCard[] => {
    const byKombi = new Map<string, Map<string, Map<string, KbCell>>>();

    for (const r of kbRows) {
      const kombi = r.codigo_equipamento || "SEM KOD";
      const obra =
        (r.obra && r.obra.trim()) ||
        (r.obra_destino && r.obra_destino.trim()) ||
        (r.obra_origem && r.obra_origem.trim()) ||
        "SEM OBRA";
      const diaKey = r.dia_brt;
      const hora = r.hora_brt || fmtHour(r.evento_at);
      const evento = (r.evento || "").toUpperCase();

      if (!byKombi.has(kombi)) byKombi.set(kombi, new Map());
      const byObra = byKombi.get(kombi)!;

      if (!byObra.has(obra)) byObra.set(obra, new Map());
      const byDay = byObra.get(obra)!;

      const prev = byDay.get(diaKey) || { ent: null, sai: null };

      if (evento.includes("ENTRADA")) {
        if (!prev.ent || (hora && hora < prev.ent)) prev.ent = hora || prev.ent;
      }
      if (evento.includes("SAIDA") || evento.includes("SAÍDA")) {
        if (!prev.sai || (hora && hora > prev.sai)) prev.sai = hora || prev.sai;
      }

      byDay.set(diaKey, prev);
    }

    return Array.from(byKombi.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
      .map(([kombi, obrasMap]) => {
        const rows: KbGridRow[] = Array.from(obrasMap.entries())
          .sort((a, b) => sortObra(a[0], b[0]))
          .map(([obra, byDayMap]) => {
            const byDay: Record<string, KbCell> = {};
            for (const d of kbDayCols) {
              const v = byDayMap.get(d) || { ent: null, sai: null };
              byDay[d] = v;
            }
            return { obra, byDay };
          });

        return { kombi, rows };
      });
  }, [kbDayCols, kbRows]);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui,-apple-system,sans-serif" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: C.surface,
          borderBottom: `1px solid ${C.border}`,
          padding: "12px 18px",
        }}
      >
        <div
          style={{
            maxWidth: 1500,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: C.text }}>Histórico Diário · SigaSul</div>
            <div style={{ fontSize: 12, color: C.textMute }}>
              Retrato congelado do dia, histórico por obra, histórico do equipamento e kombis.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <TabButton active={tab === "dia"} onClick={() => setTab("dia")}>
              Retrato do dia
            </TabButton>
            <TabButton active={tab === "obra"} onClick={() => setTab("obra")}>
              Histórico por obra
            </TabButton>
            <TabButton active={tab === "equip"} onClick={() => setTab("equip")}>
              Histórico do equipamento
            </TabButton>
            <TabButton active={tab === "kombis"} onClick={() => setTab("kombis")}>
              Kombis
            </TabButton>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1500, margin: "0 auto", padding: 18 }}>
        {err && (
          <div
            style={{
              background: C.dangerSoft,
              border: `1px solid #fecaca`,
              borderRadius: 10,
              padding: "10px 12px",
              color: C.danger,
              fontSize: 13,
              marginBottom: 14,
            }}
          >
            <strong>Erro:</strong> {err}
          </div>
        )}

        {tab === "dia" && (
          <>
            <div
              style={{
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 14,
                marginBottom: 16,
              }}
            >
              <SectionTitle
                title="Filtros"
                right={
                  <button
                    onClick={loadDay}
                    disabled={loading}
                    style={{
                      border: "none",
                      background: loading ? C.border : C.primary,
                      color: loading ? C.textMute : "#fff",
                      borderRadius: 8,
                      padding: "9px 14px",
                      fontSize: 13,
                      fontWeight: 800,
                      cursor: loading ? "not-allowed" : "pointer",
                    }}
                  >
                    {loading ? "Consultando..." : "Consultar"}
                  </button>
                }
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(160px, 1fr))",
                  gap: 12,
                }}
              >
                <FilterInput label="Data">
                  <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} style={controlStyle} />
                </FilterInput>

                <FilterInput label="Obra">
                  <select value={obraDiaFiltro} onChange={(e) => setObraDiaFiltro(e.target.value)} style={controlStyle}>
                    {allObras.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </FilterInput>

                <FilterInput label="Status">
                  <select value={statusDiaFiltro} onChange={(e) => setStatusDiaFiltro(e.target.value)} style={controlStyle}>
                    <option value="TODOS">Todos</option>
                    <option value="TRABALHOU">Trabalhou</option>
                    <option value="PARADO">Parado</option>
                  </select>
                </FilterInput>

                <FilterInput label="Horas trabalhadas">
                  <div
                    style={{
                      ...controlStyle,
                      color: C.textMute,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    Em implantação via horímetros
                  </div>
                </FilterInput>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, minmax(140px, 1fr))",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <StatCard label="Equipamentos" value={String(dayStats.total)} />
              <StatCard label="Trabalharam" value={String(dayStats.trabalharam)} tone="success" />
              <StatCard label="Parados" value={String(dayStats.parados)} />
              <StatCard label="KM total" value={fmtKm(dayStats.km)} tone="warning" />
              <StatCard label="Obras" value={String(dayStats.obras)} tone="primary" />
            </div>

            {dayByObra.map(([obra, rows]) => (
              <div
                key={obra}
                style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: 14,
                  marginBottom: 16,
                }}
              >
                <SectionTitle
                  title={obra}
                  right={
                    <span style={{ fontSize: 12, color: C.textMute }}>
                      {rows.length} equip. · {rows.filter((r) => !!r.trabalhou).length} trabalharam
                    </span>
                  }
                />
                <DailyDayTable rows={rows} />
              </div>
            ))}
          </>
        )}

        {tab === "obra" && (
          <div
            style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 14,
            }}
          >
            <SectionTitle
              title="Histórico por obra"
              right={
                <button
                  onClick={loadObraHistory}
                  disabled={loading}
                  style={{
                    border: "none",
                    background: loading ? C.border : C.primary,
                    color: loading ? C.textMute : "#fff",
                    borderRadius: 8,
                    padding: "9px 14px",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? "Consultando..." : "Consultar"}
                </button>
              }
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(180px, 1fr))",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <FilterInput label="Data inicial">
                <input type="date" value={obraHistIni} onChange={(e) => setObraHistIni(e.target.value)} style={controlStyle} />
              </FilterInput>

              <FilterInput label="Data final">
                <input type="date" value={obraHistFim} onChange={(e) => setObraHistFim(e.target.value)} style={controlStyle} />
              </FilterInput>

              <FilterInput label="Obra">
                <select value={obraHist} onChange={(e) => setObraHist(e.target.value)} style={controlStyle}>
                  {allObras.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </FilterInput>
            </div>

            <ObraHistoryTable rows={obraRows} />
          </div>
        )}

        {tab === "equip" && (
          <div
            style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 14,
            }}
          >
            <SectionTitle
              title="Histórico do equipamento"
              right={
                <button
                  onClick={loadEquipHistory}
                  disabled={loading}
                  style={{
                    border: "none",
                    background: loading ? C.border : C.primary,
                    color: loading ? C.textMute : "#fff",
                    borderRadius: 8,
                    padding: "9px 14px",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? "Consultando..." : "Consultar"}
                </button>
              }
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(180px, 1fr))",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <FilterInput label="Data inicial">
                <input type="date" value={equipHistIni} onChange={(e) => setEquipHistIni(e.target.value)} style={controlStyle} />
              </FilterInput>

              <FilterInput label="Data final">
                <input type="date" value={equipHistFim} onChange={(e) => setEquipHistFim(e.target.value)} style={controlStyle} />
              </FilterInput>

              <FilterInput label="Equipamento">
                <select value={equipHist} onChange={(e) => setEquipHist(e.target.value)} style={controlStyle}>
                  {allEquips.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </FilterInput>
            </div>

            <EquipHistoryTable rows={equipRows} />
          </div>
        )}

        {tab === "kombis" && (
          <div
            style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 14,
            }}
          >
            <SectionTitle
              title="Kombis · entradas e saídas"
              right={
                <button
                  onClick={loadKb}
                  disabled={loading}
                  style={{
                    border: "none",
                    background: loading ? C.border : C.primary,
                    color: loading ? C.textMute : "#fff",
                    borderRadius: 8,
                    padding: "9px 14px",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  {loading ? "Consultando..." : "Consultar"}
                </button>
              }
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, minmax(180px, 1fr))",
                gap: 12,
                marginBottom: 14,
              }}
            >
              <FilterInput label="Data inicial">
                <input type="date" value={kbIni} onChange={(e) => setKbIni(e.target.value)} style={controlStyle} />
              </FilterInput>

              <FilterInput label="Data final">
                <input type="date" value={kbFim} onChange={(e) => setKbFim(e.target.value)} style={controlStyle} />
              </FilterInput>

              <FilterInput label="Kombi">
                <select value={kbFiltro} onChange={(e) => setKbFiltro(e.target.value)} style={controlStyle}>
                  {allKbs.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </FilterInput>
            </div>

            {kbCards.length === 0 ? (
              <div
                style={{
                  border: `1px dashed ${C.border}`,
                  borderRadius: 10,
                  padding: 18,
                  color: C.textMute,
                  fontSize: 13,
                }}
              >
                Nenhum evento de kombi no período.
              </div>
            ) : (
              kbCards.map((card) => <KbGridTable key={card.kombi} card={card} dayCols={kbDayCols} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
