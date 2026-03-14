
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
        :root {
          --bg: #f0f2f7;
          --surface: #ffffff;
          --surface-soft: #f7f9fc;
          --line: #e9edf5;
          --line-strong: #d6deea;
          --text: #0f172a;
          --muted: #667085;
          --brand: #4f6ef7;
          --brand-soft: #eef2ff;
          --success: #16a34a;
          --danger: #ef4444;
          --warning: #f4b400;
          --shadow: 0 1px 4px rgba(15,23,42,0.06);
        }

        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Arial, sans-serif; }
        input, select, button { font: inherit; }

        .page { min-height: 100vh; padding: 8px; }

        .shell {
          width: min(100%, 780px);
          margin: 0 auto;
          display: grid;
          gap: 7px;
        }

        /* ── HEADER ── */
        .header {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 16px;
          box-shadow: var(--shadow);
          padding: 10px 12px;
          display: grid;
          gap: 8px;
        }

        .header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .brand { display: flex; align-items: center; gap: 8px; min-width: 0; }

        .logo {
          width: 28px; height: 28px;
          border-radius: 7px;
          background: #fff8e8;
          overflow: hidden;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
        }
        .logo img { width: 100%; height: 100%; object-fit: cover; }

        .eyebrow { margin: 0; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
        .title { margin: 0; font-size: 14px; font-weight: 900; letter-spacing: -.02em; }
        .subtitle { display: none; }

        .period { font-size: 10px; color: #475569; font-weight: 700; text-align: right; line-height: 1.4; white-space: nowrap; }

        /* ── CONTROLS ── */
        .controls {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: 6px;
          align-items: end;
        }

        .field { display: grid; gap: 2px; }
        .field label { font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }

        .search, .date, .select, .number-input, .new-obra-input,
        .keep-btn, .keep-all-btn, .save-btn, .sheet-btn {
          width: 100%;
          height: 34px;
          border: 1px solid transparent;
          border-radius: 10px;
          background: var(--surface-soft);
          color: var(--text);
          outline: none;
          padding: 0 10px;
          font-size: 13px;
          font-weight: 700;
          transition: .15s ease;
        }

        .search:focus, .date:focus, .select:focus, .number-input:focus, .new-obra-input:focus {
          background: #fff;
          border-color: var(--line-strong);
          box-shadow: 0 0 0 3px rgba(79,110,247,.08);
        }

        .save-btn {
          border: 0;
          background: var(--warning);
          color: #1f2937;
          font-weight: 900;
          cursor: pointer;
          white-space: nowrap;
        }
        .save-btn[disabled] { opacity: .7; cursor: wait; }

        /* ── TOOLBAR ── */
        .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
        .stats { display: flex; gap: 4px; }

        .stat {
          padding: 3px 8px;
          border-radius: 999px;
          background: var(--surface-soft);
          color: #475569;
          font-size: 10px;
          font-weight: 800;
        }

        .keep-all-btn, .keep-btn, .sheet-btn {
          border: 1px solid var(--line);
          background: var(--surface-soft);
          color: #475569;
          cursor: pointer;
        }
        .keep-all-btn { width: auto; min-width: 96px; padding: 0 10px; font-size: 11px; height: 28px; border-radius: 8px; }
        .keep-btn { width: auto; min-width: 40px; height: 32px; padding: 0 8px; font-size: 11px; border-radius: 8px; }
        .sheet-btn { width: auto; padding: 0 10px; font-size: 11px; height: 32px; }

        .keep-all-btn:hover, .keep-btn:hover, .sheet-btn:hover { background: var(--brand-soft); color: var(--brand); border-color: #ccd5ff; }
        .keep-all-btn.active, .keep-btn.active { background: var(--brand); border-color: var(--brand); color: #fff; }

        /* ── MESSAGES ── */
        .message { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 7px 12px; font-size: 12px; font-weight: 700; }
        .message.error { color: #a12d2d; }
        .message.ok { color: #0b7b52; }

        /* ── LIST ── */
        .list { display: grid; gap: 5px; }

        /* ── ACCORDION CARD ── */
        .card {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 13px;
          box-shadow: var(--shadow);
          overflow: hidden;
        }

        /* collapsed header row */
        .card-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          cursor: pointer;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .card-header:active { background: var(--surface-soft); }

        .equip-code {
          margin: 0;
          font-size: 15px;
          font-weight: 900;
          letter-spacing: -.03em;
          min-width: 48px;
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
        }
        .card-preview.pending { color: #94a3b8; }

        .status-dot {
          width: 8px; height: 8px;
          border-radius: 999px;
          display: inline-block;
          flex-shrink: 0;
        }
        .status-dot.saved { background: var(--success); }
        .status-dot.pending { background: var(--danger); }

        .chevron {
          font-size: 11px;
          color: #94a3b8;
          transition: transform .2s;
          flex-shrink: 0;
        }
        .chevron.open { transform: rotate(180deg); }

        /* expanded body */
        .card-body {
          border-top: 1px solid var(--line);
          background: var(--surface-soft);
          padding: 10px 12px;
          display: grid;
          gap: 8px;
        }

        /* mode toggle */
        .mode-row { display: flex; align-items: center; gap: 6px; }

        .segmented {
          display: inline-flex;
          align-items: center;
          gap: 1px;
          padding: 2px;
          border-radius: 999px;
          background: var(--surface);
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
          font-size: 10px;
          font-weight: 800;
          cursor: pointer;
        }
        .segmented button.active { background: var(--brand-soft); color: var(--brand); }

        /* values row */
        .values {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 5px;
        }

        .value-box {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 9px;
          padding: 5px 8px;
          min-height: 42px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 2px;
        }
        .value-box-title { font-size: 9px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
        .value-box-main { font-size: 15px; font-weight: 900; letter-spacing: -.03em; color: var(--text); }
        .value-box-main.muted { color: #94a3b8; }
        .value-box-main.success { color: var(--success); }

        .alert-chip {
          display: inline-flex;
          align-items: center;
          min-height: 18px;
          padding: 0 6px;
          border-radius: 999px;
          background: #fff1f2;
          color: #b42318;
          font-size: 10px;
          font-weight: 900;
          white-space: nowrap;
        }

        /* obra block */
        .block { display: grid; gap: 3px; }
        .block-label { font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }

        .obra-row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 5px;
          align-items: center;
        }

        .sheet {
          margin-top: 4px;
          display: grid;
          gap: 5px;
          padding: 8px;
          border-radius: 9px;
          background: var(--surface);
          border: 1px solid var(--line);
        }
        .sheet-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }

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
          background: #ffffff !important;
        }

        .number-input::placeholder { color: #aab0bd; }

        .row-save {
          width: 34px; height: 32px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: var(--surface);
          color: #4b5563;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
        }
        .row-save:hover { background: var(--brand-soft); color: var(--brand); }
        .row-save[disabled] { opacity: .4; cursor: not-allowed; }

        .empty { background: var(--surface); border: 1px solid var(--line); border-radius: 13px; padding: 16px; color: var(--muted); font-size: 13px; font-weight: 700; }

        /* unused but kept for save-all flow */
        .save-row, .card-top, .card-title, .status-wrap, .footer-row, .mode-row-old { display: none; }

        @media (min-width: 760px) {
          .shell { width: min(100%, 980px); }
          .list { grid-template-columns: 1fr 1fr; }
          .subtitle { display: block; margin: 1px 0 0; font-size: 11px; color: var(--muted); font-weight: 500; }
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
                    Layout mobile, sem rolagem lateral, com um card por equipamento.
                  </p>
                </div>
              </div>

              <div className="period">
                Anterior: {isoToBr(periodoAnterior)}
                <br />
                Atual: {isoToBr(selectedDate)}
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

            <div className="toolbar">
              <div className="stats">
                <div className="stat">Equip: {stats.total}</div>
                <div className="stat">Salvos: {stats.lancados}</div>
                <div className="stat">Pendentes: {stats.pendentes}</div>
              </div>

              <button
                type="button"
                className={`keep-all-btn ${allKeepApplied ? "active" : ""}`}
                onClick={toggleKeepPreviousForAll}
              >
                {allKeepApplied ? "Desmarcar Últ." : "Aplicar Últ."}
              </button>
            </div>
          </section>

          {errorMsg ? <div className="message error">{errorMsg}</div> : null}
          {okMsg ? <div className="message ok">{okMsg}</div> : null}

          {loading ? (
            <div className="empty">Carregando...</div>
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

                return (
                  <article className="card" key={row.equipamentoId}>
                    {/* ── collapsed header — always visible ── */}
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

                      {row.registroId != null ? (
                        <span className="card-preview">
                          {format1(current ? parsePtNumber(current) : null) !== "—"
                            ? format1(parsePtNumber(current))
                            : format1(dayValue)}
                        </span>
                      ) : (
                        <span className="card-preview pending">pendente</span>
                      )}

                      <StatusDot saved={row.registroId != null} />

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
                          <div className="block-label">Atual</div>
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
