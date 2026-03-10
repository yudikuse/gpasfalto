"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type ObraRow = {
  id: number;
  obra: string;
  ativo: boolean | null;
};

type EquipRow = {
  id: number;
  codigo: string;
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
  horimetro_final: string;
  odometro_final: string;
  observacao: string;
};

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

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDecimalInput(text: string): number | null {
  const cleaned = (text || "").trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function format1(v: unknown) {
  const n = asNumber(v);
  if (n === null) return "";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatUpdatedAt(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("pt-BR");
}

function onlyDecimalChars(value: string) {
  return value.replace(/[^\d,.\-]/g, "");
}

export default function HorimetrosPage() {
  const [obras, setObras] = useState<ObraRow[]>([]);
  const [equipamentos, setEquipamentos] = useState<EquipRow[]>([]);
  const [selectedObraId, setSelectedObraId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(toInputDate());

  const [currentRows, setCurrentRows] = useState<Record<number, LeituraRow>>({});
  const [previousRows, setPreviousRows] = useState<Record<number, LeituraRow>>({});
  const [drafts, setDrafts] = useState<Record<number, DraftRow>>({});

  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");

  const previousDateLabel = useMemo(() => formatDateBr(addDays(selectedDate, -1)), [selectedDate]);
  const currentDateLabel = useMemo(() => formatDateBr(selectedDate), [selectedDate]);

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
              "id, codigo, usa_horimetro, usa_odometro, ativo, horimetro_base, odometro_base"
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

      const obrasList = (obrasData || []) as ObraRow[];
      const equipsList = (equipData || []) as EquipRow[];

      setObras(obrasList);
      setEquipamentos(equipsList);

      setSelectedObraId((prev) => {
        if (prev) return prev;
        return obrasList[0]?.id ? String(obrasList[0].id) : "";
      });

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

      const nextDrafts: Record<number, DraftRow> = {};
      for (const eq of equipamentos) {
        const row = currentMap[eq.id];
        nextDrafts[eq.id] = {
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
      setLoadingRows(false);
    }

    loadRows();
  }, [selectedDate, equipamentos]);

  function getInitialHorimetro(eq: EquipRow) {
    const today = currentRows[eq.id];
    if (today && today.horimetro_inicial !== null && today.horimetro_inicial !== undefined) {
      return asNumber(today.horimetro_inicial);
    }

    const prev = previousRows[eq.id];
    if (prev && prev.horimetro_final !== null && prev.horimetro_final !== undefined) {
      return asNumber(prev.horimetro_final);
    }

    return asNumber(eq.horimetro_base);
  }

  function getInitialOdometro(eq: EquipRow) {
    const today = currentRows[eq.id];
    if (today && today.odometro_inicial !== null && today.odometro_inicial !== undefined) {
      return asNumber(today.odometro_inicial);
    }

    const prev = previousRows[eq.id];
    if (prev && prev.odometro_final !== null && prev.odometro_final !== undefined) {
      return asNumber(prev.odometro_final);
    }

    return asNumber(eq.odometro_base);
  }

  function getHorasDoDia(eq: EquipRow) {
    if (!eq.usa_horimetro) return null;
    const ini = getInitialHorimetro(eq);
    const fim = parseDecimalInput(drafts[eq.id]?.horimetro_final || "");
    if (ini === null || fim === null) return null;
    return Number((fim - ini).toFixed(1));
  }

  function getKmDoDia(eq: EquipRow) {
    if (!eq.usa_odometro) return null;
    const ini = getInitialOdometro(eq);
    const fim = parseDecimalInput(drafts[eq.id]?.odometro_final || "");
    if (ini === null || fim === null) return null;
    return Number((fim - ini).toFixed(1));
  }

  function updateDraft(equipamentoId: number, field: keyof DraftRow, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [equipamentoId]: {
        horimetro_final: prev[equipamentoId]?.horimetro_final || "",
        odometro_final: prev[equipamentoId]?.odometro_final || "",
        observacao: prev[equipamentoId]?.observacao || "",
        [field]: value,
      },
    }));
  }

  async function handleSaveAll() {
    if (!selectedObraId) {
      setMessage("Selecione a obra.");
      return;
    }

    setSaving(true);
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const userId = user?.id || null;
    const userName =
      (user?.user_metadata?.name as string | undefined) ||
      (user?.user_metadata?.full_name as string | undefined) ||
      user?.email ||
      "Usuário";

    const payload: Record<string, unknown>[] = [];

    for (const eq of equipamentos) {
      const draft = drafts[eq.id] || {
        horimetro_final: "",
        odometro_final: "",
        observacao: "",
      };

      const horimetroInicial = eq.usa_horimetro ? getInitialHorimetro(eq) : null;
      const odometroInicial = eq.usa_odometro ? getInitialOdometro(eq) : null;

      const horimetroFinal = eq.usa_horimetro
        ? parseDecimalInput(draft.horimetro_final)
        : null;
      const odometroFinal = eq.usa_odometro
        ? parseDecimalInput(draft.odometro_final)
        : null;

      const hasCurrent = !!currentRows[eq.id];
      const hasObs = !!draft.observacao.trim();
      const hasAnyValue =
        (eq.usa_horimetro && horimetroFinal !== null) ||
        (eq.usa_odometro && odometroFinal !== null);

      if (!hasCurrent && !hasAnyValue && !hasObs) {
        continue;
      }

      if (eq.usa_horimetro && horimetroInicial !== null && horimetroFinal !== null) {
        if (horimetroFinal < horimetroInicial) {
          setSaving(false);
          setMessage(`Horímetro final menor que o inicial em ${eq.codigo}.`);
          return;
        }
      }

      if (eq.usa_odometro && odometroInicial !== null && odometroFinal !== null) {
        if (odometroFinal < odometroInicial) {
          setSaving(false);
          setMessage(`Odômetro final menor que o inicial em ${eq.codigo}.`);
          return;
        }
      }

      const status =
        (!eq.usa_horimetro || horimetroFinal !== null) &&
        (!eq.usa_odometro || odometroFinal !== null)
          ? "lancado"
          : "pendente";

      payload.push({
        data: selectedDate,
        obra_id: Number(selectedObraId),
        equipamento_id: eq.id,
        horimetro_inicial: horimetroInicial,
        horimetro_final: horimetroFinal,
        odometro_inicial: odometroInicial,
        odometro_final: odometroFinal,
        observacao: draft.observacao.trim() || null,
        status,
        updated_by_user_id: userId,
        updated_by_nome: userName,
      });
    }

    if (!payload.length) {
      setSaving(false);
      setMessage("Nada para salvar.");
      return;
    }

    const { error } = await supabase
      .from("horimetro_leituras_diarias")
      .upsert(payload, { onConflict: "data,equipamento_id" });

    if (error) {
      setSaving(false);
      setMessage(`Erro ao salvar: ${error.message}`);
      return;
    }

    setMessage("Leituras salvas com sucesso.");

    const ids = equipamentos.map((e) => e.id);

    const { data: currentData, error: reloadError } = await supabase
      .from("horimetro_leituras_diarias")
      .select(
        "id, data, obra_id, equipamento_id, horimetro_inicial, horimetro_final, horas_trabalhadas, odometro_inicial, odometro_final, km_rodados, observacao, status, updated_by_user_id, updated_by_nome, updated_at, created_at"
      )
      .eq("data", selectedDate)
      .in("equipamento_id", ids);

    if (!reloadError) {
      const currentMap: Record<number, LeituraRow> = {};
      for (const row of (currentData || []) as LeituraRow[]) {
        currentMap[row.equipamento_id] = row;
      }
      setCurrentRows(currentMap);
    }

    setSaving(false);
  }

  const totalLancados = useMemo(() => {
    return equipamentos.filter((eq) => currentRows[eq.id]?.status === "lancado").length;
  }, [equipamentos, currentRows]);

  const totalPendentes = useMemo(() => {
    return equipamentos.length - totalLancados;
  }, [equipamentos.length, totalLancados]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-[1800px] p-3 md:p-4">
        <div className="mb-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Horímetros / Odômetros</h1>
              <p className="mt-1 text-sm text-neutral-500">
                1 linha por equipamento. Obra selecionada no topo vale para o salvamento do dia.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:w-auto">
              <label className="flex min-w-[240px] flex-col gap-1 text-sm">
                <span className="text-neutral-600">Obra</span>
                <select
                  className="h-10 rounded-xl border border-neutral-300 bg-white px-3 outline-none focus:border-neutral-500"
                  value={selectedObraId}
                  onChange={(e) => setSelectedObraId(e.target.value)}
                >
                  {obras.map((obra) => (
                    <option key={obra.id} value={obra.id}>
                      {obra.obra}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex min-w-[170px] flex-col gap-1 text-sm">
                <span className="text-neutral-600">Data</span>
                <input
                  type="date"
                  className="h-10 rounded-xl border border-neutral-300 bg-white px-3 outline-none focus:border-neutral-500"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </label>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={handleSaveAll}
                  disabled={saving || loadingBase || loadingRows}
                  className="h-10 w-full rounded-xl bg-neutral-900 px-4 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar tudo"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <div className="rounded-full bg-neutral-100 px-3 py-1">
              Equipamentos: <strong>{equipamentos.length}</strong>
            </div>
            <div className="rounded-full bg-neutral-100 px-3 py-1">
              Lançados: <strong>{totalLancados}</strong>
            </div>
            <div className="rounded-full bg-neutral-100 px-3 py-1">
              Pendentes: <strong>{totalPendentes}</strong>
            </div>
            <div className="rounded-full bg-neutral-100 px-3 py-1">
              H {previousDateLabel} → H {currentDateLabel}
            </div>
          </div>

          {message ? (
            <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
              {message}
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[1400px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-neutral-100">
                <tr className="border-b border-neutral-200">
                  <th className="sticky left-0 z-20 min-w-[120px] border-r border-neutral-200 bg-neutral-100 px-3 py-2 text-left font-semibold">
                    Equip.
                  </th>
                  <th className="min-w-[130px] px-3 py-2 text-right font-semibold">
                    H {previousDateLabel}
                  </th>
                  <th className="min-w-[140px] px-3 py-2 text-left font-semibold">
                    H {currentDateLabel}
                  </th>
                  <th className="min-w-[110px] px-3 py-2 text-right font-semibold">
                    Horas do dia
                  </th>
                  <th className="min-w-[130px] px-3 py-2 text-right font-semibold">
                    O {previousDateLabel}
                  </th>
                  <th className="min-w-[140px] px-3 py-2 text-left font-semibold">
                    O {currentDateLabel}
                  </th>
                  <th className="min-w-[100px] px-3 py-2 text-right font-semibold">
                    Km do dia
                  </th>
                  <th className="min-w-[240px] px-3 py-2 text-left font-semibold">
                    Atualizado em
                  </th>
                  <th className="min-w-[260px] px-3 py-2 text-left font-semibold">
                    Obs
                  </th>
                </tr>
              </thead>

              <tbody>
                {loadingBase || loadingRows ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-neutral-500">
                      Carregando...
                    </td>
                  </tr>
                ) : equipamentos.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-neutral-500">
                      Nenhum equipamento ativo encontrado.
                    </td>
                  </tr>
                ) : (
                  equipamentos.map((eq) => {
                    const current = currentRows[eq.id];
                    const draft = drafts[eq.id] || {
                      horimetro_final: "",
                      odometro_final: "",
                      observacao: "",
                    };

                    const hIni = getInitialHorimetro(eq);
                    const oIni = getInitialOdometro(eq);
                    const horas = getHorasDoDia(eq);
                    const km = getKmDoDia(eq);

                    return (
                      <tr key={eq.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                        <td className="sticky left-0 z-10 border-r border-neutral-200 bg-white px-3 py-2 font-semibold">
                          {eq.codigo}
                        </td>

                        <td className="px-3 py-2 text-right tabular-nums">
                          {eq.usa_horimetro ? format1(hIni) || "—" : "—"}
                        </td>

                        <td className="px-3 py-2">
                          {eq.usa_horimetro ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={draft.horimetro_final}
                              onChange={(e) =>
                                updateDraft(eq.id, "horimetro_final", onlyDecimalChars(e.target.value))
                              }
                              className="h-9 w-full rounded-lg border border-neutral-300 px-2 text-right tabular-nums outline-none focus:border-neutral-500"
                              placeholder={format1(hIni) || "0,0"}
                            />
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>

                        <td className="px-3 py-2 text-right tabular-nums">
                          {eq.usa_horimetro ? format1(horas) || "—" : "—"}
                        </td>

                        <td className="px-3 py-2 text-right tabular-nums">
                          {eq.usa_odometro ? format1(oIni) || "—" : "—"}
                        </td>

                        <td className="px-3 py-2">
                          {eq.usa_odometro ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={draft.odometro_final}
                              onChange={(e) =>
                                updateDraft(eq.id, "odometro_final", onlyDecimalChars(e.target.value))
                              }
                              className="h-9 w-full rounded-lg border border-neutral-300 px-2 text-right tabular-nums outline-none focus:border-neutral-500"
                              placeholder={format1(oIni) || "0,0"}
                            />
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>

                        <td className="px-3 py-2 text-right tabular-nums">
                          {eq.usa_odometro ? format1(km) || "—" : "—"}
                        </td>

                        <td className="px-3 py-2 text-xs text-neutral-600">
                          {current?.updated_at ? (
                            <>
                              <div>{formatUpdatedAt(current.updated_at)}</div>
                              <div className="text-neutral-400">{current.updated_by_nome || ""}</div>
                            </>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>

                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={draft.observacao}
                            onChange={(e) => updateDraft(eq.id, "observacao", e.target.value)}
                            className="h-9 w-full rounded-lg border border-neutral-300 px-2 outline-none focus:border-neutral-500"
                            placeholder="Observação"
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
