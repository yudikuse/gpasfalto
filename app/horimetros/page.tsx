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

function getEffectiveObraId(row: RowState, lastSavedObraId: string) {
  return row.obraId || lastSavedObraId || "";
}

function canSaveRow(row: RowState, lastSavedObraId: string) {
  const previous = getPreviousValue(row);
  const current = getCurrentNumericValue(row);
  const obraId = getEffectiveObraId(row, lastSavedObraId);

  if (!obraId && !row.novaObra.trim()) return false;
  if (current == null) return false;
  if (previous == null) return true;
  if (current < previous && !row.isTrocaMedidor) return false;
  return true;
}

function validateRow(row: RowState, lastSavedObraId: string) {
  const previous = getPreviousValue(row);
  const current = getCurrentNumericValue(row);
  const obraId = getEffectiveObraId(row, lastSavedObraId);

  if (!obraId && !row.novaObra.trim()) {
    return `${row.codigo}: selecione a obra ou cadastre uma nova obra.`;
  }

  if (current == null) {
    return `${row.codigo}: informe o valor atual.`;
  }

  if (current < (previous ?? current) && !row.isTrocaMedidor) {
    return `${row.codigo}: valor atual não pode ser menor que o anterior sem marcar trocar (${row.selectedMode === "horimetro" ? "hor" : "odo"}).`;
  }

  return null;
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
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
  return (
    <span
      className={`status-dot ${saved ? "saved" : "pending"}`}
      title={saved ? "Salvo" : "Pendente"}
    />
  );
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
  const [lastSavedObraId, setLastSavedObraId] = useState("");

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
    if (!q) return rows;

    return rows.filter((row) => {
      const obraId = getEffectiveObraId(row, lastSavedObraId);
      const obra = obras.find((o) => String(o.id) === obraId)?.obra || row.novaObra || "";
      return (
        row.codigo.toLowerCase().includes(q) ||
        obra.toLowerCase().includes(q) ||
        row.selectedMode.toLowerCase().includes(q)
      );
    });
  }, [rows, search, obras, lastSavedObraId]);

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

      const lastWithObra = ((atuaisRes.data || []) as LeituraRow[]).find((r) => r.obra_id != null);
      if (lastWithObra?.obra_id != null) {
        setLastSavedObraId(String(lastWithObra.obra_id));
      }
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
      const effectiveObraId = getEffectiveObraId(row, lastSavedObraId);
      if (effectiveObraId) return effectiveObraId;

      const nova = row.novaObra.trim();
      if (!nova) return "";

      const existing = obras.find((o) => normalizeText(o.obra) === normalizeText(nova));
      if (existing) return String(existing.id);

      if (!supabase) return "";

      const insertRes = await supabase
        .from("obras")
        .insert({ obra: nova, ativo: true })
        .select("id,obra")
        .single();

      if (insertRes.error) throw insertRes.error;

      const created = insertRes.data as ObraRow;
      setObras((current) =>
        [...current, created].sort((a, b) => a.obra.localeCompare(b.obra, "pt-BR"))
      );

      return String(created.id);
    },
    [lastSavedObraId, obras, supabase]
  );

  const saveOneRow = useCallback(
    async (row: RowState) => {
      if (!supabase) return;

      const validationError = validateRow(row, lastSavedObraId);
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

        setLastSavedObraId(obraIdToSave);
        setOkMsg(`${row.codigo} salvo com sucesso.`);
        await loadData();
      } catch (e: any) {
        setErrorMsg(e?.message || `Erro ao salvar ${row.codigo}.`);
      } finally {
        setSavingRowId(null);
      }
    },
    [ensureObraForSave, lastSavedObraId, loadData, selectedDate, supabase]
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
          Boolean(row.observacao.trim()) ||
          Boolean(row.novaObra.trim()) ||
          Boolean(getEffectiveObraId(row, lastSavedObraId));

        if (!hasAnyWork) continue;

        const validationError = validateRow(row, lastSavedObraId);
        if (validationError) throw new Error(validationError);
      }

      const authRes = await supabase.auth.getUser();
      const user = authRes.data.user;
      const updatedByName = user?.email || user?.user_metadata?.name || "Usuário";
      const updatedById = user?.id || null;

      let nextDefaultObraId = lastSavedObraId;

      for (const row of rows) {
        const horimetroFinal = parsePtNumber(row.horimetroAtual);
        const odometroFinal = parsePtNumber(row.odometroAtual);

        const hasAnyWork =
          horimetroFinal != null ||
          odometroFinal != null ||
          Boolean(row.observacao.trim()) ||
          Boolean(row.novaObra.trim()) ||
          Boolean(getEffectiveObraId(row, nextDefaultObraId));

        if (!hasAnyWork) continue;

        const obraIdToSave = await ensureObraForSave({
          ...row,
          obraId: row.obraId || nextDefaultObraId,
        });

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

        nextDefaultObraId = obraIdToSave;
      }

      setLastSavedObraId(nextDefaultObraId);
      setOkMsg("Tudo salvo com sucesso.");
      await loadData();
    } catch (e: any) {
      setErrorMsg(e?.message || "Erro ao salvar lançamentos.");
    } finally {
      setSavingAll(false);
    }
  }, [ensureObraForSave, lastSavedObraId, loadData, rows, selectedDate, supabase]);

  return (
    <>
      <style jsx global>{`
        :root {
          --bg: #f6f7fb;
          --surface: #ffffff;
          --surface-soft: #f8fafc;
          --line: #e9edf5;
          --line-strong: #d9e1ec;
          --text: #111827;
          --muted: #6b7280;
          --brand: #5b6df6;
          --brand-soft: #eef2ff;
          --success: #16a34a;
          --danger: #ef4444;
          --warning: #f4b400;
          --shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
        }

        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          background: var(--bg);
          color: var(--text);
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Arial, sans-serif;
        }

        input, select, button { font: inherit; }

        .page {
          min-height: 100vh;
          padding: 12px;
        }

        .shell {
          width: min(1600px, 100%);
          margin: 0 auto;
          display: grid;
          gap: 12px;
        }

        .header {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 18px;
          box-shadow: var(--shadow);
          padding: 14px;
          display: grid;
          gap: 12px;
        }

        .header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }

        .logo {
          width: 34px;
          height: 34px;
          border-radius: 9px;
          background: #fff8e8;
          overflow: hidden;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
        }

        .logo img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .eyebrow {
          margin: 0 0 2px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .title {
          margin: 0;
          font-size: 19px;
          line-height: 1;
          font-weight: 800;
          letter-spacing: -0.02em;
        }

        .subtitle {
          margin: 4px 0 0;
          font-size: 12px;
          color: var(--muted);
          font-weight: 500;
        }

        .period {
          font-size: 12px;
          color: #475569;
          font-weight: 600;
          white-space: nowrap;
        }

        .controls {
          display: grid;
          grid-template-columns: minmax(240px, 1fr) 170px 150px;
          gap: 10px;
          align-items: end;
        }

        .field {
          display: grid;
          gap: 5px;
        }

        .field label {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .search,
        .date,
        .select,
        .number-input,
        .text-input,
        .keep-btn,
        .keep-all-btn,
        .new-obra-input,
        .obra-popover-btn {
          width: 100%;
          height: 34px;
          border: 1px solid transparent;
          border-radius: 9px;
          background: var(--surface-soft);
          color: var(--text);
          outline: none;
          padding: 0 10px;
          font-size: 13px;
          font-weight: 600;
          transition: 0.15s ease;
        }

        .search:focus,
        .date:focus,
        .select:focus,
        .number-input:focus,
        .text-input:focus,
        .new-obra-input:focus {
          background: #fff;
          border-color: var(--line-strong);
          box-shadow: 0 0 0 3px rgba(91, 109, 246, 0.08);
        }

        .number-input {
          min-width: 96px;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .keep-btn,
        .keep-all-btn,
        .obra-popover-btn {
          width: auto;
          cursor: pointer;
          color: #475569;
          font-size: 11px;
          font-weight: 800;
          border: 1px solid var(--line);
        }

        .keep-btn {
          min-width: 42px;
          padding: 0 10px;
        }

        .keep-all-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-width: 132px;
          padding: 0 12px;
        }

        .obra-popover-btn {
          min-width: 58px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .keep-btn:hover,
        .keep-all-btn:hover,
        .obra-popover-btn:hover {
          background: var(--brand-soft);
          color: var(--brand);
          border-color: #cfd8ff;
        }

        .keep-btn.active,
        .keep-all-btn.active {
          background: var(--brand);
          color: #ffffff;
          border-color: var(--brand);
          box-shadow: 0 6px 18px rgba(91, 109, 246, 0.2);
        }

        .save-btn {
          width: 100%;
          height: 36px;
          border: 0;
          border-radius: 9px;
          background: var(--warning);
          color: #1f2937;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
        }

        .save-btn[disabled] {
          opacity: 0.7;
          cursor: wait;
        }

        .stats {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          align-items: center;
        }

        .stat {
          padding: 6px 9px;
          border-radius: 999px;
          background: var(--surface-soft);
          color: #475569;
          font-size: 11px;
          font-weight: 700;
        }

        .message {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 14px;
          box-shadow: var(--shadow);
          padding: 10px 12px;
          font-size: 13px;
          font-weight: 700;
        }

        .message.error { color: #a12d2d; }
        .message.ok { color: #0b7b52; }

        .table-card {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 18px;
          box-shadow: var(--shadow);
          overflow: hidden;
        }

        .table-head {
          padding: 12px 14px 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }

        .table-head h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }

        .table-head p {
          margin: 4px 0 0;
          color: var(--muted);
          font-size: 12px;
          font-weight: 500;
        }

        .table-wrap {
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
        }

        table {
          width: 100%;
          min-width: 1220px;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: fixed;
        }

        col.eq { width: 88px; }
        col.tipo { width: 120px; }
        col.obra { width: 220px; }
        col.prev { width: 96px; }
        col.curr { width: 160px; }
        col.day { width: 120px; }
        col.troca { width: 110px; }
        col.obs { width: 160px; }
        col.status { width: 58px; }
        col.save { width: 46px; }

        thead th {
          position: sticky;
          top: 0;
          z-index: 5;
          background: var(--surface);
          padding: 8px 10px;
          text-align: center;
          font-size: 10px;
          font-weight: 800;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          border-bottom: 1px solid var(--line);
          white-space: nowrap;
          vertical-align: middle;
        }

        .th-two-lines {
          line-height: 1.05;
        }

        .th-two-lines small {
          display: block;
          margin-top: 2px;
          font-size: 9px;
          letter-spacing: 0.05em;
        }

        tbody td {
          padding: 6px 10px;
          border-bottom: 1px solid var(--line);
          vertical-align: middle;
          background: #fff;
        }

        tbody tr:hover td {
          background: #fcfdff;
        }

        tbody tr:last-child td {
          border-bottom: 0;
        }

        .sticky-col {
          position: sticky;
          left: 0;
          z-index: 4;
          background: inherit;
        }

        thead .sticky-col {
          z-index: 6;
          background: var(--surface);
        }

        .equip-code {
          font-size: 13px;
          font-weight: 800;
          line-height: 1;
        }

        .equip-sub {
          margin-top: 2px;
          font-size: 11px;
          color: var(--muted);
          font-weight: 500;
        }

        .segmented {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 2px;
          border-radius: 999px;
          background: var(--surface-soft);
          border: 1px solid var(--line);
        }

        .segmented button {
          height: 24px;
          min-width: 44px;
          border: 0;
          border-radius: 999px;
          padding: 0 8px;
          background: transparent;
          color: #64748b;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
        }

        .segmented button.active {
          background: var(--brand-soft);
          color: var(--brand);
        }

        .current-cell {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .obra-cell {
          position: relative;
        }

        .obra-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .obra-popover {
          position: absolute;
          top: 40px;
          left: 0;
          right: 0;
          z-index: 30;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 12px;
          box-shadow: 0 14px 28px rgba(15, 23, 42, 0.1);
          padding: 8px;
          display: grid;
          gap: 8px;
        }

        .obra-popover-actions {
          display: flex;
          gap: 6px;
        }

        .value {
          font-size: 13px;
          font-weight: 700;
          color: var(--text);
          white-space: nowrap;
          text-align: center;
          display: inline-block;
          width: 100%;
        }

        .value.muted { color: #9aa4b2; }
        .value.success { color: var(--success); }

        .alert-chip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 24px;
          padding: 0 8px;
          border-radius: 999px;
          background: #fff1f2;
          color: #b42318;
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
        }

        .checkbox-wrap {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .troca-check {
          width: 16px;
          height: 16px;
          accent-color: var(--brand);
          cursor: pointer;
        }

        .troca-label {
          font-size: 11px;
          color: var(--muted);
          font-weight: 700;
          white-space: nowrap;
        }

        .status-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .status-dot {
          display: inline-block;
          width: 14px;
          height: 14px;
          border-radius: 999px;
        }

        .status-dot.saved { background: #16a34a; }
        .status-dot.pending { background: #ef4444; }

        .row-save {
          width: 30px;
          height: 30px;
          border: 0;
          border-radius: 8px;
          background: var(--surface-soft);
          color: #4b5563;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .row-save:hover {
          background: var(--brand-soft);
          color: var(--brand);
        }

        .row-save[disabled] {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .center { text-align: center; }

        .empty {
          padding: 16px;
          color: var(--muted);
          font-size: 13px;
          font-weight: 700;
        }

        @media (max-width: 920px) {
          .page { padding: 10px; }
          .header { padding: 12px; }
          .controls { grid-template-columns: 1fr; }
          .title { font-size: 17px; }
          table { min-width: 1180px; }
        }
      `}</style>

      <main className="page">
        <div className="shell">
          <section className="header">
            <div className="header-top">
              <div className="brand">
                <div className="logo">
                  <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
                </div>
                <div>
                  <p className="eyebrow">GP Asfalto</p>
                  <h1 className="title">Horímetros e Odômetros</h1>
                  <p className="subtitle">
                    A obra segue o último salvamento. “Nova obra” abre campo de cadastro sem esticar a linha.
                  </p>
                </div>
              </div>

              <div className="period">
                Anterior: {isoToBr(periodoAnterior)} · Atual: {isoToBr(selectedDate)}
              </div>
            </div>

            <div className="controls">
              <div className="field">
                <label htmlFor="busca">Buscar equipamento</label>
                <input
                  id="busca"
                  className="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Ex.: CB-02, obra..."
                />
              </div>

              <div className="field">
                <label htmlFor="data">Data do lançamento</label>
                <input
                  id="data"
                  className="date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Ação</label>
                <button
                  className="save-btn"
                  type="button"
                  onClick={() => void handleSaveAll()}
                  disabled={savingAll || loading || !env.ok}
                >
                  {savingAll ? "Salvando..." : "Salvar tudo"}
                </button>
              </div>
            </div>

            <div className="stats">
              <div className="stat">Equipamentos: {stats.total}</div>
              <div className="stat">Lançados: {stats.lancados}</div>
              <div className="stat">Pendentes: {stats.pendentes}</div>

              <button
                type="button"
                className={`keep-all-btn ${allKeepApplied ? "active" : ""}`}
                onClick={toggleKeepPreviousForAll}
                title={allKeepApplied ? "Desmarcar Últ. em todos" : "Aplicar Últ. em todos"}
              >
                {allKeepApplied ? "Desmarcar Últ. todos" : "Aplicar Últ. todos"}
              </button>
            </div>
          </section>

          {errorMsg ? <div className="message error">{errorMsg}</div> : null}
          {okMsg ? <div className="message ok">{okMsg}</div> : null}

          <section className="table-card">
            <div className="table-head">
              <div>
                <h3>Lançamento diário</h3>
                <p>
                  Não existe mais default fixo de obra. A próxima linha reaproveita a obra do último salvamento.
                </p>
              </div>
            </div>

            {loading ? (
              <div className="empty">Carregando...</div>
            ) : filteredRows.length === 0 ? (
              <div className="empty">Nenhum equipamento encontrado.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <colgroup>
                    <col className="eq" />
                    <col className="tipo" />
                    <col className="obra" />
                    <col className="prev" />
                    <col className="curr" />
                    <col className="day" />
                    <col className="troca" />
                    <col className="obs" />
                    <col className="status" />
                    <col className="save" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="sticky-col">Equip.</th>
                      <th>Tipo</th>
                      <th>Obra</th>
                      <th>Anterior</th>
                      <th>Atual</th>
                      <th>Do dia</th>
                      <th className="th-two-lines">
                        Trocar
                        <small>hor/odo</small>
                      </th>
                      <th>Observação</th>
                      <th>Status</th>
                      <th>Salvar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => {
                      const previous = getPreviousValue(row);
                      const current = getCurrentValue(row);
                      const dayValue = getDayValue(row);
                      const alertText = getAlertText(row);
                      const rowCanSave = canSaveRow(row, lastSavedObraId);
                      const effectiveObraId = getEffectiveObraId(row, lastSavedObraId);

                      return (
                        <tr key={row.equipamentoId}>
                          <td className="sticky-col">
                            <div className="equip-code">{row.codigo}</div>
                            <div className="equip-sub">
                              {row.selectedMode === "horimetro" ? "Horímetro" : "Odômetro"}
                            </div>
                          </td>

                          <td className="center">
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
                          </td>

                          <td>
                            <div className="obra-cell">
                              <div className="obra-row">
                                <select
                                  className="select"
                                  value={row.showNovaObra ? "__new__" : effectiveObraId}
                                  onChange={(e) => {
                                    const value = e.target.value;
                                    if (value === "__new__") {
                                      updateRow(row.equipamentoId, {
                                        showNovaObra: true,
                                        obraId: "",
                                      });
                                      return;
                                    }

                                    updateRow(row.equipamentoId, {
                                      obraId: value,
                                      novaObra: "",
                                      showNovaObra: false,
                                    });
                                  }}
                                >
                                  <option value="">Selecione</option>
                                  {lastSavedObraId ? (
                                    <option value={lastSavedObraId}>
                                      {obras.find((o) => String(o.id) === lastSavedObraId)?.obra || "Última obra"}
                                    </option>
                                  ) : null}
                                  {obras
                                    .filter((obra) => String(obra.id) !== String(lastSavedObraId || ""))
                                    .map((obra) => (
                                      <option key={obra.id} value={obra.id}>
                                        {obra.obra}
                                      </option>
                                    ))}
                                  <option value="__new__">+ Nova obra...</option>
                                </select>
                              </div>

                              {row.showNovaObra ? (
                                <div className="obra-popover">
                                  <input
                                    className="new-obra-input"
                                    value={row.novaObra}
                                    onChange={(e) =>
                                      updateRow(row.equipamentoId, { novaObra: e.target.value })
                                    }
                                    placeholder="Digite a nova obra"
                                  />
                                  <div className="obra-popover-actions">
                                    <button
                                      type="button"
                                      className="obra-popover-btn"
                                      onClick={() =>
                                        updateRow(row.equipamentoId, {
                                          showNovaObra: false,
                                          novaObra: "",
                                          obraId: lastSavedObraId || "",
                                        })
                                      }
                                    >
                                      Cancelar
                                    </button>
                                    <button
                                      type="button"
                                      className="obra-popover-btn"
                                      onClick={() =>
                                        updateRow(row.equipamentoId, {
                                          showNovaObra: false,
                                        })
                                      }
                                    >
                                      OK
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </td>

                          <td className="center">
                            <span className={`value ${previous == null ? "muted" : ""}`}>
                              {format1(previous)}
                            </span>
                          </td>

                          <td>
                            <div className="current-cell">
                              <input
                                type="text"
                                className="number-input"
                                value={current}
                                onChange={(e) =>
                                  updateActiveInput(row.equipamentoId, e.target.value)
                                }
                                onBlur={(e) =>
                                  finalizeActiveInput(row.equipamentoId, e.target.value)
                                }
                                inputMode="numeric"
                                placeholder="Digite"
                              />
                              <button
                                type="button"
                                className={`keep-btn ${row.keepPreviousApplied ? "active" : ""}`}
                                onClick={() => toggleKeepPreviousForRow(row)}
                                title="Manter o último"
                              >
                                Últ.
                              </button>
                            </div>
                          </td>

                          <td className="center">
                            {alertText ? (
                              <span className="alert-chip">{alertText}</span>
                            ) : (
                              <span className={`value ${dayValue == null ? "muted" : "success"}`}>
                                {format1(dayValue)}
                              </span>
                            )}
                          </td>

                          <td className="center">
                            <div className="checkbox-wrap">
                              <input
                                className="troca-check"
                                type="checkbox"
                                checked={row.isTrocaMedidor}
                                onChange={(e) =>
                                  updateRow(row.equipamentoId, {
                                    isTrocaMedidor: e.target.checked,
                                  })
                                }
                                title="Marque quando houve troca de horímetro/odômetro"
                              />
                              <span className="troca-label">Trocar</span>
                            </div>
                          </td>

                          <td>
                            <input
                              className="text-input"
                              value={row.observacao}
                              onChange={(e) =>
                                updateRow(row.equipamentoId, { observacao: e.target.value })
                              }
                              placeholder="Observação"
                            />
                          </td>

                          <td>
                            <div className="status-wrap">
                              <StatusDot saved={row.registroId != null} />
                            </div>
                          </td>

                          <td className="center">
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
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
