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

function formatShortTime(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
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
      <main className="page-root">
        <div className="page-container">
          <header className="hero">
            <div className="logo">
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
            </div>

            <h1 className="title">Horímetros e Odômetros</h1>
            <div className="subtitle">
              Lançamento diário por equipamento. Leitura anterior bloqueada. Horas e km calculados automaticamente.
            </div>

            <div className="pill-row">
              <div className="pill">
                Equipamentos <strong>{equipamentos.length}</strong>
              </div>
              <div className="pill">
                Lançados <strong>{totalLancados}</strong>
              </div>
              <div className="pill">
                Pendentes <strong>{totalPendentes}</strong>
              </div>
            </div>
          </header>

          <section className="section-card">
            <div className="filters">
              <label className="field">
                <span className="label">Data</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="input"
                />
              </label>

              <label className="field search-col">
                <span className="label">Busca</span>
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
                  {previousDateLabel} — {currentDateLabel}
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

          <section className="section-card table-card desktop-only">
            {loadingBase || loadingRows ? (
              <div className="empty">Carregando...</div>
            ) : filteredEquipamentos.length === 0 ? (
              <div className="empty">Nenhum equipamento encontrado.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <colgroup>
                    <col style={{ width: "86px" }} />
                    <col style={{ width: "190px" }} />
                    <col style={{ width: "96px" }} />
                    <col style={{ width: "96px" }} />
                    <col style={{ width: "78px" }} />
                    <col style={{ width: "96px" }} />
                    <col style={{ width: "96px" }} />
                    <col style={{ width: "78px" }} />
                    <col style={{ width: "170px" }} />
                    <col style={{ width: "92px" }} />
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

                      const statusTitle = current?.updated_at
                        ? `${formatUpdatedAt(current.updated_at)} • ${current.updated_by_nome || ""} • ${
                            obrasById.get(current.obra_id) || ""
                          }`
                        : "Ainda não salvo neste dia";

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
                            <div className="readonly num">{eq.usa_horimetro ? format1(hIni) || "—" : "—"}</div>
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
                                className="input input-sm num editable"
                                placeholder="Digite"
                              />
                            ) : (
                              <div className="readonly center">—</div>
                            )}
                          </td>

                          <td>
                            <div className="readonly num">{eq.usa_horimetro ? format1(horas) || "—" : "—"}</div>
                          </td>

                          <td>
                            <div className="readonly num">{eq.usa_odometro ? format1(oIni) || "—" : "—"}</div>
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
                                className="input input-sm num editable"
                                placeholder="Digite"
                              />
                            ) : (
                              <div className="readonly center">—</div>
                            )}
                          </td>

                          <td>
                            <div className="readonly num">{eq.usa_odometro ? format1(km) || "—" : "—"}</div>
                          </td>

                          <td>
                            <input
                              type="text"
                              value={draft.observacao}
                              onChange={(e) => updateDraft(eq.id, "observacao", e.target.value)}
                              className="input input-sm editable"
                              placeholder="Observação"
                            />
                          </td>

                          <td>
                            <div className="status-cell" title={statusTitle}>
                              {current?.updated_at ? (
                                <span className="status-badge ok">salvo {formatShortTime(current.updated_at)}</span>
                              ) : (
                                <span className="status-badge late">pendente</span>
                              )}
                            </div>
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
                      {current?.updated_at ? (
                        <span className="status-badge ok">salvo {formatShortTime(current.updated_at)}</span>
                      ) : (
                        <span className="status-badge late">pendente</span>
                      )}
                    </div>

                    <div className="mobile-grid">
                      <label className="field full">
                        <span className="label">Obra</span>
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
                        <span className="label">H anterior</span>
                        <div className="readonly num">{eq.usa_horimetro ? format1(hIni) || "—" : "—"}</div>
                      </div>

                      <label className="field">
                        <span className="label">H atual</span>
                        {eq.usa_horimetro ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.horimetro_final}
                            onChange={(e) =>
                              updateDraft(eq.id, "horimetro_final", onlyDecimalChars(e.target.value))
                            }
                            className="input num editable"
                            placeholder="Digite"
                          />
                        ) : (
                          <div className="readonly center">—</div>
                        )}
                      </label>

                      <div className="field">
                        <span className="label">Horas</span>
                        <div className="readonly num">{eq.usa_horimetro ? format1(horas) || "—" : "—"}</div>
                      </div>

                      <div className="field">
                        <span className="label">O anterior</span>
                        <div className="readonly num">{eq.usa_odometro ? format1(oIni) || "—" : "—"}</div>
                      </div>

                      <label className="field">
                        <span className="label">O atual</span>
                        {eq.usa_odometro ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={draft.odometro_final}
                            onChange={(e) =>
                              updateDraft(eq.id, "odometro_final", onlyDecimalChars(e.target.value))
                            }
                            className="input num editable"
                            placeholder="Digite"
                          />
                        ) : (
                          <div className="readonly center">—</div>
                        )}
                      </label>

                      <div className="field">
                        <span className="label">Km</span>
                        <div className="readonly num">{eq.usa_odometro ? format1(km) || "—" : "—"}</div>
                      </div>

                      <label className="field full">
                        <span className="label">Observação</span>
                        <input
                          type="text"
                          value={draft.observacao}
                          onChange={(e) => updateDraft(eq.id, "observacao", e.target.value)}
                          className="input editable"
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

        <div className="mobile-savebar mobile-only">
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
          --bg: #f6f7f9;
          --panel: rgba(255, 255, 255, 0.9);
          --text: #0f172a;
          --muted: #667085;
          --soft-line: rgba(15, 23, 42, 0.06);
          --soft-line-2: rgba(15, 23, 42, 0.04);
          --navy: #081a44;
          --navy-2: #122a63;
          --chip: #ffffff;
          --readonly-bg: #eef2f6;
          --readonly-text: #111827;
          --editable-bg: #fafbfc;
          --save-red: #c81e1e;
          --save-red-bg: #fff1f2;
          --save-green: #0f766e;
          --save-green-bg: #ecfdf5;
        }

        * {
          box-sizing: border-box;
        }

        body {
          background: radial-gradient(circle at top, #fbfbfc 0, #f5f6f8 45%, #eceff3 100%);
          color: var(--text);
        }

        .page-root {
          min-height: 100vh;
          padding: 28px 16px 88px;
        }

        .page-container {
          width: 100%;
          max-width: 1140px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .hero {
          text-align: center;
          padding-top: 4px;
        }

        .logo {
          display: flex;
          justify-content: center;
          margin-bottom: 12px;
        }

        .logo img {
          height: 156px;
          width: auto;
          object-fit: contain;
          filter: drop-shadow(0 8px 22px rgba(15, 23, 42, 0.08));
        }

        .title {
          margin: 0;
          font-size: 34px;
          font-weight: 800;
          letter-spacing: -0.03em;
          color: var(--text);
        }

        .subtitle {
          margin-top: 8px;
          font-size: 13px;
          color: var(--muted);
        }

        .pill-row {
          margin-top: 14px;
          display: flex;
          justify-content: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.82);
          backdrop-filter: blur(10px);
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
          font-size: 12px;
          color: var(--muted);
        }

        .pill strong {
          color: var(--text);
        }

        .section-card {
          border-radius: 22px;
          background: var(--panel);
          backdrop-filter: blur(14px);
          box-shadow:
            0 1px 2px rgba(16, 24, 40, 0.03),
            0 14px 40px rgba(16, 24, 40, 0.04);
        }

        .filters {
          padding: 16px;
        }

        .filters .filters {
          padding: 0;
        }

        .filters .field,
        .mobile-grid .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .label {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #475467;
        }

        .filters > .filters,
        .filters-grid {
          display: grid;
          grid-template-columns: 170px minmax(220px, 1fr) 220px 150px;
          gap: 12px;
          align-items: end;
        }

        .field.search-col {
          min-width: 0;
        }

        .input {
          width: 100%;
          height: 44px;
          border: 0;
          border-radius: 14px;
          background: #ffffff;
          box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);
          padding: 0 14px;
          font-size: 14px;
          color: var(--text);
          outline: none;
          transition: 0.18s ease;
        }

        .input:focus {
          box-shadow:
            inset 0 0 0 1px rgba(8, 26, 68, 0.18),
            0 0 0 4px rgba(8, 26, 68, 0.06);
          background: #ffffff;
        }

        .input-sm {
          height: 38px;
          font-size: 13px;
          padding: 0 12px;
          border-radius: 12px;
        }

        .editable {
          background: var(--editable-bg);
          box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.07);
        }

        .editable::placeholder {
          color: #98a2b3;
        }

        .readonly {
          height: 38px;
          border-radius: 12px;
          background: var(--readonly-bg);
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 0 12px;
          font-size: 13px;
          font-weight: 700;
          color: var(--readonly-text);
          font-variant-numeric: tabular-nums;
        }

        .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .center {
          justify-content: center;
        }

        .period-box {
          height: 44px;
          border-radius: 14px;
          background: #f2f5f8;
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 0 14px;
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
          height: 44px;
          border: 0;
          border-radius: 14px;
          background: linear-gradient(180deg, var(--navy) 0%, var(--navy-2) 100%);
          color: #fff;
          font-weight: 800;
          font-size: 14px;
          cursor: pointer;
          padding: 0 18px;
          box-shadow: 0 10px 22px rgba(8, 26, 68, 0.16);
        }

        .save-btn:hover {
          filter: brightness(1.04);
        }

        .save-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .message {
          background: rgba(255, 237, 213, 0.82);
          color: #9a3412;
          border-radius: 16px;
          padding: 12px 14px;
          font-size: 13px;
          font-weight: 700;
          box-shadow: 0 10px 22px rgba(15, 23, 42, 0.04);
        }

        .table-card {
          padding: 0;
          overflow: hidden;
        }

        .table-wrap {
          overflow-x: auto;
        }

        table {
          width: 100%;
          min-width: 1060px;
          border-collapse: collapse;
          font-size: 13px;
        }

        thead th {
          text-align: left;
          color: #475467;
          padding: 14px 10px;
          white-space: nowrap;
          font-weight: 800;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          background: rgba(255, 255, 255, 0.72);
        }

        tbody td {
          padding: 9px 10px;
          vertical-align: middle;
          background: transparent;
        }

        tbody tr {
          box-shadow: inset 0 -1px 0 var(--soft-line-2);
        }

        tbody tr:hover {
          background: rgba(255, 255, 255, 0.36);
        }

        .equip-col {
          font-weight: 800;
          color: var(--navy);
          white-space: nowrap;
        }

        .status-cell {
          display: flex;
          align-items: center;
          justify-content: flex-start;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 72px;
          height: 26px;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 800;
          line-height: 1;
          letter-spacing: 0.01em;
          white-space: nowrap;
        }

        .status-badge.ok {
          background: var(--save-green-bg);
          color: var(--save-green);
        }

        .status-badge.late {
          background: var(--save-red-bg);
          color: var(--save-red);
        }

        .empty {
          padding: 28px;
          text-align: center;
          color: var(--muted);
          font-weight: 700;
        }

        .mobile-only {
          display: none;
        }

        .mobile-savebar {
          display: none;
        }

        .mobile-list {
          flex-direction: column;
          gap: 10px;
        }

        .mobile-card {
          background: rgba(255, 255, 255, 0.88);
          backdrop-filter: blur(14px);
          border-radius: 18px;
          padding: 12px;
          box-shadow:
            0 1px 2px rgba(16, 24, 40, 0.03),
            0 10px 24px rgba(16, 24, 40, 0.04);
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

        .mobile-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .mobile-grid .full {
          grid-column: 1 / -1;
        }

        @media (max-width: 980px) {
          .filters-grid {
            grid-template-columns: 1fr 1fr;
          }

          .period-box {
            order: 3;
          }
        }

        @media (max-width: 760px) {
          .page-root {
            padding: 16px 10px 92px;
          }

          .logo img {
            height: 124px;
          }

          .title {
            font-size: 28px;
          }

          .subtitle {
            font-size: 12px;
            max-width: 92%;
            margin-left: auto;
            margin-right: auto;
          }

          .filters-grid {
            grid-template-columns: 1fr;
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
              rgba(246, 247, 249, 0) 0%,
              rgba(246, 247, 249, 0.95) 24%,
              rgba(246, 247, 249, 1) 100%
            );
            z-index: 20;
          }

          .mobile-save-btn {
            width: 100%;
            height: 48px;
            border-radius: 16px;
          }
        }
      `}</style>
    </>
  );
}
