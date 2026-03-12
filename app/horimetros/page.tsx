```1:1452:c:\Users\marce\Downloads\gpasfalto-main\gpasfalto-main\app\horimetros\page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

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
  selectedMode: MeasurementMode;
  horimetroAnterior: number | null;
  horimetroAtual: string;
  horasDia: number | null;
  odometroAnterior: number | null;
  odometroAtual: string;
  kmDia: number | null;
  observacao: string;
  isTrocaMedidor: boolean;
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

function isoToBr(iso: string) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || "—";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function previousIso(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

function resolveSupabaseEnv(): { ok: boolean; url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const key = publishable || anon;
  return { ok: Boolean(url && key), url, key };
}

function normCode(value: string) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "-");
}

function format1(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatInput1(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function parsePtNumber(value: string) {
  const s = String(value || "").trim();
  if (!s) return null;
  const normalized = s.replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
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

function safePositiveDiff(
  finalValue: number | null,
  initialValue: number | null,
  isTrocaMedidor: boolean
) {
  if (finalValue == null || initialValue == null) return null;
  if (finalValue < initialValue) return null;
  const diff = Number((finalValue - initialValue).toFixed(1));
  return Number.isFinite(diff) ? diff : null;
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

    const horasDia =
      atual?.horas_trabalhadas ??
      safePositiveDiff(horimetroAtualNum, horimetroAnterior, isTrocaMedidor);

    const kmDia =
      atual?.km_rodados ??
      safePositiveDiff(odometroAtualNum, odometroAnterior, isTrocaMedidor);

    return {
      equipamentoId: eq.id,
      codigo: eq.codigo,
      obraId: String(atual?.obra_id ?? eq.obra_padrao_id ?? ""),
      selectedMode: resolveInitialMode(eq, atual),
      horimetroAnterior,
      horimetroAtual: formatInput1(horimetroAtualNum),
      horasDia,
      odometroAnterior,
      odometroAtual: formatInput1(odometroAtualNum),
      kmDia,
      observacao: stripTrocaPrefix(observacaoRaw),
      isTrocaMedidor,
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

function formatIntThousands(intDigits: string) {
  if (!intDigits) return "";
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function countDigits(text: string) {
  return (String(text).match(/\d/g) || []).length;
}

function caretFromDigits(formatted: string, digitsWanted: number) {
  if (digitsWanted <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) {
      seen += 1;
      if (seen >= digitsWanted) return i + 1;
    }
  }
  return formatted.length;
}

function formatDecimalInputWithCaret(rawValue: string, caret: number | null) {
  const text = String(rawValue || "").replace(/\./g, ",");
  const safeCaret = caret ?? text.length;
  const beforeCaret = text.slice(0, safeCaret);

  const negative = text.trimStart().startsWith("-");
  const commaIndex = text.indexOf(",");

  const cleaned = text.replace(/[^0-9,-]/g, "");
  const cleanedParts = cleaned.replace(/-/g, "").split(",");
  const intDigitsRaw = (cleanedParts[0] || "").replace(/\D/g, "");
  const decDigits = cleanedParts.slice(1).join("").replace(/\D/g, "").slice(0, 1);

  const intDigits = intDigitsRaw.replace(/^0+(?=\d)/, "") || (intDigitsRaw ? "0" : "");
  const intFormatted = formatIntThousands(intDigits);

  const hasComma = commaIndex >= 0;
  const formattedBase = `${negative ? "-" : ""}${intFormatted || (hasComma ? "0" : "")}`;
  const formatted = hasComma ? `${formattedBase},${decDigits}` : formattedBase;

  let nextCaret = formatted.length;

  if (!hasComma) {
    const digitsWanted = countDigits(beforeCaret);
    nextCaret = caretFromDigits(formatted, digitsWanted);
  } else {
    const rawCommaBeforeCaret = beforeCaret.includes(",");
    if (!rawCommaBeforeCaret) {
      const digitsWanted = countDigits(beforeCaret);
      const formattedCommaIndex = formatted.indexOf(",");
      const leftPart = formattedCommaIndex >= 0 ? formatted.slice(0, formattedCommaIndex) : formatted;
      nextCaret = caretFromDigits(leftPart, digitsWanted);
    } else {
      const formattedCommaIndex = formatted.indexOf(",");
      const decBeforeCaret = beforeCaret.split(",")[1] || "";
      const decDigitsBeforeCaret = decBeforeCaret.replace(/\D/g, "").length;
      nextCaret = formattedCommaIndex + 1 + Math.min(decDigitsBeforeCaret, decDigits.length);
    }
  }

  return { formatted, nextCaret };
}

function finalizeDecimalInput(value: string) {
  const parsed = parsePtNumber(value);
  return parsed == null ? "" : formatInput1(parsed);
}

function validateRow(row: RowState) {
  const previous = getPreviousValue(row);
  const current = parsePtNumber(getCurrentValue(row));

  if (current == null || previous == null) return null;

  if (current < previous && !row.isTrocaMedidor) {
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

  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const periodoAnterior = useMemo(() => previousIso(selectedDate), [selectedDate]);

  const stats = useMemo(() => {
    const total = rows.length;
    const lancados = rows.filter((row) => row.registroId != null).length;
    const pendentes = Math.max(total - lancados, 0);
    return { total, lancados, pendentes };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((row) => {
      const obra = obras.find((o) => String(o.id) === row.obraId)?.obra || "";
      return (
        row.codigo.toLowerCase().includes(q) ||
        obra.toLowerCase().includes(q) ||
        row.selectedMode.toLowerCase().includes(q)
      );
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
            "id,data,obra_id,equipamento_id,horimetro_inicial,horimetro_final,horas_trabalhadas,odometro_inicial,odometro_final,km_rodados,observacao,status,updated_by_user_id,updated_by_nome,updated_at,created_at"
          )
          .eq("data", selectedDate)
          .order("equipamento_id", { ascending: true })
          .limit(1000),

        supabase
          .from("horimetro_leituras_diarias")
          .select(
            "id,data,obra_id,equipamento_id,horimetro_inicial,horimetro_final,horas_trabalhadas,odometro_inicial,odometro_final,km_rodados,observacao,status,updated_by_user_id,updated_by_nome,updated_at,created_at"
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

      setObras(obrasData);
      setRows(
        buildRows({
          equipamentos: equipamentosData,
          atuais: (atuaisRes.data || []) as LeituraRow[],
          anteriores: anterioresDedup,
        })
      );
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

        next.horasDia = safePositiveDiff(hAtual, next.horimetroAnterior, next.isTrocaMedidor);
        next.kmDia = safePositiveDiff(oAtual, next.odometroAnterior, next.isTrocaMedidor);

        return next;
      })
    );
  }, []);

  const updateActiveInput = useCallback((equipamentoId: number, rawValue: string, caret: number | null) => {
    setRows((current) =>
      current.map((row) => {
        if (row.equipamentoId !== equipamentoId) return row;

        const next = { ...row };
        const { formatted, nextCaret } = formatDecimalInputWithCaret(rawValue, caret);

        if (next.selectedMode === "horimetro") {
          next.horimetroAtual = formatted;
        } else {
          next.odometroAtual = formatted;
        }

        const hAtual = parsePtNumber(next.horimetroAtual);
        const oAtual = parsePtNumber(next.odometroAtual);

        next.horasDia = safePositiveDiff(hAtual, next.horimetroAnterior, next.isTrocaMedidor);
        next.kmDia = safePositiveDiff(oAtual, next.odometroAnterior, next.isTrocaMedidor);

        requestAnimationFrame(() => {
          const input = inputRefs.current[equipamentoId];
          if (!input) return;
          try {
            input.setSelectionRange(nextCaret, nextCaret);
          } catch {}
        });

        return next;
      })
    );
  }, []);

  const finalizeActiveInput = useCallback((equipamentoId: number, rawValue: string) => {
    setRows((current) =>
      current.map((row) => {
        if (row.equipamentoId !== equipamentoId) return row;

        const next = { ...row };
        const value = finalizeDecimalInput(rawValue);

        if (next.selectedMode === "horimetro") {
          next.horimetroAtual = value;
        } else {
          next.odometroAtual = value;
        }

        const hAtual = parsePtNumber(next.horimetroAtual);
        const oAtual = parsePtNumber(next.odometroAtual);

        next.horasDia = safePositiveDiff(hAtual, next.horimetroAnterior, next.isTrocaMedidor);
        next.kmDia = safePositiveDiff(oAtual, next.odometroAnterior, next.isTrocaMedidor);

        return next;
      })
    );
  }, []);

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
        const authRes = await supabase.auth.getUser();
        const user = authRes.data.user;
        const updatedByName = user?.email || user?.user_metadata?.name || "Usuário";
        const updatedById = user?.id || null;

        const horimetroFinal = parsePtNumber(row.horimetroAtual);
        const odometroFinal = parsePtNumber(row.odometroAtual);

        const horasDia = safePositiveDiff(horimetroFinal, row.horimetroAnterior, row.isTrocaMedidor);
        const kmDia = safePositiveDiff(odometroFinal, row.odometroAnterior, row.isTrocaMedidor);

        const hasSomethingToSave =
          row.registroId != null ||
          Boolean(String(row.observacao || "").trim()) ||
          Boolean(String(row.obraId || "").trim()) ||
          Boolean(row.isTrocaMedidor) ||
          horimetroFinal != null ||
          odometroFinal != null;

        if (!hasSomethingToSave) {
          setSavingRowId(null);
          return;
        }

        const payload = {
          data: selectedDate,
          obra_id: row.obraId ? Number(row.obraId) : null,
          equipamento_id: row.equipamentoId,
          horimetro_inicial:
            horimetroFinal != null || row.horimetroAnterior != null ? row.horimetroAnterior : null,
          horimetro_final: horimetroFinal,
          horas_trabalhadas: horasDia,
          odometro_inicial:
            odometroFinal != null || row.odometroAnterior != null ? row.odometroAnterior : null,
          odometro_final: odometroFinal,
          km_rodados: kmDia,
          observacao: composeObservacao(row.observacao, row.isTrocaMedidor),
          status:
            horimetroFinal != null || odometroFinal != null ? "LANCADO" : "PENDENTE",
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

        setOkMsg(`${row.codigo} salvo com sucesso.`);
        await loadData();
      } catch (e: any) {
        setErrorMsg(e?.message || `Erro ao salvar ${row.codigo}.`);
      } finally {
        setSavingRowId(null);
      }
    },
    [loadData, selectedDate, supabase]
  );

  const handleSaveAll = useCallback(async () => {
    if (!supabase) return;

    setSavingAll(true);
    setErrorMsg("");
    setOkMsg("");

    try {
      for (const row of rows) {
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

        const horasDia = safePositiveDiff(horimetroFinal, row.horimetroAnterior, row.isTrocaMedidor);
        const kmDia = safePositiveDiff(odometroFinal, row.odometroAnterior, row.isTrocaMedidor);

        const hasSomethingToSave =
          row.registroId != null ||
          Boolean(String(row.observacao || "").trim()) ||
          Boolean(String(row.obraId || "").trim()) ||
          Boolean(row.isTrocaMedidor) ||
          horimetroFinal != null ||
          odometroFinal != null;

        if (!hasSomethingToSave) continue;

        const payload = {
          data: selectedDate,
          obra_id: row.obraId ? Number(row.obraId) : null,
          equipamento_id: row.equipamentoId,
          horimetro_inicial:
            horimetroFinal != null || row.horimetroAnterior != null ? row.horimetroAnterior : null,
          horimetro_final: horimetroFinal,
          horas_trabalhadas: horasDia,
          odometro_inicial:
            odometroFinal != null || row.odometroAnterior != null ? row.odometroAnterior : null,
          odometro_final: odometroFinal,
          km_rodados: kmDia,
          observacao: composeObservacao(row.observacao, row.isTrocaMedidor),
          status:
            horimetroFinal != null || odometroFinal != null ? "LANCADO" : "PENDENTE",
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
  }, [loadData, rows, selectedDate, supabase]);

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

        input, select, button {
          font: inherit;
        }

        .page {
          min-height: 100vh;
          padding: 14px;
        }

        .shell {
          width: min(1560px, 100%);
          margin: 0 auto;
          display: grid;
          gap: 14px;
        }

        .header {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 20px;
          box-shadow: var(--shadow);
          padding: 16px;
          display: grid;
          gap: 14px;
        }

        .header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .logo {
          width: 38px;
          height: 38px;
          border-radius: 10px;
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
          margin: 0 0 3px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .title {
          margin: 0;
          font-size: 20px;
          line-height: 1;
          font-weight: 800;
          letter-spacing: -0.02em;
        }

        .subtitle {
          margin: 5px 0 0;
          font-size: 13px;
          color: var(--muted);
          font-weight: 500;
        }

        .period {
          font-size: 13px;
          color: #475569;
          font-weight: 600;
          white-space: nowrap;
        }

        .controls {
          display: grid;
          grid-template-columns: minmax(240px, 1fr) 180px 160px;
          gap: 12px;
          align-items: end;
        }

        .field {
          display: grid;
          gap: 6px;
        }

        .field label {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }

        .search,
        .date,
        .select,
        .number-input,
        .text-input {
          width: 100%;
          height: 40px;
          border: 1px solid transparent;
          border-radius: 10px;
          background: var(--surface-soft);
          color: var(--text);
          outline: none;
          padding: 0 12px;
          font-size: 14px;
          font-weight: 600;
          transition: 0.15s ease;
        }

        .search:focus,
        .date:focus,
        .select:focus,
        .number-input:focus,
        .text-input:focus {
          background: #fff;
          border-color: var(--line-strong);
          box-shadow: 0 0 0 4px rgba(91, 109, 246, 0.08);
        }

        .number-input {
          min-width: 116px;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .save-btn {
          width: 100%;
          height: 40px;
          border: 0;
          border-radius: 10px;
          background: var(--warning);
          color: #1f2937;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
        }

        .save-btn[disabled] {
          opacity: 0.7;
          cursor: wait;
        }

        .stats {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .stat {
          padding: 7px 10px;
          border-radius: 999px;
          background: var(--surface-soft);
          color: #475569;
          font-size: 12px;
          font-weight: 700;
        }

        .message {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 16px;
          box-shadow: var(--shadow);
          padding: 12px 14px;
          font-size: 14px;
          font-weight: 700;
        }

        .message.error { color: #a12d2d; }
        .message.ok { color: #0b7b52; }
        .message.warn { color: #8a6200; }

        .table-card {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 20px;
          box-shadow: var(--shadow);
          overflow: hidden;
        }

        .table-head {
          padding: 14px 16px 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }

        .table-head h3 {
          margin: 0;
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }

        .table-head p {
          margin: 5px 0 0;
          color: var(--muted);
          font-size: 13px;
          font-weight: 500;
        }

        .table-wrap {
          overflow-x: auto;
          overflow-y: hidden;
          -webkit-overflow-scrolling: touch;
        }

        table {
          width: 100%;
          min-width: 1340px;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: fixed;
        }

        col.eq { width: 90px; }
        col.tipo { width: 220px; }
        col.obra { width: 220px; }
        col.prev { width: 120px; }
        col.curr { width: 130px; }
        col.day { width: 110px; }
        col.troca { width: 86px; }
        col.obs { width: 220px; }
        col.status { width: 150px; }
        col.save { width: 62px; }

        thead th {
          position: sticky;
          top: 0;
          z-index: 5;
          background: var(--surface);
          padding: 12px;
          text-align: left;
          font-size: 11px;
          font-weight: 800;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          border-bottom: 1px solid var(--line);
          white-space: nowrap;
          vertical-align: middle;
        }

        tbody td {
          padding: 12px;
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
          font-size: 15px;
          font-weight: 800;
          line-height: 1;
        }

        .equip-sub {
          margin-top: 4px;
          font-size: 11px;
          color: var(--muted);
          font-weight: 600;
        }

        .segmented {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          padding: 3px;
          border-radius: 999px;
          background: var(--surface-soft);
          border: 1px solid var(--line);
        }

        .segmented button {
          height: 28px;
          border: 0;
          border-radius: 999px;
          padding: 0 10px;
          background: transparent;
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
        }

        .segmented button.active {
          background: var(--brand-soft);
          color: var(--brand);
        }

        .value {
          font-size: 14px;
          font-weight: 700;
          color: var(--text);
          white-space: nowrap;
        }

        .value.muted { color: #9aa4b2; }
        .value.success { color: var(--success); }
        .value.danger { color: var(--danger); }

        .checkbox-wrap {
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .troca-check {
          width: 18px;
          height: 18px;
          accent-color: var(--brand);
          cursor: pointer;
        }

        .status {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 999px;
          background: var(--surface-soft);
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
        }

        .status.saved {
          background: #ecfdf3;
          color: #118244;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #b6bfcd;
          flex: 0 0 auto;
        }

        .status.saved .status-dot {
          background: #16a34a;
        }

        .meta {
          margin-top: 6px;
          display: grid;
          gap: 2px;
          font-size: 11px;
          color: var(--muted);
          font-weight: 600;
        }

        .row-save {
          width: 34px;
          height: 34px;
          border: 0;
          border-radius: 10px;
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
          opacity: 0.55;
          cursor: wait;
        }

        .empty {
          padding: 20px;
          color: var(--muted);
          font-size: 14px;
          font-weight: 700;
        }

        @media (max-width: 920px) {
          .page { padding: 10px; }
          .header { padding: 14px; }
          .controls { grid-template-columns: 1fr; }
          .title { font-size: 18px; }
          table { min-width: 1280px; }
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
                    Uma linha por equipamento. Tabela simples, clean e com rolagem lateral no celular.
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
            </div>
          </section>

          {!env.ok ? (
            <div className="message warn">
              Defina no Vercel: NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ou NEXT_PUBLIC_SUPABASE_ANON_KEY.
            </div>
          ) : null}

          {errorMsg ? <div className="message error">{errorMsg}</div> : null}
          {okMsg ? <div className="message ok">{okMsg}</div> : null}

          <section className="table-card">
            <div className="table-head">
              <div>
                <h3>Lançamento diário</h3>
                <p>
                  Toggle define a leitura usada na linha. Valor atual menor que o anterior só salva quando marcar troca. Nunca mostra valor negativo no dia.
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
                      <th>Troca</th>
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

                      return (
                        <tr key={row.equipamentoId}>
                          <td className="sticky-col">
                            <div className="equip-code">{row.codigo}</div>
                            <div className="equip-sub">
                              {row.selectedMode === "horimetro" ? "Horímetro" : "Odômetro"}
                            </div>
                          </td>

                          <td>
                            <div className="segmented">
                              <button
                                type="button"
                                className={row.selectedMode === "horimetro" ? "active" : ""}
                                onClick={() => updateRow(row.equipamentoId, { selectedMode: "horimetro" })}
                              >
                                Horímetro
                              </button>
                              <button
                                type="button"
                                className={row.selectedMode === "odometro" ? "active" : ""}
                                onClick={() => updateRow(row.equipamentoId, { selectedMode: "odometro" })}
                              >
                                Odômetro
                              </button>
                            </div>
                          </td>

                          <td>
                            <select
                              className="select"
                              value={row.obraId}
                              onChange={(e) => updateRow(row.equipamentoId, { obraId: e.target.value })}
                            >
                              <option value="">Selecione</option>
                              {obras.map((obra) => (
                                <option key={obra.id} value={obra.id}>
                                  {obra.obra}
                                </option>
                              ))}
                            </select>
                          </td>

                          <td>
                            <span className={`value ${previous == null ? "muted" : ""}`}>
                              {format1(previous)}
                            </span>
                          </td>

                          <td>
                            <input
                              ref={(el) => {
                                inputRefs.current[row.equipamentoId] = el;
                              }}
                              type="text"
                              className="number-input"
                              value={current}
                              onChange={(e) =>
                                updateActiveInput(
                                  row.equipamentoId,
                                  e.target.value,
                                  e.target.selectionStart
                                )
                              }
                              onBlur={(e) => finalizeActiveInput(row.equipamentoId, e.target.value)}
                              inputMode="decimal"
                              placeholder="Digite"
                            />
                          </td>

                          <td>
                            <span className={`value ${dayValue == null ? "muted" : "success"}`}>
                              {format1(dayValue)}
                            </span>
                          </td>

                          <td>
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
                            <div className={`status ${row.registroId ? "saved" : ""}`}>
                              <span className="status-dot" />
                              {row.registroId ? "Salvo" : "Pendente"}
                            </div>
                            <div className="meta">
                              <div>
                                {row.updatedAt
                                  ? new Date(row.updatedAt).toLocaleString("pt-BR")
                                  : "Ainda não salvo"}
                              </div>
                              <div>{row.updatedByNome || "—"}</div>
                            </div>
                          </td>

                          <td>
                            <button
                              type="button"
                              className="row-save"
                              title={`Salvar ${row.codigo}`}
                              onClick={() => void saveOneRow(row)}
                              disabled={savingRowId === row.equipamentoId || savingAll || !env.ok}
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
```
