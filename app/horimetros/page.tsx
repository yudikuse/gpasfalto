"use client";

import { useEffect, useMemo, useState } from "react";
import { Inter, Manrope } from "next/font/google";
import { supabase } from "@/lib/supabaseClient";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

type ObraRow = {
  id: number;
  obra: string;
  ativo: boolean | null;
};

type EquipRow = {
  id: number;
  codigo: string;
  obra_padrao_id: number | null;
  usa_horimetro: boolean | null;
  usa_odometro: boolean | null;
  ativo: boolean | null;
  horimetro_base: number | string | null;
  odometro_base: number | string | null;
};

type LeituraRow = {
  id: number;
  data: string;
  obra_id: number;
  equipamento_id: number;
  horimetro_inicial: number | string | null;
  horimetro_final: number | string | null;
  horas_trabalhadas: number | string | null;
  odometro_inicial: number | string | null;
  odometro_final: number | string | null;
  km_rodados: number | string | null;
  observacao: string | null;
  status: "pendente" | "lancado" | "atrasado";
  updated_by_user_id: string | null;
  updated_by_nome: string | null;
  updated_at: string;
  created_at: string;
};

type DraftRow = {
  obra_id: string;
  horimetro_final: string;
  odometro_final: string;
  observacao: string;
};

type SavePayload = {
  data: string;
  obra_id: number;
  equipamento_id: number;
  horimetro_inicial: number | null;
  horimetro_final: number | null;
  odometro_inicial: number | null;
  odometro_final: number | null;
  observacao: string | null;
  status: "pendente" | "lancado";
  updated_by_user_id: string | null;
  updated_by_nome: string;
};

type RowStatus =
  | { kind: "saving"; label: string; title: string }
  | { kind: "error"; label: string; title: string }
  | { kind: "saved"; label: string; title: string }
  | { kind: "partial"; label: string; title: string }
  | { kind: "dirty"; label: string; title: string }
  | { kind: "pending"; label: string; title: string };

function toInputDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + days);
  return toInputDate(dt);
}

function formatDateBr(dateStr: string) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

function sanitizeNumericInput(value: string) {
  return value.replace(/[^\d,.\-]/g, "");
}

function parseFlexibleNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let s = sanitizeNumericInput(String(value)).trim();
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  let decimalSeparator = "";

  if (lastComma !== -1 && lastDot !== -1) {
    decimalSeparator = lastComma > lastDot ? "," : ".";
  } else if (lastComma !== -1) {
    decimalSeparator = ",";
  } else if (lastDot !== -1) {
    const parts = s.split(".");
    const lastGroup = parts[parts.length - 1] || "";
    decimalSeparator = lastGroup.length <= 2 ? "." : "";
  }

  let normalized = "";

  if (decimalSeparator) {
    const index = decimalSeparator === "," ? lastComma : lastDot;
    const intPart = s.slice(0, index).replace(/[.,]/g, "");
    const decPart = s.slice(index + 1).replace(/[.,]/g, "");
    normalized = `${intPart || "0"}.${decPart || "0"}`;
  } else {
    normalized = s.replace(/[.,]/g, "");
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function format1(value: unknown) {
  const n = parseFlexibleNumber(value);
  if (n === null) return "";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatShortTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatUpdatedAt(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR");
}

function normText(value: string | null | undefined) {
  return (value || "").trim();
}

export default function HorimetrosPage() {
  const [obras, setObras] = useState<ObraRow[]>([]);
  const [equipamentos, setEquipamentos] = useState<EquipRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(toInputDate());
  const [search, setSearch] = useState("");

  const [currentRows, setCurrentRows] = useState<Record<number, LeituraRow>>({});
  const [previousRows, setPreviousRows] = useState<Record<number, LeituraRow>>({});
  const [drafts, setDrafts] = useState<Record<number, DraftRow>>({});

  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [savingRows, setSavingRows] = useState<Record<number, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");

  const previousDate = useMemo(() => addDays(selectedDate, -1), [selectedDate]);
  const previousDateLabel = useMemo(() => formatDateBr(previousDate), [previousDate]);
  const currentDateLabel = useMemo(() => formatDateBr(selectedDate), [selectedDate]);

  const obrasById = useMemo(() => {
    const map = new Map<number, string>();
    for (const obra of obras) map.set(obra.id, obra.obra);
    return map;
  }, [obras]);

  useEffect(() => {
    async function loadBase() {
      setLoadingBase(true);
      setMessage("");

      const [{ data: obrasData, error: obrasError }, { data: equipData, error: equipError }] =
        await Promise.all([
          supabase
            .from("obras")
            .select("id, obra, ativo")
            .eq("ativo", true)
            .order("obra", { ascending: true }),
          supabase
            .from("horimetro_equipamentos")
            .select(
              "id, codigo, obra_padrao_id, usa_horimetro, usa_odometro, ativo, horimetro_base, odometro_base"
            )
            .eq("ativo", true)
            .order("codigo", { ascending: true }),
        ]);

      if (obrasError) {
        setMessage(`Erro ao carregar obras: ${obrasError.message}`);
      }

      if (equipError) {
        setMessage((prev) =>
          prev
            ? `${prev} | Erro ao carregar equipamentos: ${equipError.message}`
            : `Erro ao carregar equipamentos: ${equipError.message}`
        );
      }

      setObras((obrasData || []) as ObraRow[]);
      setEquipamentos((equipData || []) as EquipRow[]);
      setLoadingBase(false);
    }

    loadBase();
  }, []);

  useEffect(() => {
    async function loadRows() {
      if (!equipamentos.length) {
        setCurrentRows({});
        setPreviousRows({});
        setDrafts({});
        return;
      }

      setLoadingRows(true);
      setMessage("");

      const ids = equipamentos.map((e) => e.id);

      const [{ data: currentData, error: currentError }, { data: previousData, error: previousError }] =
        await Promise.all([
          supabase
            .from("horimetro_leituras_diarias")
            .select(
              "id, data, obra_id, equipamento_id, horimetro_inicial, horimetro_final, horas_trabalhadas, odometro_inicial, odometro_final, km_rodados, observacao, status, updated_by_user_id, updated_by_nome, updated_at, created_at"
            )
            .eq("data", selectedDate)
            .in("equipamento_id", ids),
          supabase
            .from("horimetro_leituras_diarias")
            .select(
              "id, data, obra_id, equipamento_id, horimetro_inicial, horimetro_final, horas_trabalhadas, odometro_inicial, odometro_final, km_rodados, observacao, status, updated_by_user_id, updated_by_nome, updated_at, created_at"
            )
            .lt("data", selectedDate)
            .in("equipamento_id", ids)
            .order("equipamento_id", { ascending: true })
            .order("data", { ascending: false }),
        ]);

      if (currentError) {
        setMessage(`Erro ao carregar leituras do dia: ${currentError.message}`);
      }

      if (previousError) {
        setMessage((prev) =>
          prev
            ? `${prev} | Erro ao carregar histórico: ${previousError.message}`
            : `Erro ao carregar histórico: ${previousError.message}`
        );
      }

      const currentMap: Record<number, LeituraRow> = {};
      for (const row of (currentData || []) as LeituraRow[]) {
        currentMap[row.equipamento_id] = row;
      }

      const prevMap: Record<number, LeituraRow> = {};
      for (const row of (previousData || []) as LeituraRow[]) {
        if (!prevMap[row.equipamento_id]) {
          prevMap[row.equipamento_id] = row;
        }
      }

      const defaultObraId = obras[0]?.id ? String(obras[0].id) : "";
      const nextDrafts: Record<number, DraftRow> = {};

      for (const eq of equipamentos) {
        const row = currentMap[eq.id];
        nextDrafts[eq.id] = {
          obra_id: row?.obra_id
            ? String(row.obra_id)
            : eq.obra_padrao_id
            ? String(eq.obra_padrao_id)
            : defaultObraId,
          horimetro_final:
            row?.horimetro_final !== null && row?.horimetro_final !== undefined
              ? format1(row.horimetro_final)
              : "",
          odometro_final:
            row?.odometro_final !== null && row?.odometro_final !== undefined
              ? format1(row.odometro_final)
              : "",
          observacao: row?.observacao || "",
        };
      }

      setCurrentRows(currentMap);
      setPreviousRows(prevMap);
      setDrafts(nextDrafts);
      setRowErrors({});
      setSavingRows({});
      setLoadingRows(false);
    }

    loadRows();
  }, [selectedDate, equipamentos, obras]);

  function getInitialHorimetro(eq: EquipRow) {
    const today = currentRows[eq.id];
    if (today && today.horimetro_inicial !== null && today.horimetro_inicial !== undefined) {
      return parseFlexibleNumber(today.horimetro_inicial);
    }

    const prev = previousRows[eq.id];
    if (prev && prev.horimetro_final !== null && prev.horimetro_final !== undefined) {
      return parseFlexibleNumber(prev.horimetro_final);
    }

    return parseFlexibleNumber(eq.horimetro_base);
  }

  function getInitialOdometro(eq: EquipRow) {
    const today = currentRows[eq.id];
    if (today && today.odometro_inicial !== null && today.odometro_inicial !== undefined) {
      return parseFlexibleNumber(today.odometro_inicial);
    }

    const prev = previousRows[eq.id];
    if (prev && prev.odometro_final !== null && prev.odometro_final !== undefined) {
      return parseFlexibleNumber(prev.odometro_final);
    }

    return parseFlexibleNumber(eq.odometro_base);
  }

  function getHorasDoDia(eq: EquipRow) {
    if (!eq.usa_horimetro) return null;
    const ini = getInitialHorimetro(eq);
    const fim = parseFlexibleNumber(drafts[eq.id]?.horimetro_final || "");
    if (ini === null || fim === null) return null;
    return Number((fim - ini).toFixed(1));
  }

  function getKmDoDia(eq: EquipRow) {
    if (!eq.usa_odometro) return null;
    const ini = getInitialOdometro(eq);
    const fim = parseFlexibleNumber(drafts[eq.id]?.odometro_final || "");
    if (ini === null || fim === null) return null;
    return Number((fim - ini).toFixed(1));
  }

  function updateDraft(equipamentoId: number, field: keyof DraftRow, value: string) {
    const nextValue =
      field === "horimetro_final" || field === "odometro_final"
        ? sanitizeNumericInput(value)
        : value;

    setDrafts((prev) => ({
      ...prev,
      [equipamentoId]: {
        obra_id: prev[equipamentoId]?.obra_id || "",
        horimetro_final: prev[equipamentoId]?.horimetro_final || "",
        odometro_final: prev[equipamentoId]?.odometro_final || "",
        observacao: prev[equipamentoId]?.observacao || "",
        [field]: nextValue,
      },
    }));

    setRowErrors((prev) => {
      if (!prev[equipamentoId]) return prev;
      const next = { ...prev };
      delete next[equipamentoId];
      return next;
    });
  }

  function handleNumericBlur(equipamentoId: number, field: "horimetro_final" | "odometro_final") {
    const currentValue = drafts[equipamentoId]?.[field] || "";
    const parsed = parseFlexibleNumber(currentValue);
    if (parsed === null) return;

    setDrafts((prev) => ({
      ...prev,
      [equipamentoId]: {
        ...prev[equipamentoId],
        [field]: format1(parsed),
      },
    }));
  }

  function hasAnyUserData(eq: EquipRow) {
    const draft = drafts[eq.id] || {
      obra_id: "",
      horimetro_final: "",
      odometro_final: "",
      observacao: "",
    };

    const hasHorimetro = eq.usa_horimetro && parseFlexibleNumber(draft.horimetro_final) !== null;
    const hasOdometro = eq.usa_odometro && parseFlexibleNumber(draft.odometro_final) !== null;
    const hasObs = normText(draft.observacao).length > 0;

    return Boolean(hasHorimetro || hasOdometro || hasObs);
  }

  function isDirty(eq: EquipRow) {
    const current = currentRows[eq.id];
    const draft = drafts[eq.id] || {
      obra_id: "",
      horimetro_final: "",
      odometro_final: "",
      observacao: "",
    };

    if (!current) {
      return hasAnyUserData(eq);
    }

    const sameObra = String(current.obra_id || "") === String(draft.obra_id || "");
    const sameHorimetro =
      parseFlexibleNumber(draft.horimetro_final) === parseFlexibleNumber(current.horimetro_final);
    const sameOdometro =
      parseFlexibleNumber(draft.odometro_final) === parseFlexibleNumber(current.odometro_final);
    const sameObs = normText(draft.observacao) === normText(current.observacao);

    return !(sameObra && sameHorimetro && sameOdometro && sameObs);
  }

  function canSaveRow(eq: EquipRow) {
    const current = currentRows[eq.id];
    if (current) return isDirty(eq);
    return hasAnyUserData(eq);
  }

  function getRowStatus(eq: EquipRow): RowStatus {
    const current = currentRows[eq.id];
    const error = rowErrors[eq.id];

    if (savingRows[eq.id]) {
      return { kind: "saving", label: "salvando", title: "Salvando linha..." };
    }

    if (error) {
      return { kind: "error", label: "erro", title: error };
    }

    if (current && isDirty(eq)) {
      return {
        kind: "dirty",
        label: "alterado",
        title: "Há alterações não salvas nesta linha.",
      };
    }

    if (current && current.status === "lancado") {
      return {
        kind: "saved",
        label: `salvo ${formatShortTime(current.updated_at)}`,
        title: `${formatUpdatedAt(current.updated_at)} • ${current.updated_by_nome || ""} • ${
          obrasById.get(current.obra_id) || ""
        }`,
      };
    }

    if (current && current.status !== "lancado") {
      return {
        kind: "partial",
        label: "parcial",
        title: "Linha salva parcialmente.",
      };
    }

    if (hasAnyUserData(eq)) {
      return {
        kind: "dirty",
        label: "preencher",
        title: "Há dados digitados ainda não salvos.",
      };
    }

    return {
      kind: "pending",
      label: "pendente",
      title: "Ainda não salvo neste dia.",
    };
  }

  function buildPayloadForRow(eq: EquipRow): { payload?: SavePayload; error?: string } {
    const draft = drafts[eq.id] || {
      obra_id: "",
      horimetro_final: "",
      odometro_final: "",
      observacao: "",
    };

    const obraId = Number(draft.obra_id);
    const horimetroInicial = eq.usa_horimetro ? getInitialHorimetro(eq) : null;
    const odometroInicial = eq.usa_odometro ? getInitialOdometro(eq) : null;

    const horimetroFinal = eq.usa_horimetro ? parseFlexibleNumber(draft.horimetro_final) : null;
    const odometroFinal = eq.usa_odometro ? parseFlexibleNumber(draft.odometro_final) : null;

    const current = currentRows[eq.id];
    const hasCurrent = !!current;
    const hasObs = normText(draft.observacao).length > 0;
    const hasAnyValue =
      (eq.usa_horimetro && horimetroFinal !== null) ||
      (eq.usa_odometro && odometroFinal !== null);

    if (!hasCurrent && !hasAnyValue && !hasObs) {
      return {};
    }

    if (!obraId) {
      return { error: `Selecione a obra em ${eq.codigo}.` };
    }

    if (eq.usa_horimetro && horimetroInicial !== null && horimetroFinal !== null) {
      if (horimetroFinal < horimetroInicial) {
        return { error: `Horímetro final menor que o inicial em ${eq.codigo}.` };
      }
    }

    if (eq.usa_odometro && odometroInicial !== null && odometroFinal !== null) {
      if (odometroFinal < odometroInicial) {
        return { error: `Odômetro final menor que o inicial em ${eq.codigo}.` };
      }
    }

    const status =
      (!eq.usa_horimetro || horimetroFinal !== null) &&
      (!eq.usa_odometro || odometroFinal !== null)
        ? "lancado"
        : "pendente";

    return {
      payload: {
        data: selectedDate,
        obra_id: obraId,
        equipamento_id: eq.id,
        horimetro_inicial: horimetroInicial,
        horimetro_final: horimetroFinal,
        odometro_inicial: odometroInicial,
        odometro_final: odometroFinal,
        observacao: normText(draft.observacao) || null,
        status,
        updated_by_user_id: null,
        updated_by_nome: "",
      },
    };
  }

  async function getAuthInfo() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const userId = user?.id || null;
    const userName =
      (user?.user_metadata?.name as string | undefined) ||
      (user?.user_metadata?.full_name as string | undefined) ||
      user?.email ||
      "Usuário";

    return { userId, userName };
  }

  async function reloadCurrentRows(ids: number[]) {
    if (!ids.length) return;

    const { data, error } = await supabase
      .from("horimetro_leituras_diarias")
      .select(
        "id, data, obra_id, equipamento_id, horimetro_inicial, horimetro_final, horas_traballhadas, odometro_inicial, odometro_final, km_rodados, observacao, status, updated_by_user_id, updated_by_nome, updated_at, created_at"
      )
      .eq("data", selectedDate)
      .in("equipamento_id", ids);

    if (error) {
      const { data: fallbackData, error: fallbackError } = await supabase
        .from("horimetro_leituras_diarias")
        .select(
          "id, data, obra_id, equipamento_id, horimetro_inicial, horimetro_final, horas_trabalhadas, odometro_inicial, odometro_final, km_rodados, observacao, status, updated_by_user_id, updated_by_nome, updated_at, created_at"
        )
        .eq("data", selectedDate)
        .in("equipamento_id", ids);

      if (fallbackError) return;

      setCurrentRows((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        for (const row of (fallbackData || []) as LeituraRow[]) {
          next[row.equipamento_id] = row;
        }
        return next;
      });
      return;
    }

    setCurrentRows((prev) => {
      const next = { ...prev };

      for (const id of ids) delete next[id];
      for (const row of (data || []) as LeituraRow[]) {
        next[row.equipamento_id] = row;
      }

      return next;
    });
  }

  async function updateObraPadrao(equipamentoId: number, obraId: number) {
    await supabase
      .from("horimetro_equipamentos")
      .upsert([{ id: equipamentoId, obra_padrao_id: obraId }], { onConflict: "id" });

    setEquipamentos((prev) =>
      prev.map((eq) => (eq.id === equipamentoId ? { ...eq, obra_padrao_id: obraId } : eq))
    );
  }

  async function handleSaveRow(eq: EquipRow) {
    const built = buildPayloadForRow(eq);

    if (built.error) {
      setRowErrors((prev) => ({ ...prev, [eq.id]: built.error! }));
      return;
    }

    if (!built.payload) {
      return;
    }

    setSavingRows((prev) => ({ ...prev, [eq.id]: true }));
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[eq.id];
      return next;
    });

    const { userId, userName } = await getAuthInfo();

    const payload = {
      ...built.payload,
      updated_by_user_id: userId,
      updated_by_nome: userName,
    };

    const { error } = await supabase
      .from("horimetro_leituras_diarias")
      .upsert([payload], { onConflict: "data,equipamento_id" });

    if (error) {
      setSavingRows((prev) => ({ ...prev, [eq.id]: false }));
      setRowErrors((prev) => ({ ...prev, [eq.id]: error.message }));
      return;
    }

    await updateObraPadrao(eq.id, payload.obra_id);
    await reloadCurrentRows([eq.id]);

    setSavingRows((prev) => ({ ...prev, [eq.id]: false }));
  }

  async function handleSaveAll() {
    setSavingAll(true);
    setMessage("");

    const { userId, userName } = await getAuthInfo();

    const payloads: SavePayload[] = [];
    const nextRowErrors: Record<number, string> = {};

    for (const eq of equipamentos) {
      const built = buildPayloadForRow(eq);

      if (built.error) {
        nextRowErrors[eq.id] = built.error;
        continue;
      }

      if (built.payload) {
        payloads.push({
          ...built.payload,
          updated_by_user_id: userId,
          updated_by_nome: userName,
        });
      }
    }

    setRowErrors((prev) => ({ ...prev, ...nextRowErrors }));

    if (!payloads.length) {
      setSavingAll(false);
      setMessage("Nada para salvar.");
      return;
    }

    const { error } = await supabase
      .from("horimetro_leituras_diarias")
      .upsert(payloads, { onConflict: "data,equipamento_id" });

    if (error) {
      setSavingAll(false);
      setMessage(`Erro ao salvar: ${error.message}`);
      return;
    }

    const obraPadraoUpdates = payloads.map((p) => ({
      id: p.equipamento_id,
      obra_padrao_id: p.obra_id,
    }));

    await supabase.from("horimetro_equipamentos").upsert(obraPadraoUpdates, { onConflict: "id" });

    setEquipamentos((prev) =>
      prev.map((eq) => {
        const found = obraPadraoUpdates.find((u) => u.id === eq.id);
        if (!found) return eq;
        return { ...eq, obra_padrao_id: found.obra_padrao_id };
      })
    );

    await reloadCurrentRows(payloads.map((p) => p.equipamento_id));

    setSavingAll(false);
    setMessage("Leituras salvas com sucesso.");
  }

  const totalLancados = useMemo(() => {
    return equipamentos.filter((eq) => currentRows[eq.id]?.status === "lancado").length;
  }, [equipamentos, currentRows]);

  const totalPendentes = useMemo(() => {
    return equipamentos.length - totalLancados;
  }, [equipamentos.length, totalLancados]);

  const filteredEquipamentos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return equipamentos;
    return equipamentos.filter((eq) => eq.codigo.toLowerCase().includes(q));
  }, [equipamentos, search]);

  return (
    <>
      <main className={`${inter.variable} ${manrope.variable} app-root`}>
        <div className="app-shell">
          <header className="topbar">
            <div className="brand">
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" className="brand-logo" />
              <div className="brand-copy">
                <div className="brand-kicker">GP ASFALTO</div>
                <h1 className="brand-title">Horímetros e Odômetros</h1>
                <p className="brand-subtitle">
                  Lançamento diário por equipamento com salvamento por linha.
                </p>
              </div>
            </div>

            <div className="topbar-actions">
              <label className="field compact">
                <span className="label">Data</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="ui-input"
                />
              </label>

              <button
                type="button"
                onClick={handleSaveAll}
                disabled={savingAll || loadingBase || loadingRows}
                className="primary-btn"
              >
                {savingAll ? "Salvando..." : "Salvar tudo"}
              </button>
            </div>
          </header>

          <section className="summary-row">
            <div className="summary-pill">
              Equipamentos <strong>{equipamentos.length}</strong>
            </div>
            <div className="summary-pill">
              Lançados <strong>{totalLancados}</strong>
            </div>
            <div className="summary-pill">
              Pendentes <strong>{totalPendentes}</strong>
            </div>
          </section>

          <section className="toolbar">
            <label className="field search-field">
              <span className="label">Busca</span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ui-input"
                placeholder="MN-05"
              />
            </label>

            <div className="period-chip">
              <span>Período</span>
              <strong>
                {previousDateLabel} — {currentDateLabel}
              </strong>
            </div>
          </section>

          {message ? <div className="message-box">{message}</div> : null}

          <section className="timesheet-panel desktop-only">
            {loadingBase || loadingRows ? (
              <div className="empty-state">Carregando...</div>
            ) : filteredEquipamentos.length === 0 ? (
              <div className="empty-state">Nenhum equipamento encontrado.</div>
            ) : (
              <div className="table-scroll">
                <table className="timesheet-table">
                  <colgroup>
                    <col style={{ width: "86px" }} />
                    <col style={{ width: "190px" }} />
                    <col style={{ width: "96px" }} />
                    <col style={{ width: "104px" }} />
                    <col style={{ width: "80px" }} />
                    <col style={{ width: "96px" }} />
                    <col style={{ width: "104px" }} />
                    <col style={{ width: "80px" }} />
                    <col style={{ width: "156px" }} />
                    <col style={{ width: "88px" }} />
                    <col style={{ width: "86px" }} />
                  </colgroup>

                  <thead>
                    <tr>
                      <th>Equip.</th>
                      <th>Obra</th>
                      <th>H anterior</th>
                      <th>H atual</th>
                      <th>Horas</th>
                      <th>O anterior</th>
                      <th>O atual</th>
                      <th>Km</th>
                      <th>Observação</th>
                      <th>Status</th>
                      <th>Ação</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredEquipamentos.map((eq) => {
                      const draft = drafts[eq.id] || {
                        obra_id: "",
                        horimetro_final: "",
                        odometro_final: "",
                        observacao: "",
                      };

                      const hIni = getInitialHorimetro(eq);
                      const oIni = getInitialOdometro(eq);
                      const horas = getHorasDoDia(eq);
                      const km = getKmDoDia(eq);
                      const status = getRowStatus(eq);

                      return (
                        <tr key={eq.id}>
                          <td className="col-equip">{eq.codigo}</td>

                          <td>
                            <select
                              value={draft.obra_id}
                              onChange={(e) => updateDraft(eq.id, "obra_id", e.target.value)}
                              className="ui-input ui-input-sm input-soft"
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
                            <div className="readonly-box num">
                              {eq.usa_horimetro ? format1(hIni) || "—" : "—"}
                            </div>
                          </td>

                          <td>
                            {eq.usa_horimetro ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={draft.horimetro_final}
                                onChange={(e) => updateDraft(eq.id, "horimetro_final", e.target.value)}
                                onBlur={() => handleNumericBlur(eq.id, "horimetro_final")}
                                className="ui-input ui-input-sm input-edit num"
                                placeholder="Digite"
                              />
                            ) : (
                              <div className="readonly-box center">—</div>
                            )}
                          </td>

                          <td>
                            <div className="readonly-box num">
                              {eq.usa_horimetro ? format1(horas) || "—" : "—"}
                            </div>
                          </td>

                          <td>
                            <div className="readonly-box num">
                              {eq.usa_odometro ? format1(oIni) || "—" : "—"}
                            </div>
                          </td>

                          <td>
                            {eq.usa_odometro ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={draft.odometro_final}
                                onChange={(e) => updateDraft(eq.id, "odometro_final", e.target.value)}
                                onBlur={() => handleNumericBlur(eq.id, "odometro_final")}
                                className="ui-input ui-input-sm input-edit num"
                                placeholder="Digite"
                              />
                            ) : (
                              <div className="readonly-box center">—</div>
                            )}
                          </td>

                          <td>
                            <div className="readonly-box num">
                              {eq.usa_odometro ? format1(km) || "—" : "—"}
                            </div>
                          </td>

                          <td>
                            <input
                              type="text"
                              value={draft.observacao}
                              onChange={(e) => updateDraft(eq.id, "observacao", e.target.value)}
                              className="ui-input ui-input-sm input-edit"
                              placeholder="Observação"
                            />
                          </td>

                          <td>
                            <div className="status-cell" title={status.title}>
                              <span className={`status-pill ${status.kind}`}>{status.label}</span>
                            </div>
                          </td>

                          <td>
                            <button
                              type="button"
                              onClick={() => handleSaveRow(eq)}
                              disabled={!canSaveRow(eq) || !!savingRows[eq.id]}
                              className="row-btn"
                            >
                              {savingRows[eq.id] ? "..." : "Salvar"}
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

          <section className="mobile-list mobile-only">
            {loadingBase || loadingRows ? (
              <div className="empty-state">Carregando...</div>
            ) : filteredEquipamentos.length === 0 ? (
              <div className="empty-state">Nenhum equipamento encontrado.</div>
            ) : (
              filteredEquipamentos.map((eq) => {
                const draft = drafts[eq.id] || {
                  obra_id: "",
                  horimetro_final: "",
                  odometro_final: "",
                  observacao: "",
                };

                const hIni = getInitialHorimetro(eq);
                const oIni = getInitialOdometro(eq);
                const horas = getHorasDoDia(eq);
                const km = getKmDoDia(eq);
                const status = getRowStatus(eq);

                return (
                  <article key={eq.id} className="mobile-card">
                    <div className="mobile-head">
                      <strong>{eq.codigo}</strong>
                      <span className={`status-pill ${status.kind}`} title={status.title}>
                        {status.label}
                      </span>
                    </div>

                    <div className="mobile-grid">
                      <label className="field full">
                        <span className="label">Obra</span>
                        <select
                          value={draft.obra_id}
                          onChange={(e) => updateDraft(eq.id, "obra_id", e.target.value)}
                          className="ui-input input-soft"
                        >
                          <option value="">Selecione</option>
                          {obras.map((obra) => (
                            <option key={obra.id} value={obra.id}>
                              {obra.obra}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="field">
                        <span className="label">H anterior</span>
                        <div className="readonly-box num">
                          {eq.usa_horimetro ? format1(hIni) || "—" : "—"}
                        </div>
                      </div>

                      <label className="field">
                        <span className="label">H atual</span>
                        {eq.usa_horimetro ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.horimetro_final}
                            onChange={(e) => updateDraft(eq.id, "horimetro_final", e.target.value)}
                            onBlur={() => handleNumericBlur(eq.id, "horimetro_final")}
                            className="ui-input input-edit num"
                            placeholder="Digite"
                          />
                        ) : (
                          <div className="readonly-box center">—</div>
                        )}
                      </label>

                      <div className="field">
                        <span className="label">Horas</span>
                        <div className="readonly-box num">
                          {eq.usa_horimetro ? format1(horas) || "—" : "—"}
                        </div>
                      </div>

                      <div className="field">
                        <span className="label">O anterior</span>
                        <div className="readonly-box num">
                          {eq.usa_odometro ? format1(oIni) || "—" : "—"}
                        </div>
                      </div>

                      <label className="field">
                        <span className="label">O atual</span>
                        {eq.usa_odometro ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.odometro_final}
                            onChange={(e) => updateDraft(eq.id, "odometro_final", e.target.value)}
                            onBlur={() => handleNumericBlur(eq.id, "odometro_final")}
                            className="ui-input input-edit num"
                            placeholder="Digite"
                          />
                        ) : (
                          <div className="readonly-box center">—</div>
                        )}
                      </label>

                      <div className="field">
                        <span className="label">Km</span>
                        <div className="readonly-box num">
                          {eq.usa_odometro ? format1(km) || "—" : "—"}
                        </div>
                      </div>

                      <label className="field full">
                        <span className="label">Observação</span>
                        <input
                          type="text"
                          value={draft.observacao}
                          onChange={(e) => updateDraft(eq.id, "observacao", e.target.value)}
                          className="ui-input input-edit"
                          placeholder="Observação"
                        />
                      </label>
                    </div>

                    <div className="mobile-actions">
                      <button
                        type="button"
                        onClick={() => handleSaveRow(eq)}
                        disabled={!canSaveRow(eq) || !!savingRows[eq.id]}
                        className="row-btn mobile-row-btn"
                      >
                        {savingRows[eq.id] ? "Salvando..." : "Salvar linha"}
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </div>

        <div className="mobile-savebar mobile-only">
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={savingAll || loadingBase || loadingRows}
            className="primary-btn mobile-primary"
          >
            {savingAll ? "Salvando..." : "Salvar tudo"}
          </button>
        </div>
      </main>

      <style jsx global>{`
        :root {
          --bg: #f3f4f6;
          --surface: #ffffff;
          --surface-soft: #fafbfc;
          --surface-muted: #f4f6f8;
          --line: #e8ebef;
          --line-soft: #eff2f5;
          --text: #111827;
          --muted: #667085;
          --muted-2: #98a2b3;
          --navy: #0b1733;
          --navy-2: #142445;
          --ok-bg: #ecfdf3;
          --ok-text: #0f766e;
          --warn-bg: #fff7ed;
          --warn-text: #b45309;
          --red-bg: #fff1f2;
          --red-text: #c81e1e;
          --blue-bg: #eef2ff;
          --blue-text: #3730a3;
        }

        * {
          box-sizing: border-box;
        }

        body,
        input,
        select,
        button {
          font-family: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
        }

        body {
          margin: 0;
          background: #f4f5f7;
          color: var(--text);
        }

        .app-root {
          min-height: 100vh;
          padding: 28px 16px 88px;
        }

        .app-shell {
          width: 100%;
          max-width: 1180px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .topbar {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 18px;
          align-items: center;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 18px;
          min-width: 0;
        }

        .brand-logo {
          width: 132px;
          height: auto;
          object-fit: contain;
          flex-shrink: 0;
        }

        .brand-copy {
          min-width: 0;
        }

        .brand-kicker {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 2px;
        }

        .brand-title {
          margin: 0;
          font-family: var(--font-manrope), var(--font-inter), sans-serif;
          font-size: 26px;
          line-height: 1.05;
          letter-spacing: -0.03em;
          color: var(--navy);
          font-weight: 800;
        }

        .brand-subtitle {
          margin: 6px 0 0;
          font-size: 13px;
          color: var(--muted);
        }

        .topbar-actions {
          display: flex;
          align-items: end;
          gap: 10px;
          justify-content: flex-end;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }

        .field.compact {
          min-width: 170px;
        }

        .label {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #475467;
        }

        .summary-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .summary-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 999px;
          color: var(--muted);
          font-size: 12px;
        }

        .summary-pill strong {
          color: var(--text);
        }

        .toolbar {
          display: grid;
          grid-template-columns: minmax(260px, 1fr) 220px;
          gap: 12px;
          align-items: end;
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 12px;
        }

        .search-field {
          min-width: 0;
        }

        .ui-input {
          width: 100%;
          height: 40px;
          border: 1px solid var(--line);
          border-radius: 6px;
          background: #fff;
          padding: 0 12px;
          font-size: 14px;
          color: var(--text);
          outline: none;
          transition: 0.15s ease;
        }

        .ui-input:focus {
          border-color: #cfd6df;
          box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.04);
        }

        .ui-input-sm {
          height: 34px;
          padding: 0 10px;
          font-size: 13px;
        }

        .input-soft {
          background: var(--surface-soft);
        }

        .input-edit {
          background: #fbfcfd;
        }

        .input-edit::placeholder {
          color: var(--muted-2);
        }

        .readonly-box {
          height: 34px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 0 10px;
          border-radius: 6px;
          background: var(--surface-muted);
          color: var(--text);
          font-size: 13px;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }

        .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .center {
          justify-content: center;
        }

        .period-chip {
          height: 40px;
          border-radius: 6px;
          background: var(--surface-muted);
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 0 12px;
        }

        .period-chip span {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #475467;
        }

        .period-chip strong {
          margin-top: 2px;
          font-size: 13px;
          color: var(--text);
        }

        .primary-btn {
          height: 40px;
          border: 0;
          border-radius: 6px;
          background: var(--navy);
          color: #fff;
          font-size: 14px;
          font-weight: 800;
          padding: 0 16px;
          cursor: pointer;
        }

        .primary-btn:hover {
          background: var(--navy-2);
        }

        .primary-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .message-box {
          background: #fff7ed;
          color: #9a3412;
          border: 1px solid #fed7aa;
          border-radius: 8px;
          padding: 12px 14px;
          font-size: 13px;
          font-weight: 700;
        }

        .timesheet-panel {
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 8px;
          overflow: hidden;
        }

        .table-scroll {
          overflow-x: auto;
        }

        .timesheet-table {
          width: 100%;
          min-width: 1140px;
          border-collapse: collapse;
          font-size: 13px;
        }

        .timesheet-table thead th {
          background: #fff;
          text-align: left;
          padding: 12px 8px;
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #475467;
          border-bottom: 1px solid var(--line);
          white-space: nowrap;
        }

        .timesheet-table tbody td {
          padding: 10px 8px;
          vertical-align: middle;
          border-bottom: 1px solid var(--line-soft);
        }

        .timesheet-table tbody tr:hover {
          background: #fafbfc;
        }

        .col-equip {
          font-weight: 800;
          color: var(--navy);
          white-space: nowrap;
        }

        .status-cell {
          display: flex;
          align-items: center;
          justify-content: flex-start;
        }

        .status-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 70px;
          height: 24px;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 800;
          line-height: 1;
          white-space: nowrap;
        }

        .status-pill.saved {
          background: var(--ok-bg);
          color: var(--ok-text);
        }

        .status-pill.partial,
        .status-pill.dirty {
          background: var(--warn-bg);
          color: var(--warn-text);
        }

        .status-pill.pending,
        .status-pill.error {
          background: var(--red-bg);
          color: var(--red-text);
        }

        .status-pill.saving {
          background: var(--blue-bg);
          color: var(--blue-text);
        }

        .row-btn {
          height: 32px;
          min-width: 76px;
          border: 0;
          border-radius: 6px;
          background: #0f172a;
          color: #fff;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          padding: 0 12px;
        }

        .row-btn:hover {
          background: #1e293b;
        }

        .row-btn:disabled {
          background: #e5e7eb;
          color: #98a2b3;
          cursor: not-allowed;
        }

        .empty-state {
          padding: 28px;
          text-align: center;
          color: var(--muted);
          font-weight: 700;
        }

        .mobile-only {
          display: none;
        }

        .mobile-list {
          flex-direction: column;
          gap: 10px;
        }

        .mobile-card {
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 8px;
          padding: 12px;
        }

        .mobile-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }

        .mobile-head strong {
          font-size: 20px;
          color: var(--navy);
        }

        .mobile-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .mobile-grid .full {
          grid-column: 1 / -1;
        }

        .mobile-actions {
          margin-top: 10px;
          display: flex;
          justify-content: flex-end;
        }

        .mobile-row-btn {
          min-width: 112px;
        }

        .mobile-savebar {
          display: none;
        }

        @media (max-width: 980px) {
          .topbar {
            grid-template-columns: 1fr;
          }

          .topbar-actions {
            justify-content: flex-start;
          }

          .toolbar {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 760px) {
          .app-root {
            padding: 16px 10px 92px;
          }

          .brand {
            align-items: flex-start;
          }

          .brand-logo {
            width: 110px;
          }

          .brand-title {
            font-size: 24px;
          }

          .brand-subtitle {
            font-size: 12px;
          }

          .desktop-only {
            display: none;
          }

          .mobile-only {
            display: flex;
          }

          .mobile-savebar {
            display: block;
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            padding: 10px 12px 14px;
            background: linear-gradient(
              180deg,
              rgba(244, 245, 247, 0) 0%,
              rgba(244, 245, 247, 0.95) 24%,
              rgba(244, 245, 247, 1) 100%
            );
            z-index: 20;
          }

          .mobile-primary {
            width: 100%;
            height: 44px;
          }
        }
      `}</style>
    </>
  );
}
