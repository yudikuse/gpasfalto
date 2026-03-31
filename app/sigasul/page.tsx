"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const C = {
  bg: "#f4f5f7",
  surface: "#ffffff",
  border: "#e8eaed",
  text: "#1a1f36",
  textMid: "#4b5563",
  textMute: "#9ca3af",
  primary: "#4361ee",
  success: "#0d9f6e",
  danger: "#dc2626",
  warning: "#d97706",
};

type LatestRow = {
  pos_equip_id: string;
  codigo_equipamento: string | null;
  pos_placa: string | null;
  obra_final: string | null;
  gps_at: string | null;
  ingested_at: string | null;
  pos_ignicao: boolean | null;
  pos_online: boolean | null;
  ignicao_atual: boolean | null;
  online_atual: boolean | null;
  pos_velocidade: number | null;
  pos_tensao: number | null;
  pos_nome_motorista: string | null;
  last_seen_at: string | null;
};

type SigasulEvento = {
  data_hora_inicial: string;
  data_hora_final: string;
  distancia: number;
  tempoLigado: string;
  motorista: string | null;
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
  pos_tensao: number | null;
  pos_nome_motorista: string | null;
};

type EquipRow = {
  pos_equip_id: string;
  nome: string;
  placa: string;
  obra: string;
  online: boolean | null;
  ignicao: boolean | null;
  statusExpirado: boolean;
  semComunicacao: boolean;
  diasSemSinal: number;
  velocidade: number | null;
  tensao: number | null;
  motorista: string | null;
  ultimaPos: string | null;
  ultimaPosISO: string | null;
  primeiraIgnicao: string | null;
  kmTotal: number;
  tempoLigadoSec: number;
  isKombi: boolean;
};

type KbDaySummaryRow = {
  pos_equip_id: string;
  codigo_equipamento: string;
  placa: string | null;
  dia_brt: string;
  primeira_obra: string | null;
  ultima_obra: string | null;
  primeira_chegada_at: string | null;
  primeira_chegada_hora_brt: string | null;
  ultima_saida_at: string | null;
  ultima_saida_hora_brt: string | null;
  qtd_visitas: number | null;
  total_permanencia_min: number | null;
  total_permanencia_horas: number | null;
  obra_atual: string | null;
  online_atual: boolean | null;
  ignicao_atual: boolean | null;
  velocidade_atual: number | null;
  tensao_atual: number | null;
  last_seen_at: string | null;
};

type KbHistoryRow = {
  pos_equip_id: string;
  codigo_equipamento: string;
  evento_at: string;
  dia_brt: string;
  hora_brt: string;
  evento: string;
  obra: string | null;
  obra_origem: string | null;
  obra_destino: string | null;
};

type KbCurrentStateRow = {
  pos_equip_id: string;
  codigo_equipamento: string;
  placa: string | null;
  dia_brt: string;
  ponto_at: string;
  obra_calc: string | null;
  obra_proxima: string | null;
  distancia_m: number | null;
  raio_usado_m: number | null;
  pos_velocidade: number | null;
  pos_online: boolean | null;
  pos_ignicao: boolean | null;
  pos_tensao: number | null;
  pos_latitude: number | null;
  pos_longitude: number | null;
};

type KbDisplayRow = {
  pos_equip_id: string;
  codigo_equipamento: string;
  obraAtual: string;
  velocidade: number | null;
  tensao: number | null;
  online: boolean | null;
  ignicao: boolean | null;
  ultimaPos: string | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayBRT() {
  const now = new Date();
  const brt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  return `${brt.getUTCFullYear()}-${pad2(brt.getUTCMonth() + 1)}-${pad2(brt.getUTCDate())}`;
}

function hhmmssToSec(s: string) {
  if (!s || !s.match(/^\d{2}:\d{2}:\d{2}$/)) return 0;
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

function fmtHoraBRT(dt: string | null): string {
  if (!dt) return "—";
  const match = dt.match(/[T ](\d{2}:\d{2})/);
  return match ? match[1] : "—";
}

function fmtHoraUTC(iso: string | null): string {
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

function tensaoColor(v: number | null) {
  if (v == null) return C.textMute;
  if (v >= 13.0) return C.success;
  if (v >= 12.0) return C.warning;
  return C.danger;
}

const MAIN_GRID = "2.3fr 0.78fr 0.82fr 0.86fr 0.86fr 0.82fr 1.12fr";
const KB_SUMMARY_GRID = "1fr 1fr 1.25fr 0.8fr 0.85fr 0.9fr";
const KB_HISTORY_GRID = "0.8fr 0.7fr 0.9fr 1.6fr";
const COMPACT_GAP = 10;
const TABLE_MIN_WIDTH = 780;

function StatusBadge({
  ignicao,
  online,
  expirado,
}: {
  ignicao: boolean | null;
  online: boolean | null;
  expirado: boolean;
}) {
  if (online === false) {
    return <span style={{ fontSize: 11, fontWeight: 700, color: C.danger }}>● OFFLINE</span>;
  }
  if (expirado) {
    return <span style={{ fontSize: 11, fontWeight: 600, color: C.textMute }}>● SEM SINAL</span>;
  }
  if (ignicao === true) {
    return <span style={{ fontSize: 11, fontWeight: 700, color: C.success }}>● LIGADO</span>;
  }
  return <span style={{ fontSize: 11, fontWeight: 600, color: C.textMute }}>● DESLIGADO</span>;
}

function EquipRowItem({ eq }: { eq: EquipRow }) {
  const ligado = eq.tempoLigadoSec > 0;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: MAIN_GRID,
        alignItems: "center",
        gap: COMPACT_GAP,
        padding: "9px 12px",
        borderBottom: `1px solid ${C.border}`,
        background: C.surface,
        width: "100%",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            color: C.text,
            fontSize: 13,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {eq.nome}
        </div>
        <div
          style={{
            fontSize: 11,
            color: C.textMute,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {eq.placa}
        </div>
        {eq.motorista && (
          <div
            style={{
              fontSize: 11,
              color: C.primary,
              marginTop: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            👤 {eq.motorista}
          </div>
        )}
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 10, color: C.textMute, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 1 }}>
          Ligou
        </div>
        <div style={{ fontWeight: 700, fontSize: 13, color: ligado ? C.primary : C.textMute }}>
          {eq.primeiraIgnicao ?? "—"}
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 10, color: C.textMute, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 1 }}>
          KM
        </div>
        <div style={{ fontWeight: 700, fontSize: 13, color: eq.kmTotal > 0 ? C.success : C.textMute }}>
          {eq.kmTotal > 0 ? fmtKm(eq.kmTotal) : "—"}
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 10, color: C.textMute, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 1 }}>
          Tempo
        </div>
        <div style={{ fontWeight: 700, fontSize: 13, color: ligado ? C.warning : C.textMute }}>
          {ligado ? secToLabel(eq.tempoLigadoSec) : "—"}
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 10, color: C.textMute, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 1 }}>
          Bateria
        </div>
        <div style={{ fontWeight: 700, fontSize: 13, color: tensaoColor(eq.tensao) }}>
          {eq.tensao != null ? `${eq.tensao.toFixed(1)}V` : "—"}
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 10, color: C.textMute, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 1 }}>
          Agora
        </div>
        <div style={{ fontWeight: 700, fontSize: 13, color: eq.velocidade && eq.velocidade > 0 ? C.success : C.textMute }}>
          {eq.velocidade && eq.velocidade > 0 ? `${eq.velocidade} km/h` : "—"}
        </div>
      </div>

      <div style={{ textAlign: "right" }}>
        <StatusBadge ignicao={eq.ignicao} online={eq.online} expirado={eq.statusExpirado} />
        {eq.ultimaPos && <div style={{ fontSize: 10, color: C.textMute, marginTop: 2 }}>{eq.ultimaPos}</div>}
      </div>
    </div>
  );
}

function ObraSection({ obra, equips }: { obra: string; equips: EquipRow[] }) {
  const trabalhando = equips.filter((e) => e.tempoLigadoSec > 0).length;
  const online = equips.filter((e) => e.online === true && !e.statusExpirado).length;

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 12px",
          background: "#f8f9fb",
          border: `1px solid ${C.border}`,
          borderBottom: "none",
          borderRadius: "8px 8px 0 0",
        }}
      >
        <div style={{ width: 3, height: 16, borderRadius: 2, background: obra === "SEM OBRA" ? C.textMute : C.primary }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{obra}</span>
        <span style={{ fontSize: 12, color: C.textMute }}>{equips.length} equip.</span>
        <span style={{ fontSize: 12, color: C.success, fontWeight: 600 }}>{trabalhando} trabalhando</span>
        <span style={{ fontSize: 12, color: C.primary, fontWeight: 600, marginLeft: "auto" }}>{online} online</span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: TABLE_MIN_WIDTH, width: "100%" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: MAIN_GRID,
              gap: COMPACT_GAP,
              padding: "5px 12px",
              background: "#fafafa",
              border: `1px solid ${C.border}`,
              borderBottom: "none",
              fontSize: 10,
              color: C.textMute,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              width: "100%",
            }}
          >
            <div>Equipamento</div>
            <div style={{ textAlign: "center" }}>Ligou</div>
            <div style={{ textAlign: "center" }}>KM</div>
            <div style={{ textAlign: "center" }}>Tempo</div>
            <div style={{ textAlign: "center" }}>Bateria</div>
            <div style={{ textAlign: "center" }}>Agora</div>
            <div style={{ textAlign: "right" }}>Status</div>
          </div>

          <div
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: "0 0 8px 8px",
              overflow: "hidden",
              width: "100%",
            }}
          >
            {equips.map((eq) => (
              <EquipRowItem key={eq.pos_equip_id} eq={eq} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KbSummarySection({ rows }: { rows: KbDisplayRow[] }) {
  const online = rows.filter((r) => r.online === true).length;
  const emObra = rows.filter((r) => r.obraAtual !== "—").length;

  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 12px",
          background: "#eef5ff",
          border: `1px solid #cfe0ff`,
          borderBottom: "none",
          borderRadius: "8px 8px 0 0",
        }}
      >
        <div style={{ width: 3, height: 16, borderRadius: 2, background: C.primary }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Kombis</span>
        <span style={{ fontSize: 12, color: C.textMute }}>{rows.length} kombis</span>
        <span style={{ fontSize: 12, color: C.success, fontWeight: 600 }}>{emObra} em obra</span>
        <span style={{ fontSize: 12, color: C.primary, fontWeight: 600, marginLeft: "auto" }}>{online} online</span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 880, width: "100%" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: KB_SUMMARY_GRID,
              gap: COMPACT_GAP,
              padding: "5px 12px",
              background: "#f7faff",
              border: `1px solid #cfe0ff`,
              borderBottom: "none",
              fontSize: 10,
              color: C.textMute,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            <div>Kombi</div>
            <div>Status</div>
            <div>Obra atual</div>
            <div style={{ textAlign: "center" }}>Agora</div>
            <div style={{ textAlign: "center" }}>Bateria</div>
            <div style={{ textAlign: "right" }}>Últ. sinal</div>
          </div>

          <div style={{ border: `1px solid #cfe0ff`, borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
            {rows.map((kb) => {
              const moving = !!kb.velocidade && kb.velocidade > 0;
              const onlineNow = kb.online === true;
              const statusLabel = moving
                ? "● EM DESLOCAMENTO"
                : onlineNow && kb.ignicao
                ? "● LIGADA"
                : onlineNow
                ? "● ONLINE"
                : "● OFFLINE";
              const statusColor = moving ? C.success : onlineNow ? C.primary : C.danger;

              return (
                <div
                  key={kb.pos_equip_id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: KB_SUMMARY_GRID,
                    gap: COMPACT_GAP,
                    alignItems: "center",
                    padding: "9px 12px",
                    borderBottom: `1px solid #e4edff`,
                    background: C.surface,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{kb.codigo_equipamento}</div>

                  <div style={{ fontWeight: 700, fontSize: 11, color: statusColor }}>{statusLabel}</div>

                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: C.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {kb.obraAtual}
                  </div>

                  <div style={{ textAlign: "center", fontWeight: 700, fontSize: 13, color: kb.velocidade && kb.velocidade > 0 ? C.success : C.textMute }}>
                    {kb.velocidade && kb.velocidade > 0 ? `${kb.velocidade} km/h` : "—"}
                  </div>

                  <div style={{ textAlign: "center", fontWeight: 700, fontSize: 13, color: tensaoColor(kb.tensao) }}>
                    {kb.tensao != null ? `${kb.tensao.toFixed(1)}V` : "—"}
                  </div>

                  <div style={{ textAlign: "right", fontSize: 11, color: C.textMute }}>{kb.ultimaPos || "—"}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function KbHistorySection({ rows }: { rows: KbHistoryRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 12px",
          background: "#f8f9fb",
          border: `1px solid ${C.border}`,
          borderBottom: "none",
          borderRadius: "8px 8px 0 0",
        }}
      >
        <div style={{ width: 3, height: 16, borderRadius: 2, background: C.textMute }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>Kombis — Histórico do dia</span>
        <span style={{ fontSize: 12, color: C.textMute }}>{rows.length} eventos</span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 720, width: "100%" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: KB_HISTORY_GRID,
              gap: COMPACT_GAP,
              padding: "5px 12px",
              background: "#fafafa",
              border: `1px solid ${C.border}`,
              borderBottom: "none",
              fontSize: 10,
              color: C.textMute,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            <div>Kombi</div>
            <div>Hora</div>
            <div>Evento</div>
            <div>Obra</div>
          </div>

          <div style={{ border: `1px solid ${C.border}`, borderRadius: "0 0 8px 8px", overflow: "hidden" }}>
            {rows.map((r, idx) => {
              const eventoColor = r.evento === "ENTRADA" ? C.primary : C.warning;
              return (
                <div
                  key={`${r.codigo_equipamento}-${r.evento_at}-${idx}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: KB_HISTORY_GRID,
                    gap: COMPACT_GAP,
                    alignItems: "center",
                    padding: "8px 12px",
                    borderBottom: `1px solid ${C.border}`,
                    background: C.surface,
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{r.codigo_equipamento}</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.textMid }}>{r.hora_brt || "—"}</div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: eventoColor }}>{r.evento}</div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 13,
                      color: C.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.obra || "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: "12px 16px",
      }}
    >
      <div style={{ fontSize: 11, color: C.textMute, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
    </div>
  );
}

export default function SigasulPage() {
  const TODAY = useMemo(todayBRT, []);
  const [date, setDate] = useState(TODAY);
  const [obraFiltro, setObraFiltro] = useState("TODAS");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [latest, setLatest] = useState<LatestRow[]>([]);
  const [simplificada, setSimplificada] = useState<SigasulVeiculo[]>([]);
  const [positions, setPositions] = useState<SigasulPosition[]>([]);
  const [kbSummary, setKbSummary] = useState<KbDaySummaryRow[]>([]);
  const [kbHistory, setKbHistory] = useState<KbHistoryRow[]>([]);
  const [kbCurrentState, setKbCurrentState] = useState<KbCurrentStateRow[]>([]);

  async function load() {
    setLoading(true);
    setErr(null);

    const [
      latestRes,
      kbSummaryRes,
      kbHistoryRes,
      kbCurrentStateRes,
    ] = await Promise.all([
      supabase
        .from("sigasul_dashboard_latest")
        .select(
          "pos_equip_id,codigo_equipamento,pos_placa,obra_final,gps_at,ingested_at,last_seen_at,pos_ignicao,pos_online,ignicao_atual,online_atual,pos_velocidade,pos_tensao,pos_nome_motorista"
        ),
      supabase
        .from("sigasul_kb_day_summary_v")
        .select("*")
        .eq("dia_brt", date)
        .order("codigo_equipamento", { ascending: true }),
      supabase
        .from("sigasul_geofence_events_v")
        .select("pos_equip_id,codigo_equipamento,evento_at,dia_brt,hora_brt,evento,obra,obra_origem,obra_destino")
        .eq("dia_brt", date)
        .ilike("codigo_equipamento", "KB-%")
        .order("codigo_equipamento", { ascending: true })
        .order("evento_at", { ascending: true }),
      supabase
        .from("sigasul_kb_current_state_v")
        .select("*")
        .eq("dia_brt", date)
        .order("codigo_equipamento", { ascending: true }),
    ]);

    if (latestRes.error) {
      setErr(latestRes.error.message);
      setLoading(false);
      return;
    }

    setLatest((latestRes.data ?? []) as LatestRow[]);

    if (kbSummaryRes.error) {
      console.warn("sigasul_kb_day_summary_v:", kbSummaryRes.error.message);
      setKbSummary([]);
    } else {
      setKbSummary((kbSummaryRes.data ?? []) as KbDaySummaryRow[]);
    }

    if (kbHistoryRes.error) {
      console.warn("sigasul_geofence_events_v:", kbHistoryRes.error.message);
      setKbHistory([]);
    } else {
      setKbHistory((kbHistoryRes.data ?? []) as KbHistoryRow[]);
    }

    if (kbCurrentStateRes.error) {
      console.warn("sigasul_kb_current_state_v:", kbCurrentStateRes.error.message);
      setKbCurrentState([]);
    } else {
      setKbCurrentState((kbCurrentStateRes.data ?? []) as KbCurrentStateRow[]);
    }

    try {
      const res = await fetch(`/api/sigasul/today?date=${date}`, { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.simplificada)) setSimplificada(json.simplificada);
        if (Array.isArray(json.positions)) setPositions(json.positions);
      }
    } catch (e) {
      console.warn("today API:", e);
    }

    setLastUpdate(new Date());
    setLoading(false);
  }

  useEffect(() => {
    load();
    if (date !== TODAY) return;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [date, TODAY]);

  const posMap = useMemo(() => {
    const m = new Map<string, SigasulPosition>();
    for (const p of positions) {
      if (p.pos_placa) m.set(p.pos_placa.replace(/\W/g, "").toUpperCase(), p);
    }
    return m;
  }, [positions]);

  const simpMap = useMemo(() => {
    const m = new Map<string, SigasulVeiculo>();
    for (const v of simplificada) {
      if (v.placa) m.set(v.placa.replace(/\W/g, "").toUpperCase(), v);
    }
    return m;
  }, [simplificada]);

  const equips = useMemo((): EquipRow[] => {
    return latest
      .map((row): EquipRow => {
        const nome = row.codigo_equipamento || row.pos_placa || row.pos_equip_id;
        const placa = row.pos_placa || "—";
        const obra = row.obra_final || "SEM OBRA";
        const key = placa.replace(/\W/g, "").toUpperCase();
        const simp = simpMap.get(key);
        const pos = posMap.get(key);
        const isKombi = /^KB-/i.test(nome);

        const eventos = simp?.eventos ?? [];
        const kmTotal = eventos.reduce((a, e) => a + (e.distancia ?? 0), 0);
        const tempoLigadoSec = eventos.reduce((a, e) => a + hhmmssToSec(e.tempoLigado), 0);
        const primeiraIgnicao = eventos.length > 0 ? fmtHoraBRT(eventos[0].data_hora_inicial) : null;

        const motorista =
          eventos.find((e) => e.motorista)?.motorista ||
          pos?.pos_nome_motorista ||
          row.pos_nome_motorista ||
          null;

        const statusExpirado = !pos && row.ignicao_atual === false && row.pos_ignicao === true;

        const online = pos?.pos_online ?? (statusExpirado ? null : row.online_atual);
        const ignicao = pos?.pos_ignicao ?? row.ignicao_atual;
        const velocidade = pos?.pos_velocidade ?? (statusExpirado ? null : row.pos_velocidade);
        const tensao = pos?.pos_tensao ?? row.pos_tensao;

        const ultimaPosISO = row.last_seen_at ?? row.ingested_at;
        const ultimaPos = fmtHoraUTC(row.ingested_at);

        const diasSemSinal = ultimaPosISO
          ? Math.floor((Date.now() - new Date(ultimaPosISO).getTime()) / (1000 * 60 * 60 * 24))
          : 999;

        const semComunicacao = diasSemSinal >= 7;

        return {
          pos_equip_id: row.pos_equip_id,
          nome,
          placa,
          obra,
          online,
          ignicao,
          statusExpirado,
          semComunicacao,
          diasSemSinal,
          velocidade,
          tensao,
          motorista,
          ultimaPos,
          ultimaPosISO,
          primeiraIgnicao,
          kmTotal,
          tempoLigadoSec,
          isKombi,
        };
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [latest, simpMap, posMap]);

  const kombis = useMemo(() => equips.filter((e) => e.isKombi), [equips]);
  const nonKbEquips = useMemo(() => equips.filter((e) => !e.isKombi), [equips]);

  const ativos = useMemo(() => nonKbEquips.filter((e) => !e.semComunicacao), [nonKbEquips]);
  const semComunicacao = useMemo(() => nonKbEquips.filter((e) => e.semComunicacao), [nonKbEquips]);

  const kbRows = useMemo((): KbDisplayRow[] => {
    const summaryMap = new Map(kbSummary.map((r) => [r.pos_equip_id, r]));
    const currentMap = new Map(kbCurrentState.map((r) => [r.pos_equip_id, r]));

    return kombis
      .map((kb) => {
        const s = summaryMap.get(kb.pos_equip_id);
        const c = currentMap.get(kb.pos_equip_id);

        const velocidadeAtual =
          c?.pos_velocidade ?? s?.velocidade_atual ?? kb.velocidade;
        const tensaoAtual =
          c?.pos_tensao ?? s?.tensao_atual ?? kb.tensao;
        const onlineAtual =
          c?.pos_online ?? s?.online_atual ?? kb.online;
        const ignicaoAtual =
          c?.pos_ignicao ?? s?.ignicao_atual ?? kb.ignicao;

        return {
          pos_equip_id: kb.pos_equip_id,
          codigo_equipamento: kb.nome,
          obraAtual: c?.obra_calc || "—",
          velocidade: velocidadeAtual,
          tensao: tensaoAtual,
          online: onlineAtual,
          ignicao: ignicaoAtual,
          ultimaPos: c?.ponto_at ? fmtHoraUTC(c.ponto_at) : s?.last_seen_at ? fmtHoraUTC(s.last_seen_at) : kb.ultimaPos,
        };
      })
      .sort((a, b) => a.codigo_equipamento.localeCompare(b.codigo_equipamento, "pt-BR"));
  }, [kombis, kbSummary, kbCurrentState]);

  const obras = useMemo(() => {
    const s = new Set(ativos.map((e) => e.obra));
    return [
      "TODAS",
      ...Array.from(s).sort((a, b) => {
        if (a === "SEM OBRA") return 1;
        if (b === "SEM OBRA") return -1;
        return a.localeCompare(b, "pt-BR");
      }),
    ];
  }, [ativos]);

  const filtered = useMemo(
    () => (obraFiltro === "TODAS" ? ativos : ativos.filter((e) => e.obra === obraFiltro)),
    [ativos, obraFiltro]
  );

  const groups = useMemo(() => {
    const m = new Map<string, EquipRow[]>();
    for (const e of filtered) {
      if (!m.has(e.obra)) m.set(e.obra, []);
      m.get(e.obra)!.push(e);
    }
    return m;
  }, [filtered]);

  const totals = useMemo(
    () => ({
      total: ativos.length,
      online: ativos.filter((e) => e.online === true && !e.statusExpirado).length,
      ligados: ativos.filter((e) => e.tempoLigadoSec > 0).length,
      km: ativos.reduce((a, e) => a + e.kmTotal, 0),
    }),
    [ativos]
  );

  const isToday = date === TODAY;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui,-apple-system,sans-serif" }}>
      <div
        style={{
          background: C.surface,
          borderBottom: `1px solid ${C.border}`,
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: C.text }}>🚛 Monitoramento de Frota</span>
          <span style={{ fontSize: 12, color: C.textMute }}>
            {isToday ? "Hoje" : date} · {ativos.length} equip.
            {isToday && " · refresh 1min"}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            id="sigasul-date"
            name="sigasul-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "5px 8px",
              fontSize: 13,
              color: C.text,
              background: C.surface,
            }}
          />

          <select
            id="sigasul-obra"
            name="sigasul-obra"
            value={obraFiltro}
            onChange={(e) => setObraFiltro(e.target.value)}
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "5px 8px",
              fontSize: 13,
              color: C.text,
              background: C.surface,
              minWidth: 150,
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
              background: loading ? C.border : C.primary,
              border: "none",
              borderRadius: 6,
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              color: loading ? C.textMute : "#fff",
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Atualizando…" : "↺ Atualizar"}
          </button>

          {lastUpdate && (
            <span style={{ fontSize: 11, color: C.textMute }}>
              {lastUpdate.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: "16px 24px", maxWidth: 1400, margin: "0 auto" }}>
        {err && (
          <div
            style={{
              background: "#fef2f2",
              border: `1px solid #fecaca`,
              borderRadius: 8,
              padding: "10px 14px",
              color: C.danger,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            <strong>Erro:</strong> {err}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4,1fr)",
            gap: 10,
            marginBottom: 16,
          }}
        >
          <StatBox label="Equipamentos" value={String(totals.total)} color={C.text} />
          <StatBox label="Online agora" value={String(totals.online)} color={C.primary} />
          <StatBox label="Trabalharam hoje" value={String(totals.ligados)} color={C.success} />
          <StatBox label="KM total frota" value={totals.km > 0 ? fmtKm(totals.km) : "—"} color={C.warning} />
        </div>

        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 12,
            fontSize: 11,
            color: C.textMute,
            alignItems: "center",
          }}
        >
          <span style={{ fontWeight: 700, color: C.textMid }}>Bateria:</span>
          {[
            [C.success, "≥13V normal"],
            [C.warning, "12–13V atenção"],
            [C.danger, "<12V crítico"],
          ].map(([c, l]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: c as string, display: "inline-block" }} />
              {l}
            </span>
          ))}
          <span style={{ marginLeft: "auto", color: C.textMute }}>● SEM SINAL = não transmitiu nos últimos 10min</span>
        </div>

        {kbRows.length > 0 && <KbSummarySection rows={kbRows} />}
        {kbHistory.length > 0 && <KbHistorySection rows={kbHistory} />}

        {loading && nonKbEquips.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.textMute }}>Carregando…</div>
        ) : nonKbEquips.length === 0 ? (
          <div
            style={{
              background: "#fffbeb",
              border: `1px solid #fde68a`,
              borderRadius: 8,
              padding: "14px 16px",
              color: C.warning,
              fontSize: 13,
            }}
          >
            Nenhum equipamento encontrado.
          </div>
        ) : (
          [...groups.entries()].map(([obra, rows]) => <ObraSection key={obra} obra={obra} equips={rows} />)
        )}

        {semComunicacao.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 12px",
                background: "#fefce8",
                border: `1px solid #fde68a`,
                borderBottom: "none",
                borderRadius: "8px 8px 0 0",
              }}
            >
              <div style={{ width: 3, height: 16, borderRadius: 2, background: "#d97706" }} />
              <span style={{ fontWeight: 700, fontSize: 13, color: "#92400e" }}>⚠️ Sem Comunicação</span>
              <span style={{ fontSize: 12, color: "#b45309" }}>
                {semComunicacao.length} equipamentos sem sinal há mais de 7 dias
              </span>
            </div>

            <div style={{ overflowX: "auto" }}>
              <div style={{ minWidth: TABLE_MIN_WIDTH, width: "100%" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: MAIN_GRID,
                    gap: COMPACT_GAP,
                    padding: "5px 12px",
                    background: "#fffbeb",
                    border: `1px solid #fde68a`,
                    borderBottom: "none",
                    fontSize: 10,
                    color: "#b45309",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    width: "100%",
                  }}
                >
                  <div>Equipamento</div>
                  <div style={{ textAlign: "center" }}>Dias</div>
                  <div style={{ textAlign: "center" }}>Obra</div>
                  <div style={{ textAlign: "center" }}>Bateria</div>
                  <div style={{ textAlign: "center" }} />
                  <div style={{ textAlign: "center" }} />
                  <div style={{ textAlign: "right" }}>Último sinal</div>
                </div>

                <div style={{ border: `1px solid #fde68a`, borderRadius: "0 0 8px 8px", overflow: "hidden", width: "100%" }}>
                  {semComunicacao
                    .sort((a, b) => b.diasSemSinal - a.diasSemSinal)
                    .map((eq) => (
                      <div
                        key={eq.pos_equip_id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: MAIN_GRID,
                          alignItems: "center",
                          gap: COMPACT_GAP,
                          padding: "8px 12px",
                          borderBottom: `1px solid #fef3c7`,
                          background: "#fffdf0",
                          fontSize: 13,
                          width: "100%",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {eq.nome}
                          </div>
                          <div style={{ fontSize: 11, color: C.textMute, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {eq.placa}
                          </div>
                        </div>

                        <div style={{ textAlign: "center", fontWeight: 700, color: eq.diasSemSinal > 30 ? C.danger : "#d97706" }}>
                          {eq.diasSemSinal}d
                        </div>

                        <div style={{ textAlign: "center", fontSize: 12, color: C.textMid, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {eq.obra}
                        </div>

                        <div style={{ textAlign: "center", fontWeight: 700, color: tensaoColor(eq.tensao) }}>
                          {eq.tensao != null ? `${eq.tensao.toFixed(1)}V` : "—"}
                        </div>

                        <div />
                        <div />

                        <div style={{ textAlign: "right", fontSize: 11, color: C.textMute }}>
                          {eq.ultimaPosISO
                            ? new Date(eq.ultimaPosISO).toLocaleDateString("pt-BR", {
                                timeZone: "America/Sao_Paulo",
                                day: "2-digit",
                                month: "2-digit",
                                year: "2-digit",
                              })
                            : "—"}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
