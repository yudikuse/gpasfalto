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

function pad(n: number, size: number) {
  const s = String(n);
  return s.length >= size ? s : "0".repeat(size - s.length) + s;
}

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

    await supabase
      .from("horimetro_equipamentos")
      .upsert(obraPadraoUpdates, { onConflict: "id" });

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
          <section className="hero-card">
            <div className="hero-top">
              <div className="brand-wrap">
                <img src="/gpasfalto-logo.png" alt="GP Asfalto" className="brand-logo" />
                <div>
                  <div className="brand-kicker">GP ASFALTO</div>
                  <h1 className="hero-title">Horímetros e Odômetros</h1>
                  <p className="hero-subtitle">
                    Lançamento diário por equipamento. A obra fica na própria linha. A leitura
                    anterior é bloqueada e o sistema calcula horas e km automaticamente.
                  </p>
                </div>
              </div>

              <div className="hero-actions">
                <label className="field">
                  <span className="field-label">Data do lançamento</span>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="gp-input"
                  />
                </label>

                <button
                  type="button"
                  onClick={handleSaveAll}
                  disabled={saving || loadingBase || loadingRows}
                  className="primary-btn"
                >
                  {saving ? "Salvando..." : "Salvar tudo"}
                </button>
              </div>
            </div>

            <div className="stats-row">
              <div className="pill">
                Equipamentos <strong>{equipamentos.length}</strong>
              </div>
              <div className="pill">
                Lançados <strong>{totalLancados}</strong>
              </div>
              <div className="pill">
                Pendentes <strong>{totalPendentes}</strong>
              </div>
              <div className="pill pill-wide">
                Período visível <strong>{previousDateLabel} → {currentDateLabel}</strong>
              </div>
            </div>

            <div className="legend-row">
              <span className="legend-item">
                <span className="legend-box readonly" />
                leitura travada
              </span>
              <span className="legend-item">
                <span className="legend-box editable" />
                campo editável
              </span>
              <span className="legend-item">
                <span className="legend-box saved" />
                já salvo no dia
              </span>
            </div>
          </section>

          <section className="toolbar-card">
            <label className="field grow">
              <span className="field-label">Buscar equipamento</span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="gp-input"
                placeholder="Ex.: MN-05"
              />
            </label>

            <div className="toolbar-note">
              Anterior = leitura final do dia anterior. Se não existir, usa a base do cadastro.
            </div>
          </section>

          {message ? <div className="message-box">{message}</div> : null}

          <section className="list-section">
            {loadingBase || loadingRows ? (
              <div className="empty-card">Carregando...</div>
            ) : filteredEquipamentos.length === 0 ? (
              <div className="empty-card">Nenhum equipamento encontrado.</div>
            ) : (
              <div className="equipment-list">
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
                  const saved = !!current?.updated_at;

                  return (
                    <article
                      key={eq.id}
                      className={`equipment-card ${saved ? "equipment-card-saved" : ""}`}
                    >
                      <div className="equipment-header">
                        <div className="equipment-main">
                          <div className="equipment-code">{eq.codigo}</div>
                          {saved ? <span className="status-badge">Salvo no dia</span> : null}
                        </div>

                        <div className="equipment-meta">
                          {current?.updated_at ? (
                            <>
                              <span className="meta-strong">
                                {formatUpdatedAt(current.updated_at)}
                              </span>
                              <span>{current.updated_by_nome || "Usuário"}</span>
                              <span>{obrasById.get(current.obra_id) || ""}</span>
                            </>
                          ) : (
                            <span className="meta-muted">Ainda não salvo neste dia</span>
                          )}
                        </div>
                      </div>

                      <div className="equipment-grid">
                        <div className="field-block obra-col">
                          <span className="mini-label">Obra</span>
                          <select
                            value={draft.obra_id}
                            onChange={(e) => updateDraft(eq.id, "obra_id", e.target.value)}
                            className="gp-input"
                          >
                            <option value="">Selecione a obra</option>
                            {obras.map((obra) => (
                              <option key={obra.id} value={obra.id}>
                                {obra.obra}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="field-block">
                          <span className="mini-label">Horímetro anterior ({previousDateLabel})</span>
                          <div className="readonly-box-value">
                            {eq.usa_horimetro ? format1(hIni) || "—" : "—"}
                          </div>
                        </div>

                        <div className="field-block">
                          <span className="mini-label">Horímetro atual ({currentDateLabel})</span>
                          {eq.usa_horimetro ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={draft.horimetro_final}
                              onChange={(e) =>
                                updateDraft(eq.id, "horimetro_final", onlyDecimalChars(e.target.value))
                              }
                              className="gp-input number-input"
                              placeholder="Digite"
                            />
                          ) : (
                            <div className="readonly-box-value center">—</div>
                          )}
                        </div>

                        <div className="field-block small-result">
                          <span className="mini-label">Horas do dia</span>
                          <div className="result-box">
                            {eq.usa_horimetro ? format1(horas) || "—" : "—"}
                          </div>
                        </div>

                        <div className="field-block">
                          <span className="mini-label">Odômetro anterior ({previousDateLabel})</span>
                          <div className="readonly-box-value">
                            {eq.usa_odometro ? format1(oIni) || "—" : "—"}
                          </div>
                        </div>

                        <div className="field-block">
                          <span className="mini-label">Odômetro atual ({currentDateLabel})</span>
                          {eq.usa_odometro ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={draft.odometro_final}
                              onChange={(e) =>
                                updateDraft(eq.id, "odometro_final", onlyDecimalChars(e.target.value))
                              }
                              className="gp-input number-input"
                              placeholder="Digite"
                            />
                          ) : (
                            <div className="readonly-box-value center">—</div>
                          )}
                        </div>

                        <div className="field-block small-result">
                          <span className="mini-label">Km do dia</span>
                          <div className="result-box">
                            {eq.usa_odometro ? format1(km) || "—" : "—"}
                          </div>
                        </div>

                        <div className="field-block obs-col">
                          <span className="mini-label">Observação</span>
                          <input
                            type="text"
                            value={draft.observacao}
                            onChange={(e) => updateDraft(eq.id, "observacao", e.target.value)}
                            className="gp-input"
                            placeholder="Observação"
                          />
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="mobile-savebar">
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={saving || loadingBase || loadingRows}
            className="primary-btn mobile-save-btn"
          >
            {saving ? "Salvando..." : "Salvar tudo"}
          </button>
        </div>
      </main>

      <style jsx global>{`
        :root {
          --gp-bg: #f3f4f6;
          --gp-surface: #ffffff;
          --gp-border: #e5e7eb;
          --gp-text: #0f172a;
          --gp-muted: #475569;
          --gp-muted-soft: #64748b;
          --gp-primary: #0f172a;
          --gp-primary-2: #111827;
          --gp-accent: #f59e0b;
          --gp-accent-2: #d97706;
          --gp-soft: #f8fafc;
          --gp-soft-2: #eef2f7;
          --gp-readonly: #e5e7eb;
          --gp-readonly-border: #d1d5db;
          --gp-success-bg: #ecfdf5;
          --gp-success-border: #86efac;
          --gp-shadow: 0 16px 36px rgba(15, 23, 42, 0.07);
        }

        * {
          box-sizing: border-box;
        }

        body {
          background: radial-gradient(circle at top, #f9fafb 0, #f3f4f6 45%, #e5e7eb 100%);
        }

        .page-root {
          min-height: 100vh;
          padding: 24px 16px 92px;
        }

        .page-container {
          width: 100%;
          max-width: 1180px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .hero-card,
        .toolbar-card,
        .equipment-card,
        .empty-card {
          border-radius: 22px;
          background: var(--gp-surface);
          border: 1px solid var(--gp-border);
          box-shadow: var(--gp-shadow);
        }

        .hero-card {
          padding: 20px;
          background:
            linear-gradient(135deg, rgba(15, 23, 42, 0.98) 0%, rgba(17, 24, 39, 0.98) 55%, rgba(30, 41, 59, 0.98) 100%);
          color: #fff;
          border-color: rgba(255, 255, 255, 0.08);
        }

        .hero-top {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: flex-start;
        }

        .brand-wrap {
          display: flex;
          align-items: center;
          gap: 16px;
          min-width: 0;
        }

        .brand-logo {
          width: 82px;
          height: 82px;
          object-fit: contain;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.04);
          padding: 8px;
          flex-shrink: 0;
        }

        .brand-kicker {
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: rgba(255, 255, 255, 0.68);
          margin-bottom: 4px;
        }

        .hero-title {
          margin: 0;
          font-size: 34px;
          line-height: 1.05;
          font-weight: 900;
          letter-spacing: -0.03em;
        }

        .hero-subtitle {
          margin: 8px 0 0;
          max-width: 780px;
          color: rgba(255, 255, 255, 0.8);
          font-size: 14px;
          line-height: 1.5;
        }

        .hero-actions {
          display: flex;
          align-items: flex-end;
          gap: 12px;
          flex-wrap: wrap;
          min-width: 290px;
          justify-content: flex-end;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field.grow {
          flex: 1;
        }

        .field-label {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: inherit;
        }

        .gp-input {
          width: 100%;
          height: 44px;
          border-radius: 14px;
          border: 1px solid #cfd7e3;
          background: #fff;
          color: var(--gp-text);
          outline: none;
          padding: 0 14px;
          font-size: 14px;
          transition: 0.18s ease;
        }

        .gp-input:focus {
          border-color: #f59e0b;
          box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.14);
        }

        .hero-card .gp-input {
          background: rgba(255, 255, 255, 0.96);
        }

        .number-input {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .primary-btn {
          height: 44px;
          border: 0;
          border-radius: 14px;
          padding: 0 18px;
          background: linear-gradient(135deg, var(--gp-accent) 0%, var(--gp-accent-2) 100%);
          color: #111827;
          font-weight: 900;
          font-size: 14px;
          cursor: pointer;
          box-shadow: 0 12px 24px rgba(245, 158, 11, 0.22);
          transition: 0.18s ease;
          white-space: nowrap;
        }

        .primary-btn:hover {
          transform: translateY(-1px);
        }

        .primary-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
          transform: none;
        }

        .stats-row {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 16px;
        }

        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.96);
          color: var(--gp-muted);
          font-size: 12px;
          font-weight: 700;
          border: 1px solid rgba(255, 255, 255, 0.12);
        }

        .pill strong {
          color: var(--gp-text);
          font-size: 13px;
        }

        .pill-wide {
          min-width: 280px;
        }

        .legend-row {
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
          margin-top: 14px;
          color: rgba(255, 255, 255, 0.86);
          font-size: 12px;
          font-weight: 700;
        }

        .legend-item {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .legend-box {
          width: 15px;
          height: 15px;
          border-radius: 5px;
          border: 1px solid rgba(255, 255, 255, 0.3);
        }

        .legend-box.readonly {
          background: #d1d5db;
        }

        .legend-box.editable {
          background: #ffffff;
        }

        .legend-box.saved {
          background: #dcfce7;
          border-color: #86efac;
        }

        .toolbar-card {
          padding: 16px 18px;
          display: flex;
          align-items: flex-end;
          gap: 14px;
          justify-content: space-between;
        }

        .toolbar-note {
          font-size: 12px;
          color: var(--gp-muted-soft);
          font-weight: 700;
          line-height: 1.5;
          max-width: 430px;
        }

        .message-box {
          border-radius: 16px;
          border: 1px solid rgba(251, 146, 60, 0.35);
          background: rgba(255, 237, 213, 0.82);
          padding: 12px 14px;
          color: #9a3412;
          font-weight: 800;
          box-shadow: 0 12px 26px rgba(15, 23, 42, 0.06);
        }

        .list-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .equipment-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .equipment-card {
          padding: 16px;
        }

        .equipment-card-saved {
          background: linear-gradient(180deg, #ffffff 0%, #f8fffb 100%);
          border-color: #d3f4df;
        }

        .equipment-header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
          margin-bottom: 14px;
        }

        .equipment-main {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .equipment-code {
          font-size: 22px;
          line-height: 1;
          font-weight: 900;
          letter-spacing: -0.03em;
          color: var(--gp-text);
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          height: 28px;
          padding: 0 10px;
          border-radius: 999px;
          background: var(--gp-success-bg);
          border: 1px solid var(--gp-success-border);
          color: #166534;
          font-size: 12px;
          font-weight: 800;
        }

        .equipment-meta {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
          font-size: 12px;
          color: var(--gp-muted-soft);
          text-align: right;
        }

        .meta-strong {
          color: var(--gp-text);
          font-weight: 800;
        }

        .meta-muted {
          color: var(--gp-muted-soft);
          font-weight: 700;
        }

        .equipment-grid {
          display: grid;
          grid-template-columns: 1.35fr 1fr 1fr 0.72fr 1fr 1fr 0.72fr 1.25fr;
          gap: 12px;
          align-items: end;
        }

        .field-block {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }

        .obra-col {
          grid-column: span 1;
        }

        .obs-col {
          grid-column: span 1;
        }

        .small-result {
          min-width: 120px;
        }

        .mini-label {
          font-size: 11px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--gp-muted-soft);
        }

        .readonly-box-value,
        .result-box {
          height: 44px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 0 14px;
          font-size: 14px;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
        }

        .readonly-box-value {
          background: var(--gp-readonly);
          border: 1px solid var(--gp-readonly-border);
          color: #111827;
        }

        .result-box {
          background: #f8fafc;
          border: 1px solid #dbe3ee;
          color: #0f172a;
        }

        .center {
          justify-content: center;
          color: var(--gp-muted-soft);
        }

        .empty-card {
          padding: 24px;
          text-align: center;
          color: var(--gp-muted-soft);
          font-weight: 700;
        }

        .mobile-savebar {
          display: none;
        }

        @media (max-width: 1180px) {
          .equipment-grid {
            grid-template-columns: 1.2fr 1fr 1fr 0.75fr 1fr 1fr 0.75fr;
          }

          .obs-col {
            grid-column: 1 / -1;
          }
        }

        @media (max-width: 980px) {
          .page-root {
            padding: 14px 12px 92px;
          }

          .hero-top,
          .toolbar-card,
          .equipment-header {
            flex-direction: column;
            align-items: stretch;
          }

          .hero-actions {
            min-width: 0;
            width: 100%;
            justify-content: stretch;
          }

          .toolbar-note {
            max-width: none;
          }

          .equipment-meta {
            align-items: flex-start;
            text-align: left;
          }

          .equipment-grid {
            grid-template-columns: 1fr 1fr;
          }

          .obra-col,
          .obs-col {
            grid-column: 1 / -1;
          }

          .small-result {
            min-width: 0;
          }

          .hero-title {
            font-size: 28px;
          }

          .brand-logo {
            width: 70px;
            height: 70px;
          }
        }

        @media (max-width: 640px) {
          .page-root {
            padding: 10px 10px 96px;
          }

          .hero-card,
          .toolbar-card,
          .equipment-card {
            border-radius: 18px;
          }

          .hero-card {
            padding: 16px;
          }

          .toolbar-card,
          .equipment-card {
            padding: 14px;
          }

          .hero-title {
            font-size: 26px;
          }

          .hero-subtitle {
            font-size: 13px;
          }

          .equipment-code {
            font-size: 20px;
          }

          .equipment-grid {
            grid-template-columns: 1fr;
            gap: 10px;
          }

          .mobile-savebar {
            display: block;
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            padding: 10px 12px 14px;
            background: linear-gradient(180deg, rgba(243, 244, 246, 0) 0%, rgba(243, 244, 246, 0.95) 28%, rgba(243, 244, 246, 1) 100%);
            backdrop-filter: blur(8px);
            z-index: 40;
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
