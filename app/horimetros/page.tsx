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

function parseFlexibleNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let s = String(value).trim();
  if (!s) return null;

  s = s.replace(/\s/g, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    s = s.replace(",", ".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDecimalInput(text: string): number | null {
  return parseFlexibleNumber(text);
}

function format1(v: unknown) {
  const n = parseFlexibleNumber(v);
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
  const [selectedDate, setSelectedDate] = useState<string>(toInputDate());
  const [search, setSearch] = useState("");

  const [currentRows, setCurrentRows] = useState<Record<number, LeituraRow>>({});
  const [previousRows, setPreviousRows] = useState<Record<number, LeituraRow>>({});
  const [drafts, setDrafts] = useState<Record<number, DraftRow>>({});

  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(false);
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
        obra_id: prev[equipamentoId]?.obra_id || "",
        horimetro_final: prev[equipamentoId]?.horimetro_final || "",
        odometro_final: prev[equipamentoId]?.odometro_final || "",
        observacao: prev[equipamentoId]?.observacao || "",
        [field]: value,
      },
    }));
  }

  async function reloadCurrentDay() {
    const ids = equipamentos.map((e) => e.id);

    const { data, error } = await supabase
      .from("horimetro_leituras_diarias")
      .select(
        "id, data, obra_id, equipamento_id, horimetro_inicial, horimetro_final, horas_trabalhadas, odometro_inicial, odometro_final, km_rodados, observacao, status, updated_by_user_id, updated_by_nome, updated_at, created_at"
      )
      .eq("data", selectedDate)
      .in("equipamento_id", ids);

    if (!error) {
      const currentMap: Record<number, LeituraRow> = {};
      for (const row of (data || []) as LeituraRow[]) {
        currentMap[row.equipamento_id] = row;
      }
      setCurrentRows(currentMap);
    }
  }

  async function handleSaveAll() {
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

    const payload: SavePayload[] = [];

    for (const eq of equipamentos) {
      const draft = drafts[eq.id] || {
        obra_id: "",
        horimetro_final: "",
        odometro_final: "",
        observacao: "",
      };

      const obraId = Number(draft.obra_id);
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

      if (!obraId) {
        setSaving(false);
        setMessage(`Selecione a obra em ${eq.codigo}.`);
        return;
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
        obra_id: obraId,
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

    const obraPadraoUpdates = payload.map((p) => ({
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

    await reloadCurrentDay();

    setSaving(false);
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
      <main className="page">
        <div className="container">
          <header className="page-head">
            <img src="/gpasfalto-logo.png" alt="GP Asfalto" className="logo" />
            <h1>Horímetros e Odômetros</h1>
            <p>
              Lançamento diário por equipamento. Leitura anterior bloqueada. Horas e km calculados automaticamente.
            </p>

            <div className="head-pills">
              <span>{equipamentos.length} equipamentos</span>
              <span>{totalLancados} lançados</span>
              <span>{totalPendentes} pendentes</span>
            </div>
          </header>

          <section className="panel filters">
            <div className="filters-grid">
              <label className="field date-field">
                <span>Data</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="input"
                />
              </label>

              <label className="field search-field">
                <span>Busca</span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="input"
                  placeholder="MN-05"
                />
              </label>

              <div className="period-box">
                <span>Período</span>
                <strong>
                  {previousDateLabel} → {currentDateLabel}
                </strong>
              </div>

              <button
                type="button"
                onClick={handleSaveAll}
                disabled={saving || loadingBase || loadingRows}
                className="save-btn"
              >
                {saving ? "Salvando..." : "Salvar tudo"}
              </button>
            </div>
          </section>

          {message ? <div className="message">{message}</div> : null}

          <section className="panel desktop-table-wrap">
            {loadingBase || loadingRows ? (
              <div className="empty">Carregando...</div>
            ) : filteredEquipamentos.length === 0 ? (
              <div className="empty">Nenhum equipamento encontrado.</div>
            ) : (
              <div className="table-scroll">
                <table className="table">
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
                      <th>Atualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEquipamentos.map((eq) => {
                      const current = currentRows[eq.id];
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

                      return (
                        <tr key={eq.id}>
                          <td className="equip-col">{eq.codigo}</td>

                          <td>
                            <select
                              value={draft.obra_id}
                              onChange={(e) => updateDraft(eq.id, "obra_id", e.target.value)}
                              className="input input-sm"
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
                            <div className="readonly">{eq.usa_horimetro ? format1(hIni) || "—" : "—"}</div>
                          </td>

                          <td>
                            {eq.usa_horimetro ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={draft.horimetro_final}
                                onChange={(e) =>
                                  updateDraft(eq.id, "horimetro_final", onlyDecimalChars(e.target.value))
                                }
                                className="input input-sm num"
                                placeholder="Digite"
                              />
                            ) : (
                              <div className="readonly center">—</div>
                            )}
                          </td>

                          <td>
                            <div className="readonly">{eq.usa_horimetro ? format1(horas) || "—" : "—"}</div>
                          </td>

                          <td>
                            <div className="readonly">{eq.usa_odometro ? format1(oIni) || "—" : "—"}</div>
                          </td>

                          <td>
                            {eq.usa_odometro ? (
                              <input
                                type="text"
                                inputMode="decimal"
                                value={draft.odometro_final}
                                onChange={(e) =>
                                  updateDraft(eq.id, "odometro_final", onlyDecimalChars(e.target.value))
                                }
                                className="input input-sm num"
                                placeholder="Digite"
                              />
                            ) : (
                              <div className="readonly center">—</div>
                            )}
                          </td>

                          <td>
                            <div className="readonly">{eq.usa_odometro ? format1(km) || "—" : "—"}</div>
                          </td>

                          <td>
                            <input
                              type="text"
                              value={draft.observacao}
                              onChange={(e) => updateDraft(eq.id, "observacao", e.target.value)}
                              className="input input-sm"
                              placeholder="Observação"
                            />
                          </td>

                          <td className="updated-col">
                            {current?.updated_at ? (
                              <>
                                <div className="updated-main">{formatUpdatedAt(current.updated_at)}</div>
                                <div className="updated-sub">{current.updated_by_nome || ""}</div>
                                <div className="updated-sub">{obrasById.get(current.obra_id) || ""}</div>
                              </>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mobile-list">
            {loadingBase || loadingRows ? (
              <div className="empty">Carregando...</div>
            ) : filteredEquipamentos.length === 0 ? (
              <div className="empty">Nenhum equipamento encontrado.</div>
            ) : (
              filteredEquipamentos.map((eq) => {
                const current = currentRows[eq.id];
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

                return (
                  <article key={eq.id} className="mobile-card">
                    <div className="mobile-top">
                      <strong>{eq.codigo}</strong>
                      <span className="mobile-status">
                        {current?.updated_at ? "Salvo" : "Pendente"}
                      </span>
                    </div>

                    <div className="mobile-grid">
                      <label className="field full">
                        <span>Obra</span>
                        <select
                          value={draft.obra_id}
                          onChange={(e) => updateDraft(eq.id, "obra_id", e.target.value)}
                          className="input"
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
                        <span>H anterior</span>
                        <div className="readonly">{eq.usa_horimetro ? format1(hIni) || "—" : "—"}</div>
                      </div>

                      <label className="field">
                        <span>H atual</span>
                        {eq.usa_horimetro ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.horimetro_final}
                            onChange={(e) =>
                              updateDraft(eq.id, "horimetro_final", onlyDecimalChars(e.target.value))
                            }
                            className="input num"
                            placeholder="Digite"
                          />
                        ) : (
                          <div className="readonly center">—</div>
                        )}
                      </label>

                      <div className="field">
                        <span>Horas</span>
                        <div className="readonly">{eq.usa_horimetro ? format1(horas) || "—" : "—"}</div>
                      </div>

                      <div className="field">
                        <span>O anterior</span>
                        <div className="readonly">{eq.usa_odometro ? format1(oIni) || "—" : "—"}</div>
                      </div>

                      <label className="field">
                        <span>O atual</span>
                        {eq.usa_odometro ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.odometro_final}
                            onChange={(e) =>
                              updateDraft(eq.id, "odometro_final", onlyDecimalChars(e.target.value))
                            }
                            className="input num"
                            placeholder="Digite"
                          />
                        ) : (
                          <div className="readonly center">—</div>
                        )}
                      </label>

                      <div className="field">
                        <span>Km</span>
                        <div className="readonly">{eq.usa_odometro ? format1(km) || "—" : "—"}</div>
                      </div>

                      <label className="field full">
                        <span>Observação</span>
                        <input
                          type="text"
                          value={draft.observacao}
                          onChange={(e) => updateDraft(eq.id, "observacao", e.target.value)}
                          className="input"
                          placeholder="Observação"
                        />
                      </label>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </div>

        <div className="mobile-savebar">
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={saving || loadingBase || loadingRows}
            className="save-btn mobile-save-btn"
          >
            {saving ? "Salvando..." : "Salvar tudo"}
          </button>
        </div>
      </main>

      <style jsx global>{`
        :root {
          --bg: #f4f5f7;
          --panel: #ffffff;
          --line: #e5e7eb;
          --text: #0f172a;
          --muted: #667085;
          --navy: #0b1733;
          --navy-2: #142445;
          --accent: #f59e0b;
          --soft: #f8fafc;
          --readonly: #eef2f6;
        }

        * {
          box-sizing: border-box;
        }

        body {
          background: var(--bg);
          color: var(--text);
        }

        .page {
          min-height: 100vh;
          padding: 28px 16px 88px;
        }

        .container {
          max-width: 1120px;
          margin: 0 auto;
        }

        .page-head {
          text-align: center;
          margin-bottom: 18px;
        }

        .logo {
          width: 54px;
          height: auto;
          object-fit: contain;
          margin: 0 auto 12px;
          display: block;
        }

        .page-head h1 {
          margin: 0;
          font-size: 26px;
          line-height: 1.1;
          font-weight: 800;
          letter-spacing: -0.02em;
        }

        .page-head p {
          margin: 10px auto 0;
          max-width: 720px;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.5;
        }

        .head-pills {
          display: flex;
          justify-content: center;
          gap: 10px;
          flex-wrap: wrap;
          margin-top: 14px;
        }

        .head-pills span {
          background: #fff;
          border: 1px solid var(--line);
          border-radius: 999px;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 700;
          color: var(--muted);
        }

        .panel {
          background: var(--panel);
          border-radius: 20px;
          box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 10px 24px rgba(16, 24, 40, 0.04);
        }

        .filters {
          padding: 16px;
          margin-bottom: 14px;
        }

        .filters-grid {
          display: grid;
          grid-template-columns: 170px minmax(220px, 1fr) 240px 160px;
          gap: 12px;
          align-items: end;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }

        .field span {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #475467;
        }

        .input {
          width: 100%;
          height: 42px;
          border-radius: 12px;
          border: 1px solid #d0d5dd;
          background: #fff;
          padding: 0 12px;
          font-size: 14px;
          color: var(--text);
          outline: none;
        }

        .input:focus {
          border-color: #94a3b8;
          box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.12);
        }

        .input-sm {
          height: 38px;
          font-size: 13px;
        }

        .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .period-box {
          height: 42px;
          border-radius: 12px;
          background: #f8fafc;
          border: 1px solid var(--line);
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 0 12px;
        }

        .period-box span {
          font-size: 11px;
          text-transform: uppercase;
          font-weight: 800;
          letter-spacing: 0.05em;
          color: #475467;
        }

        .period-box strong {
          font-size: 13px;
          color: var(--text);
          margin-top: 2px;
        }

        .save-btn {
          height: 42px;
          border: 0;
          border-radius: 12px;
          background: var(--navy);
          color: #fff;
          font-weight: 800;
          font-size: 14px;
          cursor: pointer;
          padding: 0 18px;
        }

        .save-btn:hover {
          background: var(--navy-2);
        }

        .save-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .message {
          margin-bottom: 14px;
          background: #fff7ed;
          color: #9a3412;
          border: 1px solid #fdba74;
          border-radius: 14px;
          padding: 12px 14px;
          font-size: 13px;
          font-weight: 700;
        }

        .desktop-table-wrap {
          display: block;
          padding: 0;
          overflow: hidden;
        }

        .table-scroll {
          overflow-x: auto;
        }

        .table {
          width: 100%;
          min-width: 1080px;
          border-collapse: collapse;
        }

        .table thead th {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 800;
          color: #475467;
          text-align: left;
          padding: 14px 12px;
          border-bottom: 1px solid var(--line);
          background: #fff;
          position: sticky;
          top: 0;
          z-index: 2;
          white-space: nowrap;
        }

        .table tbody td {
          padding: 10px 12px;
          border-bottom: 1px solid #f0f2f5;
          vertical-align: middle;
          background: #fff;
        }

        .table tbody tr:hover td {
          background: #fafbfc;
        }

        .equip-col {
          font-weight: 800;
          color: var(--navy);
          white-space: nowrap;
        }

        .readonly {
          height: 38px;
          border-radius: 12px;
          background: var(--readonly);
          border: 1px solid #d8dee6;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 0 12px;
          font-size: 13px;
          font-weight: 700;
          color: var(--text);
          font-variant-numeric: tabular-nums;
        }

        .center {
          justify-content: center;
        }

        .updated-col {
          min-width: 190px;
          font-size: 12px;
          line-height: 1.35;
        }

        .updated-main {
          color: var(--text);
          font-weight: 700;
        }

        .updated-sub {
          color: var(--muted);
          margin-top: 2px;
        }

        .muted {
          color: #98a2b3;
        }

        .empty {
          padding: 26px;
          text-align: center;
          color: var(--muted);
          font-weight: 700;
        }

        .mobile-list {
          display: none;
        }

        .mobile-savebar {
          display: none;
        }

        @media (max-width: 920px) {
          .filters-grid {
            grid-template-columns: 1fr 1fr;
          }

          .period-box {
            order: 3;
          }
        }

        @media (max-width: 760px) {
          .page {
            padding: 16px 10px 92px;
          }

          .page-head {
            margin-bottom: 14px;
          }

          .page-head h1 {
            font-size: 23px;
          }

          .page-head p {
            font-size: 12px;
          }

          .filters {
            padding: 12px;
          }

          .filters-grid {
            grid-template-columns: 1fr;
          }

          .desktop-table-wrap {
            display: none;
          }

          .mobile-list {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }

          .mobile-card {
            background: #fff;
            border-radius: 16px;
            padding: 12px;
            box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 8px 20px rgba(16, 24, 40, 0.04);
          }

          .mobile-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 10px;
          }

          .mobile-top strong {
            font-size: 20px;
            color: var(--navy);
          }

          .mobile-status {
            font-size: 11px;
            font-weight: 800;
            color: var(--muted);
          }

          .mobile-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
          }

          .mobile-grid .full {
            grid-column: 1 / -1;
          }

          .mobile-savebar {
            display: block;
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            padding: 10px 12px 14px;
            background: linear-gradient(180deg, rgba(244,245,247,0) 0%, rgba(244,245,247,0.94) 24%, rgba(244,245,247,1) 100%);
            z-index: 20;
          }

          .mobile-save-btn {
            width: 100%;
            height: 48px;
            border-radius: 14px;
          }
        }
      `}</style>
    </>
  );
}
