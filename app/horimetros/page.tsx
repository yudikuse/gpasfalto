
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type MeasurementMode = "horimetro" | "odometro";

type ObraRow = {
  id: number;
  obra: string;
  ativo?: boolean | null;
};

type EquipamentoRow = {
  id: number;
  codigo: string;
  obra_padrao_id?: number | null;
  usa_horimetro?: boolean | null;
  usa_odometro?: boolean | null;
  ativo?: boolean | null;
  observacao?: string | null;
  horimetro_base?: number | null;
  odometro_base?: number | null;
};

type LeituraRow = {
  id: number;
  data: string;
  obra_id?: number | null;
  equipamento_id: number;
  horimetro_inicial?: number | null;
  horimetro_final?: number | null;
  horas_trabalhadas?: number | null;
  odometro_inicial?: number | null;
  odometro_final?: number | null;
  km_rodados?: number | null;
  observacao?: string | null;
  status?: string | null;
  updated_by_user_id?: string | null;
  updated_by_nome?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type RowState = {
  equipamentoId: number;
  codigo: string;
  obraId: string;
  novaObra: string;
  showNovaObra: boolean;
  selectedMode: MeasurementMode;
  horimetroAnterior: number | null;
  horimetroAtual: string;
  horasDia: number | null;
  odometroAnterior: number | null;
  odometroAtual: string;
  kmDia: number | null;
  observacao: string;
  isTrocaMedidor: boolean;
  keepPreviousApplied: boolean;
  registroId: number | null;
  updatedAt: string | null;
  updatedByNome: string | null;
};

function pad(n: number, size: number) {
  const s = String(n);
  return s.length >= size ? s : "0".repeat(size - s.length) + s;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

function previousIso(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

function isoToBr(iso: string) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || "—";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function resolveSupabaseEnv(): { ok: boolean; url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const key = publishable || anon;
  return { ok: Boolean(url && key), url, key };
}

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function normCode(value: string) {
  return normalizeText(String(value || "").replace(/_/g, "-").replace(/\s+/g, ""));
}

function modeFromPrefix(codigo: string): MeasurementMode {
  const code = normCode(codigo);
  if (
    code.startsWith("CB") ||
    code.startsWith("CC") ||
    code.startsWith("CP") ||
    code.startsWith("KB")
  ) {
    return "odometro";
  }
  return "horimetro";
}

function resolveInitialMode(eq: EquipamentoRow, atual?: LeituraRow | null): MeasurementMode {
  const hasH =
    atual?.horimetro_final != null ||
    atual?.horimetro_inicial != null ||
    eq.usa_horimetro === true;

  const hasO =
    atual?.odometro_final != null ||
    atual?.odometro_inicial != null ||
    eq.usa_odometro === true;

  if (hasH && !hasO) return "horimetro";
  if (hasO && !hasH) return "odometro";
  return modeFromPrefix(eq.codigo);
}

function format1(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function parsePtNumber(value: string) {
  const s = String(value || "").trim();
  if (!s) return null;

  const normalized = s.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") {
    return null;
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function sanitizeDecimalDraft(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";

  const padded = digits.padStart(2, "0");
  const intPart = padded.slice(0, -1).replace(/^0+(?=\d)/, "") || "0";
  const decPart = padded.slice(-1);
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  return `${intFormatted},${decPart}`;
}

function safePositiveDiff(finalValue: number | null, initialValue: number | null) {
  if (finalValue == null || initialValue == null) return null;
  if (finalValue < initialValue) return null;
  const diff = Number((finalValue - initialValue).toFixed(1));
  return Number.isFinite(diff) ? diff : null;
}

function stripTrocaPrefix(text: string) {
  return String(text || "").replace(/^\s*\[TROCA\]\s*/i, "").trimStart();
}

function hasTrocaPrefix(text: string) {
  return /^\s*\[TROCA\]\s*/i.test(String(text || ""));
}

function composeObservacao(text: string, isTrocaMedidor: boolean) {
  const clean = stripTrocaPrefix(text).trim();
  if (isTrocaMedidor) return clean ? `[TROCA] ${clean}` : "[TROCA]";
  return clean || null;
}

function buildRows(params: {
  equipamentos: EquipamentoRow[];
  atuais: LeituraRow[];
  anteriores: LeituraRow[];
}): RowState[] {
  const { equipamentos, atuais, anteriores } = params;

  const atualMap = new Map<number, LeituraRow>();
  const anteriorMap = new Map<number, LeituraRow>();

  for (const row of atuais) atualMap.set(Number(row.equipamento_id), row);
  for (const row of anteriores) {
    const key = Number(row.equipamento_id);
    if (!anteriorMap.has(key)) anteriorMap.set(key, row);
  }

  return equipamentos.map((eq) => {
    const atual = atualMap.get(eq.id);
    const anterior = anteriorMap.get(eq.id);

    const horimetroAnterior =
      atual?.horimetro_inicial ?? anterior?.horimetro_final ?? eq.horimetro_base ?? null;

    const odometroAnterior =
      atual?.odometro_inicial ?? anterior?.odometro_final ?? eq.odometro_base ?? null;

    const observacaoRaw = String(atual?.observacao || "");
    const isTrocaMedidor = hasTrocaPrefix(observacaoRaw);

    const horimetroAtualNum = atual?.horimetro_final ?? null;
    const odometroAtualNum = atual?.odometro_final ?? null;

    return {
      equipamentoId: eq.id,
      codigo: eq.codigo,
      obraId: String(atual?.obra_id ?? ""),
      novaObra: "",
      showNovaObra: false,
      selectedMode: resolveInitialMode(eq, atual),
      horimetroAnterior,
      horimetroAtual: horimetroAtualNum == null ? "" : format1(horimetroAtualNum),
      horasDia: safePositiveDiff(horimetroAtualNum, horimetroAnterior),
      odometroAnterior,
      odometroAtual: odometroAtualNum == null ? "" : format1(odometroAtualNum),
      kmDia: safePositiveDiff(odometroAtualNum, odometroAnterior),
      observacao: stripTrocaPrefix(observacaoRaw),
      isTrocaMedidor,
      keepPreviousApplied: false,
      registroId: atual?.id ?? null,
      updatedAt: atual?.updated_at ?? null,
      updatedByNome: atual?.updated_by_nome ?? null,
    };
  });
}

function getPreviousValue(row: RowState) {
  return row.selectedMode === "horimetro" ? row.horimetroAnterior : row.odometroAnterior;
}

function getCurrentValue(row: RowState) {
  return row.selectedMode === "horimetro" ? row.horimetroAtual : row.odometroAtual;
}

function getDayValue(row: RowState) {
  return row.selectedMode === "horimetro" ? row.horasDia : row.kmDia;
}

function getCurrentNumericValue(row: RowState) {
  return row.selectedMode === "horimetro"
    ? parsePtNumber(row.horimetroAtual)
    : parsePtNumber(row.odometroAtual);
}

function getAlertText(row: RowState) {
  if (row.isTrocaMedidor) return null;

  const previous = getPreviousValue(row);
  const current = getCurrentNumericValue(row);

  if (previous == null || current == null) return null;
  if (current < previous) return "Abaixo de ontem";
  return null;
}

function canSaveRow(row: RowState) {
  const previous = getPreviousValue(row);
  const current = getCurrentNumericValue(row);

  if (!row.obraId && !row.novaObra.trim()) return false;
  if (current == null) return false;
  if (previous == null) return true;
  if (current < previous && !row.isTrocaMedidor) return false;
  return true;
}

function validateRow(row: RowState) {
  const previous = getPreviousValue(row);
  const current = getCurrentNumericValue(row);

  if (!row.obraId && !row.novaObra.trim()) {
    return `${row.codigo}: selecione a obra ou cadastre uma nova obra.`;
  }

  if (current == null) {
    return `${row.codigo}: informe o valor atual.`;
  }

  if (current < (previous ?? current) && !row.isTrocaMedidor) {
    return `${row.codigo}: valor atual não pode ser menor que o anterior sem marcar troca.`;
  }

  return null;
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusDot({ saved }: { saved: boolean }) {
  return <span className={`status-dot ${saved ? "saved" : "pending"}`} />;
}

export default function HorimetrosPage() {
  const env = resolveSupabaseEnv();

  const supabase: SupabaseClient | null = useMemo(() => {
    if (!env.ok) return null;
    return createClient(env.url, env.key);
  }, [env.ok, env.key, env.url]);

  const [loading, setLoading] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [savingRowId, setSavingRowId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [selectedDate, setSelectedDate] = useState(todayIso());
  const [search, setSearch] = useState("");
  const [obras, setObras] = useState<ObraRow[]>([]);
  const [rows, setRows] = useState<RowState[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const periodoAnterior = useMemo(() => previousIso(selectedDate), [selectedDate]);

  const stats = useMemo(() => {
    const total = rows.length;
    const lancados = rows.filter((row) => row.registroId != null).length;
    const pendentes = Math.max(total - lancados, 0);
    return { total, lancados, pendentes };
  }, [rows]);

  const allKeepApplied = useMemo(
    () => rows.length > 0 && rows.every((row) => row.keepPreviousApplied),
    [rows]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();

    const base = rows.filter((row) => {
      if (!q) return true;
      const obra = obras.find((o) => String(o.id) === row.obraId)?.obra || row.novaObra || "";
      return (
        row.codigo.toLowerCase().includes(q) ||
        obra.toLowerCase().includes(q) ||
        row.selectedMode.toLowerCase().includes(q)
      );
    });

    return [...base].sort((a, b) => {
      const obraA = normalizeText(
        obras.find((o) => String(o.id) === a.obraId)?.obra || a.novaObra || "ZZZZ SEM OBRA"
      );
      const obraB = normalizeText(
        obras.find((o) => String(o.id) === b.obraId)?.obra || b.novaObra || "ZZZZ SEM OBRA"
      );

      const byObra = obraA.localeCompare(obraB, "pt-BR");
      if (byObra !== 0) return byObra;

      return normCode(a.codigo).localeCompare(normCode(b.codigo), "pt-BR");
    });
  }, [rows, search, obras]);

  const loadData = useCallback(async () => {
    if (!supabase) return;

    setLoading(true);
    setErrorMsg("");
    setOkMsg("");

    try {
      const [obrasRes, equipamentosRes, atuaisRes, anterioresRes] = await Promise.all([
        supabase
          .from("obras")
          .select("id,obra,ativo")
          .eq("ativo", true)
          .order("obra", { ascending: true })
          .limit(500),

        supabase
          .from("horimetro_equipamentos")
          .select(
            "id,codigo,obra_padrao_id,usa_horimetro,usa_odometro,ativo,observacao,horimetro_base,odometro_base"
          )
          .eq("ativo", true)
          .order("codigo", { ascending: true })
          .limit(500),

        supabase
          .from("horimetro_leituras_diarias")
          .select(
            "id,data,obra_id,equipamento_id,horimetro_inicial,horimetro_final,horas_trabalhadas,odometro_inicial,odometro_final,km_rodados,observacao,updated_by_user_id,updated_by_nome,updated_at,created_at"
          )
          .eq("data", selectedDate)
          .order("equipamento_id", { ascending: true })
          .limit(1000),

        supabase
          .from("horimetro_leituras_diarias")
          .select(
            "id,data,obra_id,equipamento_id,horimetro_inicial,horimetro_final,horas_trabalhadas,odometro_inicial,odometro_final,km_rodados,observacao,updated_by_user_id,updated_by_nome,updated_at,created_at"
          )
          .lt("data", selectedDate)
          .order("data", { ascending: false })
          .order("updated_at", { ascending: false })
          .limit(5000),
      ]);

      if (obrasRes.error) throw obrasRes.error;
      if (equipamentosRes.error) throw equipamentosRes.error;
      if (atuaisRes.error) throw atuaisRes.error;
      if (anterioresRes.error) throw anterioresRes.error;

      const obrasData = (obrasRes.data || []) as ObraRow[];
      const equipamentosData = ((equipamentosRes.data || []) as EquipamentoRow[]).sort((a, b) =>
        normCode(a.codigo).localeCompare(normCode(b.codigo), "pt-BR")
      );

      const anterioresDedup: LeituraRow[] = [];
      const seen = new Set<number>();

      for (const row of (anterioresRes.data || []) as LeituraRow[]) {
        const eqId = Number(row.equipamento_id);
        if (seen.has(eqId)) continue;
        seen.add(eqId);
        anterioresDedup.push(row);
      }

      const built = buildRows({
        equipamentos: equipamentosData,
        atuais: (atuaisRes.data || []) as LeituraRow[],
        anteriores: anterioresDedup,
      });

      setObras(obrasData);
      setRows(built);
      const firstPending = built.find((r) => r.registroId == null);
      if (firstPending) setExpandedId(firstPending.equipamentoId);
    } catch (e: any) {
      setRows([]);
      setErrorMsg(e?.message || "Erro ao carregar horímetros.");
    } finally {
      setLoading(false);
    }
  }, [selectedDate, supabase]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const updateRow = useCallback((equipamentoId: number, patch: Partial<RowState>) => {
    setRows((current) =>
      current.map((row) => {
        if (row.equipamentoId !== equipamentoId) return row;

        const next = { ...row, ...patch };
        const hAtual = parsePtNumber(next.horimetroAtual);
        const oAtual = parsePtNumber(next.odometroAtual);

        next.horasDia = safePositiveDiff(hAtual, next.horimetroAnterior);
        next.kmDia = safePositiveDiff(oAtual, next.odometroAnterior);

        return next;
      })
    );
  }, []);

  const updateActiveInput = useCallback((equipamentoId: number, value: string) => {
    const sanitized = sanitizeDecimalDraft(value);

    setRows((current) =>
      current.map((row) => {
        if (row.equipamentoId !== equipamentoId) return row;

        const next = { ...row, keepPreviousApplied: false };

        if (next.selectedMode === "horimetro") next.horimetroAtual = sanitized;
        else next.odometroAtual = sanitized;

        const hAtual = parsePtNumber(next.horimetroAtual);
        const oAtual = parsePtNumber(next.odometroAtual);

        next.horasDia = safePositiveDiff(hAtual, next.horimetroAnterior);
        next.kmDia = safePositiveDiff(oAtual, next.odometroAnterior);

        return next;
      })
    );
  }, []);

  const finalizeActiveInput = useCallback((equipamentoId: number, value: string) => {
    const finalValue = sanitizeDecimalDraft(value);

    setRows((current) =>
      current.map((row) => {
        if (row.equipamentoId !== equipamentoId) return row;

        const next = { ...row };

        if (next.selectedMode === "horimetro") next.horimetroAtual = finalValue;
        else next.odometroAtual = finalValue;

        const hAtual = parsePtNumber(next.horimetroAtual);
        const oAtual = parsePtNumber(next.odometroAtual);

        next.horasDia = safePositiveDiff(hAtual, next.horimetroAnterior);
        next.kmDia = safePositiveDiff(oAtual, next.odometroAnterior);

        return next;
      })
    );
  }, []);

  const toggleKeepPreviousForRow = useCallback((row: RowState) => {
    const previous = getPreviousValue(row);

    setRows((current) =>
      current.map((item) => {
        if (item.equipamentoId !== row.equipamentoId) return item;

        const next = { ...item };
        const nextApplied = !item.keepPreviousApplied;
        next.keepPreviousApplied = nextApplied;

        if (nextApplied && previous != null) {
          const formatted = format1(previous);
          if (next.selectedMode === "horimetro") next.horimetroAtual = formatted;
          else next.odometroAtual = formatted;
        } else if (!nextApplied) {
          if (next.selectedMode === "horimetro") next.horimetroAtual = "";
          else next.odometroAtual = "";
        }

        const hAtual = parsePtNumber(next.horimetroAtual);
        const oAtual = parsePtNumber(next.odometroAtual);

        next.horasDia = safePositiveDiff(hAtual, next.horimetroAnterior);
        next.kmDia = safePositiveDiff(oAtual, next.odometroAnterior);

        return next;
      })
    );
  }, []);

  const toggleKeepPreviousForAll = useCallback(() => {
    setRows((current) =>
      current.map((row) => {
        const next = { ...row };
        const previous = getPreviousValue(row);
        const nextApplied = !allKeepApplied;
        next.keepPreviousApplied = nextApplied;

        if (nextApplied && previous != null) {
          const formatted = format1(previous);
          if (next.selectedMode === "horimetro") next.horimetroAtual = formatted;
          else next.odometroAtual = formatted;
        } else if (!nextApplied) {
          if (next.selectedMode === "horimetro") next.horimetroAtual = "";
          else next.odometroAtual = "";
        }

        const hAtual = parsePtNumber(next.horimetroAtual);
        const oAtual = parsePtNumber(next.odometroAtual);

        next.horasDia = safePositiveDiff(hAtual, next.horimetroAnterior);
        next.kmDia = safePositiveDiff(oAtual, next.odometroAnterior);

        return next;
      })
    );
  }, [allKeepApplied]);

  const ensureObraForSave = useCallback(
    async (row: RowState) => {
      if (row.obraId) return row.obraId;

      const nova = row.novaObra.trim();
      if (!nova) return "";

      const existing = obras.find((o) => normalizeText(o.obra) === normalizeText(nova));
      if (existing) return String(existing.id);

      if (!supabase) return "";

      const insertRes = await supabase
        .from("obras")
        .insert({ obra: nova, ativo: true })
        .select("id,obra,ativo")
        .single();

      if (insertRes.error) throw insertRes.error;

      const created = insertRes.data as ObraRow;

      setObras((current) =>
        [...current, created].sort((a, b) => a.obra.localeCompare(b.obra, "pt-BR"))
      );

      return String(created.id);
    },
    [obras, supabase]
  );

  const saveOneRow = useCallback(
    async (row: RowState) => {
      if (!supabase) return;

      const validationError = validateRow(row);
      if (validationError) {
        setErrorMsg(validationError);
        setOkMsg("");
        return;
      }

      setSavingRowId(row.equipamentoId);
      setErrorMsg("");
      setOkMsg("");

      try {
        const obraIdToSave = await ensureObraForSave(row);
        if (!obraIdToSave) throw new Error(`${row.codigo}: obra inválida.`);

        const authRes = await supabase.auth.getUser();
        const user = authRes.data.user;
        const updatedByName = user?.email || user?.user_metadata?.name || "Usuário";
        const updatedById = user?.id || null;

        const horimetroFinal = parsePtNumber(row.horimetroAtual);
        const odometroFinal = parsePtNumber(row.odometroAtual);

        const payload = {
          data: selectedDate,
          obra_id: Number(obraIdToSave),
          equipamento_id: row.equipamentoId,
          horimetro_inicial:
            horimetroFinal != null || row.horimetroAnterior != null ? row.horimetroAnterior : null,
          horimetro_final: horimetroFinal,
          odometro_inicial:
            odometroFinal != null || row.odometroAnterior != null ? row.odometroAnterior : null,
          odometro_final: odometroFinal,
          observacao: composeObservacao(row.observacao, row.isTrocaMedidor),
          updated_by_user_id: updatedById,
          updated_by_nome: updatedByName,
          updated_at: new Date().toISOString(),
        };

        if (row.registroId != null) {
          const res = await supabase
            .from("horimetro_leituras_diarias")
            .update(payload)
            .eq("id", row.registroId);

          if (res.error) throw res.error;
        } else {
          const res = await supabase
            .from("horimetro_leituras_diarias")
            .insert(payload)
            .select("id")
            .single();

          if (res.error) throw res.error;
        }

        setRows((current) =>
          current.map((item) =>
            item.equipamentoId === row.equipamentoId
              ? {
                  ...item,
                  obraId: obraIdToSave,
                  novaObra: "",
                  showNovaObra: false,
                }
              : item
          )
        );

        setOkMsg(`${row.codigo} salvo com sucesso.`);
        await loadData();
        setRows((current) => {
          const nextPending = current.find(
            (r) => r.equipamentoId !== row.equipamentoId && r.registroId == null
          );
          if (nextPending) setExpandedId(nextPending.equipamentoId);
          else setExpandedId(null);
          return current;
        });
      } catch (e: any) {
        setErrorMsg(e?.message || `Erro ao salvar ${row.codigo}.`);
      } finally {
        setSavingRowId(null);
      }
    },
    [ensureObraForSave, loadData, selectedDate, supabase]
  );

  const handleSaveAll = useCallback(async () => {
    if (!supabase) return;

    setSavingAll(true);
    setErrorMsg("");
    setOkMsg("");

    try {
      for (const row of rows) {
        const current = getCurrentNumericValue(row);
        const hasAnyWork =
          current != null ||
          Boolean(row.novaObra.trim()) ||
          Boolean(row.obraId);

        if (!hasAnyWork) continue;

        const validationError = validateRow(row);
        if (validationError) throw new Error(validationError);
      }

      const authRes = await supabase.auth.getUser();
      const user = authRes.data.user;
      const updatedByName = user?.email || user?.user_metadata?.name || "Usuário";
      const updatedById = user?.id || null;

      for (const row of rows) {
        const horimetroFinal = parsePtNumber(row.horimetroAtual);
        const odometroFinal = parsePtNumber(row.odometroAtual);

        const hasAnyWork =
          horimetroFinal != null ||
          odometroFinal != null ||
          Boolean(row.novaObra.trim()) ||
          Boolean(row.obraId);

        if (!hasAnyWork) continue;

        const obraIdToSave = await ensureObraForSave(row);
        if (!obraIdToSave) throw new Error(`${row.codigo}: obra inválida.`);

        const payload = {
          data: selectedDate,
          obra_id: Number(obraIdToSave),
          equipamento_id: row.equipamentoId,
          horimetro_inicial:
            horimetroFinal != null || row.horimetroAnterior != null ? row.horimetroAnterior : null,
          horimetro_final: horimetroFinal,
          odometro_inicial:
            odometroFinal != null || row.odometroAnterior != null ? row.odometroAnterior : null,
          odometro_final: odometroFinal,
          observacao: composeObservacao(row.observacao, row.isTrocaMedidor),
          updated_by_user_id: updatedById,
          updated_by_nome: updatedByName,
          updated_at: new Date().toISOString(),
        };

        if (row.registroId != null) {
          const res = await supabase
            .from("horimetro_leituras_diarias")
            .update(payload)
            .eq("id", row.registroId);

          if (res.error) throw res.error;
        } else {
          const res = await supabase
            .from("horimetro_leituras_diarias")
            .insert(payload)
            .select("id")
            .single();

          if (res.error) throw res.error;
        }
      }

      setOkMsg("Tudo salvo com sucesso.");
      await loadData();
    } catch (e: any) {
      setErrorMsg(e?.message || "Erro ao salvar lançamentos.");
    } finally {
      setSavingAll(false);
    }
  }, [ensureObraForSave, loadData, rows, selectedDate, supabase]);

  return (
    <>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800;900&display=swap');

        :root {
          --bg: #eef0f6;
          --surface: #ffffff;
          --surface-soft: #f4f6fb;
          --line: #e4e8f2;
          --line-strong: #c9d1e3;
          --text: #0d1117;
          --muted: #6b7a99;
          --brand: #f59e0b;
          --brand-dark: #d97706;
          --brand-soft: #fffbeb;
          --blue: #3b82f6;
          --blue-soft: #eff6ff;
          --success: #16a34a;
          --success-soft: #f0fdf4;
          --danger: #dc2626;
          --danger-soft: #fff1f2;
          --shadow-sm: 0 1px 3px rgba(13,17,23,0.07), 0 1px 2px rgba(13,17,23,0.04);
          --shadow-md: 0 4px 16px rgba(13,17,23,0.08), 0 1px 4px rgba(13,17,23,0.04);
        }

        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); }
        body { font-family: 'Sora', -apple-system, BlinkMacSystemFont, sans-serif; -webkit-font-smoothing: antialiased; }
        input, select, button { font: inherit; }

        /* ── PAGE SHELL ── */
        .page { min-height: 100vh; padding: 0 0 24px; }

        .shell {
          width: min(100%, 780px);
          margin: 0 auto;
          display: grid;
          gap: 8px;
        }

        /* ── HEADER (dark panel) ── */
        .header {
          background: #0d1117;
          padding: 14px 14px 16px;
          display: grid;
          gap: 12px;
          border-radius: 0 0 22px 22px;
        }

        .header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }

        .logo {
          width: 34px; height: 34px;
          border-radius: 9px;
          background: var(--brand);
          overflow: hidden;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
        }
        .logo img { width: 100%; height: 100%; object-fit: cover; }

        .eyebrow { margin: 0; font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #6b7a99; }
        .title { margin: 0; font-size: 15px; font-weight: 800; letter-spacing: -.02em; color: #ffffff; }
        .subtitle { display: none; }

        .period {
          font-size: 10px;
          color: #6b7a99;
          font-weight: 600;
          text-align: right;
          line-height: 1.5;
          white-space: nowrap;
        }
        .period strong { color: var(--brand); }

        /* ── STATS STRIP ── */
        .stats-strip {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 6px;
        }

        .stat-card {
          background: #161b27;
          border-radius: 12px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .stat-card-label { font-size: 9px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #4a5568; }
        .stat-card-value { font-size: 20px; font-weight: 900; letter-spacing: -.04em; color: #fff; }
        .stat-card.green .stat-card-value { color: #4ade80; }
        .stat-card.amber .stat-card-value { color: var(--brand); }

        /* ── CONTROLS ── */
        .controls {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 6px;
          align-items: end;
        }

        .field { display: grid; gap: 3px; }
        .field label { font-size: 9px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; color: #5a6580; }

        .search, .date, .select, .number-input, .new-obra-input,
        .keep-btn, .keep-all-btn, .save-btn, .sheet-btn {
          width: 100%;
          height: 36px;
          border: 1px solid #1e2536;
          border-radius: 10px;
          background: #161b27;
          color: #e2e8f0;
          outline: none;
          padding: 0 10px;
          font-size: 13px;
          font-weight: 600;
          transition: .15s ease;
        }

        .search::placeholder, .date::placeholder { color: #3d4a63; }

        .search:focus, .date:focus {
          background: #1a2133;
          border-color: var(--brand);
          box-shadow: 0 0 0 3px rgba(245,158,11,.12);
          color: #fff;
        }

        .save-btn {
          border: 0;
          background: var(--brand);
          color: #0d1117;
          font-weight: 800;
          cursor: pointer;
          white-space: nowrap;
          letter-spacing: -.01em;
        }
        .save-btn:hover { background: var(--brand-dark); }
        .save-btn[disabled] { opacity: .65; cursor: wait; }

        /* ── TOOLBAR (below header, in light zone) ── */
        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          padding: 0 2px;
        }

        .toolbar-label { font-size: 11px; font-weight: 700; color: var(--muted); }

        .keep-all-btn, .keep-btn, .sheet-btn {
          border: 1.5px solid var(--line);
          background: var(--surface);
          color: var(--muted);
          cursor: pointer;
        }
        .keep-all-btn { width: auto; min-width: 108px; padding: 0 12px; font-size: 11px; height: 32px; border-radius: 10px; font-weight: 700; }
        .keep-btn { width: auto; min-width: 42px; height: 32px; padding: 0 8px; font-size: 11px; border-radius: 8px; font-weight: 700; }
        .sheet-btn { width: auto; padding: 0 12px; font-size: 11px; height: 32px; border-radius: 8px; font-weight: 700; }

        .keep-all-btn:hover, .keep-btn:hover, .sheet-btn:hover { background: var(--blue-soft); color: var(--blue); border-color: #bfdbfe; }
        .keep-all-btn.active, .keep-btn.active { background: var(--blue); border-color: var(--blue); color: #fff; }

        /* ── MESSAGES ── */
        .message {
          background: var(--surface);
          border: 1.5px solid var(--line);
          border-radius: 12px;
          padding: 9px 14px;
          font-size: 12px;
          font-weight: 700;
          margin: 0 2px;
          box-shadow: var(--shadow-sm);
        }
        .message.error { color: var(--danger); border-color: #fecaca; background: var(--danger-soft); }
        .message.ok { color: var(--success); border-color: #bbf7d0; background: var(--success-soft); }

        /* ── LIST ── */
        .list { display: grid; gap: 6px; padding: 0 2px; }

        /* ── ACCORDION CARD ── */
        .card {
          background: var(--surface);
          border: 1.5px solid var(--line);
          border-radius: 14px;
          box-shadow: var(--shadow-sm);
          overflow: hidden;
          position: relative;
        }

        /* left status bar */
        .card::before {
          content: '';
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 4px;
          background: var(--danger);
          border-radius: 14px 0 0 14px;
        }
        .card.saved::before { background: var(--success); }

        /* collapsed header row */
        .card-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 11px 12px 11px 16px;
          cursor: pointer;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .card-header:active { background: var(--surface-soft); }

        .equip-code {
          margin: 0;
          font-size: 14px;
          font-weight: 800;
          letter-spacing: -.02em;
          min-width: 52px;
          color: var(--text);
        }

        .equip-sub {
          flex: 1;
          font-size: 11px;
          color: var(--muted);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .card-preview {
          font-size: 12px;
          font-weight: 800;
          color: var(--success);
          white-space: nowrap;
          background: var(--success-soft);
          border: 1px solid #bbf7d0;
          padding: 2px 7px;
          border-radius: 999px;
        }
        .card-preview.pending {
          color: #94a3b8;
          background: #f8fafc;
          border-color: var(--line);
        }

        .status-dot {
          width: 7px; height: 7px;
          border-radius: 999px;
          display: inline-block;
          flex-shrink: 0;
        }
        .status-dot.saved { background: var(--success); }
        .status-dot.pending { background: var(--danger); }

        .chevron {
          font-size: 10px;
          color: #94a3b8;
          transition: transform .2s;
          flex-shrink: 0;
        }
        .chevron.open { transform: rotate(180deg); }

        /* expanded body */
        .card-body {
          border-top: 1.5px solid var(--line);
          background: var(--surface-soft);
          padding: 12px 12px 12px 16px;
          display: grid;
          gap: 10px;
        }

        /* mode toggle */
        .mode-row { display: flex; align-items: center; gap: 6px; }

        .segmented {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 3px;
          border-radius: 999px;
          background: var(--surface);
          border: 1.5px solid var(--line);
        }
        .segmented button {
          height: 26px;
          min-width: 46px;
          border: 0;
          border-radius: 999px;
          padding: 0 10px;
          background: transparent;
          color: var(--muted);
          font-size: 10px;
          font-weight: 800;
          cursor: pointer;
          letter-spacing: .02em;
        }
        .segmented button.active { background: #0d1117; color: var(--brand); }

        /* values row */
        .values {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }

        .value-box {
          background: var(--surface);
          border: 1.5px solid var(--line);
          border-radius: 10px;
          padding: 7px 10px;
          min-height: 48px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 3px;
        }
        .value-box-title { font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
        .value-box-main { font-size: 17px; font-weight: 900; letter-spacing: -.04em; color: var(--text); }
        .value-box-main.muted { color: #c2cad8; }
        .value-box-main.success { color: var(--success); }

        .alert-chip {
          display: inline-flex;
          align-items: center;
          min-height: 20px;
          padding: 0 7px;
          border-radius: 999px;
          background: var(--danger-soft);
          border: 1px solid #fecaca;
          color: var(--danger);
          font-size: 10px;
          font-weight: 800;
          white-space: nowrap;
        }

        /* obra block */
        .block { display: grid; gap: 4px; }
        .block-label { font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }

        .obra-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 5px;
          align-items: center;
        }

        .select, .new-obra-input {
          border: 1.5px solid var(--line);
          background: var(--surface);
          color: var(--text);
          border-radius: 10px;
          height: 36px;
          padding: 0 10px;
          font-size: 13px;
          font-weight: 600;
          outline: none;
        }
        .select:focus, .new-obra-input:focus {
          border-color: var(--blue);
          box-shadow: 0 0 0 3px rgba(59,130,246,.1);
        }

        .sheet {
          margin-top: 2px;
          display: grid;
          gap: 6px;
          padding: 10px;
          border-radius: 10px;
          background: var(--surface);
          border: 1.5px solid var(--line);
        }
        .sheet-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
        .sheet-btn {
          border-radius: 9px !important;
          background: var(--surface-soft);
          border: 1.5px solid var(--line);
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
          height: 34px;
          width: auto;
          padding: 0 12px;
          cursor: pointer;
        }
        .sheet-btn:hover { background: var(--blue-soft); color: var(--blue); border-color: #bfdbfe; }

        /* input + save row */
        .input-save-row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 5px;
          align-items: center;
        }

        .number-input {
          text-align: right;
          font-variant-numeric: tabular-nums;
          border: 1.5px solid var(--line-strong) !important;
          background: var(--surface) !important;
          color: var(--text) !important;
          border-radius: 10px;
          height: 36px;
          font-weight: 700;
          font-size: 14px;
          padding: 0 10px;
          outline: none;
        }
        .number-input:focus {
          border-color: var(--blue) !important;
          box-shadow: 0 0 0 3px rgba(59,130,246,.1);
        }
        .number-input::placeholder { color: #c2cad8; }

        .keep-btn {
          background: var(--surface);
          border: 1.5px solid var(--line);
          color: var(--muted);
          font-weight: 700;
          font-size: 11px;
          height: 36px;
          border-radius: 9px;
          min-width: 42px;
          cursor: pointer;
          padding: 0 8px;
          width: auto;
        }
        .keep-btn:hover { background: var(--blue-soft); color: var(--blue); border-color: #bfdbfe; }
        .keep-btn.active { background: var(--blue); border-color: var(--blue); color: #fff; }

        .row-save {
          width: 36px; height: 36px;
          border: 0;
          border-radius: 9px;
          background: var(--brand);
          color: #0d1117;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: .15s ease;
        }
        .row-save:hover { background: var(--brand-dark); }
        .row-save[disabled] { opacity: .35; cursor: not-allowed; background: var(--line); color: var(--muted); }

        /* obs block */
        .obs-block { display: grid; gap: 4px; }
        .obs-row { display: flex; align-items: center; gap: 8px; }
        .troca-toggle {
          display: flex; align-items: center; gap: 5px;
          font-size: 11px; font-weight: 700; color: var(--muted);
          cursor: pointer;
          user-select: none;
          padding: 4px 0;
        }
        .troca-toggle input[type=checkbox] { accent-color: var(--brand); width: 15px; height: 15px; cursor: pointer; }

        .empty {
          background: var(--surface);
          border: 1.5px solid var(--line);
          border-radius: 14px;
          padding: 20px 16px;
          color: var(--muted);
          font-size: 13px;
          font-weight: 600;
          text-align: center;
          margin: 0 2px;
        }

        /* unused but kept for save-all flow */
        .save-row, .card-top, .card-title, .status-wrap, .footer-row, .mode-row-old { display: none; }

        @media (min-width: 760px) {
          .shell { width: min(100%, 980px); }
          .list { grid-template-columns: 1fr 1fr; }
          .subtitle { display: block; margin: 1px 0 0; font-size: 11px; color: #4a5568; font-weight: 500; }
        }
      `}</style>

      <main className="page">
        <div className="shell">

          {/* ── DARK HEADER ── */}
          <section className="header">
            <div className="header-top">
              <div className="brand">
                <div className="logo">
                  <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
                </div>
                <div>
                  <p className="eyebrow">GP Asfalto</p>
                  <h1 className="title">Horímetros e Odômetros</h1>
                  <p className="subtitle">Lançamento diário por equipamento</p>
                </div>
              </div>

              <div className="period">
                Ant: {isoToBr(periodoAnterior)}
                <br />
                <strong>Atual: {isoToBr(selectedDate)}</strong>
              </div>
            </div>

            {/* stats strip inside header */}
            <div className="stats-strip">
              <div className="stat-card">
                <span className="stat-card-label">Equip.</span>
                <span className="stat-card-value">{stats.total}</span>
              </div>
              <div className="stat-card green">
                <span className="stat-card-label">Salvos</span>
                <span className="stat-card-value">{stats.lancados}</span>
              </div>
              <div className="stat-card amber">
                <span className="stat-card-label">Pendentes</span>
                <span className="stat-card-value">{stats.pendentes}</span>
              </div>
            </div>

            <div className="controls">
              <div className="field">
                <label htmlFor="busca">Buscar</label>
                <input
                  id="busca"
                  className="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="CB-02, obra..."
                />
              </div>

              <div className="field">
                <label htmlFor="data">Data</label>
                <input
                  id="data"
                  className="date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>

              <div className="field">
                <label>&nbsp;</label>
                <button
                  className="save-btn"
                  type="button"
                  onClick={() => void handleSaveAll()}
                  disabled={savingAll || loading || !env.ok}
                >
                  {savingAll ? "Salvando…" : "Salvar tudo"}
                </button>
              </div>
            </div>
          </section>

          {/* ── TOOLBAR (light zone) ── */}
          <div className="toolbar" style={{ padding: "0 4px" }}>
            <span className="toolbar-label">{filteredRows.length} exibidos</span>
            <button
              type="button"
              className={`keep-all-btn ${allKeepApplied ? "active" : ""}`}
              onClick={toggleKeepPreviousForAll}
            >
              {allKeepApplied ? "✕ Desmarcar Últ." : "Aplicar Últ. p/ todos"}
            </button>
          </div>

          {errorMsg ? <div className="message error">⚠ {errorMsg}</div> : null}
          {okMsg ? <div className="message ok">✓ {okMsg}</div> : null}

          {loading ? (
            <div className="empty">Carregando equipamentos…</div>
          ) : filteredRows.length === 0 ? (
            <div className="empty">Nenhum equipamento encontrado.</div>
          ) : (
            <section className="list">
              {filteredRows.map((row) => {
                const previous = getPreviousValue(row);
                const current = getCurrentValue(row);
                const dayValue = getDayValue(row);
                const alertText = getAlertText(row);
                const rowCanSave = canSaveRow(row);
                const obraNome =
                  obras.find((o) => String(o.id) === row.obraId)?.obra || row.novaObra || "";
                const isSaved = row.registroId != null;

                return (
                  <article className={`card ${isSaved ? "saved" : ""}`} key={row.equipamentoId}>
                    {/* ── collapsed header ── */}
                    <div
                      className="card-header"
                      onClick={() =>
                        setExpandedId(expandedId === row.equipamentoId ? null : row.equipamentoId)
                      }
                    >
                      <h2 className="equip-code">{row.codigo}</h2>

                      <div className="equip-sub">
                        {obraNome || (row.selectedMode === "horimetro" ? "Horímetro" : "Odômetro")}
                      </div>

                      {isSaved ? (
                        <span className="card-preview">
                          {format1(current ? parsePtNumber(current) : null) !== "—"
                            ? format1(parsePtNumber(current))
                            : format1(dayValue)}
                        </span>
                      ) : (
                        <span className="card-preview pending">pendente</span>
                      )}

                      <StatusDot saved={isSaved} />

                      <span className={`chevron ${expandedId === row.equipamentoId ? "open" : ""}`}>
                        ▼
                      </span>
                    </div>

                    {/* ── expanded body ── */}
                    {expandedId === row.equipamentoId && (
                      <div className="card-body">

                        <div className="mode-row">
                          <div className="segmented">
                            <button
                              type="button"
                              className={row.selectedMode === "horimetro" ? "active" : ""}
                              onClick={() =>
                                updateRow(row.equipamentoId, { selectedMode: "horimetro" })
                              }
                            >
                              HOR
                            </button>
                            <button
                              type="button"
                              className={row.selectedMode === "odometro" ? "active" : ""}
                              onClick={() =>
                                updateRow(row.equipamentoId, { selectedMode: "odometro" })
                              }
                            >
                              ODO
                            </button>
                          </div>
                        </div>

                        <div className="block">
                          <div className="block-label">Obra</div>
                          <div className="obra-row">
                            <select
                              className="select"
                              value={row.showNovaObra ? "__new__" : row.obraId}
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === "__new__") {
                                  updateRow(row.equipamentoId, { showNovaObra: true, obraId: "" });
                                  return;
                                }
                                updateRow(row.equipamentoId, { obraId: value, novaObra: "", showNovaObra: false });
                              }}
                            >
                              <option value="">Selecione</option>
                              {obras.map((obra) => (
                                <option key={obra.id} value={obra.id}>{obra.obra}</option>
                              ))}
                              <option value="__new__">+ Nova obra...</option>
                            </select>

                            <button
                              type="button"
                              className="sheet-btn"
                              onClick={() =>
                                updateRow(row.equipamentoId, {
                                  showNovaObra: !row.showNovaObra,
                                  obraId: row.showNovaObra ? row.obraId : "",
                                })
                              }
                            >
                              Nova
                            </button>
                          </div>

                          {row.showNovaObra ? (
                            <div className="sheet">
                              <input
                                className="new-obra-input"
                                value={row.novaObra}
                                onChange={(e) =>
                                  updateRow(row.equipamentoId, { novaObra: e.target.value })
                                }
                                placeholder="Digite a nova obra"
                              />
                              <div className="sheet-actions">
                                <button
                                  type="button"
                                  className="sheet-btn"
                                  onClick={() =>
                                    updateRow(row.equipamentoId, { showNovaObra: false, novaObra: "" })
                                  }
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  className="sheet-btn"
                                  onClick={() =>
                                    updateRow(row.equipamentoId, { showNovaObra: false })
                                  }
                                >
                                  OK
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        <div className="values">
                          <div className="value-box">
                            <div className="value-box-title">Anterior</div>
                            <div className={`value-box-main ${previous == null ? "muted" : ""}`}>
                              {format1(previous)}
                            </div>
                          </div>

                          <div className="value-box">
                            <div className="value-box-title">Do dia</div>
                            {alertText ? (
                              <span className="alert-chip">{alertText}</span>
                            ) : (
                              <div className={`value-box-main ${dayValue == null ? "muted" : "success"}`}>
                                {format1(dayValue)}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="block">
                          <div className="block-label">Leitura atual</div>
                          <div className="input-save-row">
                            <input
                              type="text"
                              className="number-input"
                              value={current}
                              onChange={(e) => updateActiveInput(row.equipamentoId, e.target.value)}
                              onBlur={(e) => finalizeActiveInput(row.equipamentoId, e.target.value)}
                              inputMode="numeric"
                              placeholder="Digite"
                            />
                            <button
                              type="button"
                              className={`keep-btn ${row.keepPreviousApplied ? "active" : ""}`}
                              onClick={() => toggleKeepPreviousForRow(row)}
                            >
                              Últ.
                            </button>
                            <button
                              type="button"
                              className="row-save"
                              title={`Salvar ${row.codigo}`}
                              onClick={() => void saveOneRow(row)}
                              disabled={
                                !rowCanSave ||
                                savingRowId === row.equipamentoId ||
                                savingAll ||
                                !env.ok
                              }
                            >
                              <SaveIcon />
                            </button>
                          </div>
                        </div>

                      </div>
                    )}
                  </article>
                );
              })}
            </section>
          )}
        </div>
      </main>
    </>
  );
}
