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

  const [currentRows, setCurrentRows] = useState<Record<number, LeituraRow>>({});
  const [previousRows, setPreviousRows] = useState<Record<number, LeituraRow>>({});
  const [drafts, setDrafts] = useState<Record<number, DraftRow>>({});

  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>("");

  const previousDate = useMemo(() => addDays(selectedDate, -1), [selectedDate]);
  const previousDateLabel = useMemo(() => formatDateBr(previousDate), [previousDate]);
  const currentDateLabel = useMemo(() => formatDateBr(selectedDate), [selectedDate]);

  const obrasById = useMemo(() => {
    const map = new Map<number, string>();
    for (const o of obras) map.set(o.id, o.obra);
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

    const payload: Record<string, unknown>[] = [];

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
    setMessage("Leituras salvas com sucesso.");
  }

  const totalLancados = useMemo(() => {
    return equipamentos.filter((eq) => currentRows[eq.id]?.status === "lancado").length;
  }, [equipamentos, currentRows]);

  const totalPendentes = useMemo(() => {
    return equipamentos.length - totalLancados;
  }, [equipamentos.length, totalLancados]);

  return (
    <div className="page">
      <div className="hero">
        <div className="hero-left">
          <div className="brand">
            <div className="brand-mark">GP</div>
            <div>
              <div className="brand-title">GP Asfalto</div>
              <div className="brand-subtitle">Horímetros e Odômetros</div>
            </div>
          </div>

          <div className="hero-text">
            Lançamento diário por equipamento, com obra na própria linha e leitura anterior
            bloqueada.
          </div>
        </div>

        <div className="hero-right">
          <label className="field field-date">
            <span>Data do lançamento</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </label>

          <button
            type="button"
            onClick={handleSaveAll}
            disabled={saving || loadingBase || loadingRows}
            className="save-btn"
          >
            {saving ? "Salvando..." : "Salvar tudo"}
          </button>
        </div>
      </div>

      <div className="info-row">
        <div className="stat">
          <span className="stat-label">Equipamentos</span>
          <strong>{equipamentos.length}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Lançados</span>
          <strong>{totalLancados}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Pendentes</span>
          <strong>{totalPendentes}</strong>
        </div>
        <div className="stat stat-wide">
          <span className="stat-label">Período visível</span>
          <strong>
            {previousDateLabel} → {currentDateLabel}
          </strong>
        </div>
      </div>

      <div className="legend">
        <span className="legend-item">
          <span className="legend-box readonly-box" />
          Somente leitura
        </span>
        <span className="legend-item">
          <span className="legend-box editable-box" />
          Editável
        </span>
        <span className="legend-item">
          <span className="legend-box saved-box" />
          Já salvo no dia
        </span>
      </div>

      {message ? <div className="message">{message}</div> : null}

      <div className="table-shell">
        <div className="table-wrap">
          <table className="grid">
            <thead>
              <tr>
                <th className="sticky-col sticky-col-1">Equip.</th>
                <th className="sticky-col sticky-col-2">Obra</th>
                <th>Horímetro anterior<br />{previousDateLabel}</th>
                <th>Horímetro atual<br />{currentDateLabel}</th>
                <th>Horas do dia</th>
                <th>Odômetro anterior<br />{previousDateLabel}</th>
                <th>Odômetro atual<br />{currentDateLabel}</th>
                <th>Km do dia</th>
                <th>Última atualização</th>
                <th>Observação</th>
              </tr>
            </thead>

            <tbody>
              {loadingBase || loadingRows ? (
                <tr>
                  <td colSpan={10} className="empty">
                    Carregando...
                  </td>
                </tr>
              ) : equipamentos.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty">
                    Nenhum equipamento ativo encontrado.
                  </td>
                </tr>
              ) : (
                equipamentos.map((eq) => {
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
                  const isSaved = !!current?.updated_at;

                  return (
                    <tr key={eq.id} className={isSaved ? "row-saved" : ""}>
                      <td className="sticky-col sticky-col-1 cell-equip">{eq.codigo}</td>

                      <td className="sticky-col sticky-col-2">
                        <select
                          value={draft.obra_id}
                          onChange={(e) => updateDraft(eq.id, "obra_id", e.target.value)}
                          className="select-input"
                        >
                          <option value="">Selecione</option>
                          {obras.map((obra) => (
                            <option key={obra.id} value={obra.id}>
                              {obra.obra}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="readonly-cell num">
                        {eq.usa_horimetro ? format1(hIni) || "—" : "—"}
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
                            className="text-input num"
                            placeholder={format1(hIni) || "0,0"}
                          />
                        ) : (
                          <div className="readonly-cell empty-mini">—</div>
                        )}
                      </td>

                      <td className="readonly-cell num">
                        {eq.usa_horimetro ? format1(horas) || "—" : "—"}
                      </td>

                      <td className="readonly-cell num">
                        {eq.usa_odometro ? format1(oIni) || "—" : "—"}
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
                            className="text-input num"
                            placeholder={format1(oIni) || "0,0"}
                          />
                        ) : (
                          <div className="readonly-cell empty-mini">—</div>
                        )}
                      </td>

                      <td className="readonly-cell num">
                        {eq.usa_odometro ? format1(km) || "—" : "—"}
                      </td>

                      <td className="updated-cell">
                        {current?.updated_at ? (
                          <>
                            <div className="updated-date">{formatUpdatedAt(current.updated_at)}</div>
                            <div className="updated-user">{current.updated_by_nome || ""}</div>
                            <div className="updated-obra">
                              {obrasById.get(current.obra_id) || ""}
                            </div>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>

                      <td>
                        <input
                          type="text"
                          value={draft.observacao}
                          onChange={(e) => updateDraft(eq.id, "observacao", e.target.value)}
                          className="text-input"
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

      <style jsx>{`
        .page {
          min-height: 100vh;
          background:
            radial-gradient(circle at top right, rgba(245, 158, 11, 0.08), transparent 26%),
            linear-gradient(180deg, #0b1220 0px, #101826 180px, #f3f5f7 180px, #f3f5f7 100%);
          padding: 18px;
          color: #0f172a;
        }

        .hero {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: center;
          background: linear-gradient(135deg, #111827 0%, #1f2937 100%);
          border: 1px solid rgba(255, 255, 255, 0.06);
          color: #fff;
          border-radius: 20px;
          padding: 18px 20px;
          box-shadow: 0 16px 40px rgba(15, 23, 42, 0.24);
        }

        .hero-left {
          min-width: 0;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .brand-mark {
          width: 50px;
          height: 50px;
          border-radius: 14px;
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: #111827;
          font-weight: 900;
          letter-spacing: 0.04em;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
        }

        .brand-title {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: rgba(255, 255, 255, 0.72);
        }

        .brand-subtitle {
          font-size: 28px;
          font-weight: 800;
          line-height: 1.05;
          margin-top: 2px;
        }

        .hero-text {
          margin-top: 10px;
          max-width: 760px;
          color: rgba(255, 255, 255, 0.76);
          font-size: 14px;
        }

        .hero-right {
          display: flex;
          align-items: end;
          gap: 12px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field span {
          font-size: 12px;
          color: rgba(255, 255, 255, 0.76);
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .field input {
          height: 42px;
          min-width: 180px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
          padding: 0 12px;
          outline: none;
        }

        .save-btn {
          height: 42px;
          border: 0;
          border-radius: 12px;
          padding: 0 18px;
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: #111827;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 10px 22px rgba(245, 158, 11, 0.22);
        }

        .save-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .info-row {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 14px;
        }

        .stat {
          display: flex;
          align-items: center;
          gap: 10px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          padding: 12px 14px;
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
        }

        .stat-wide {
          min-width: 260px;
        }

        .stat-label {
          color: #64748b;
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .legend {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          margin-top: 14px;
          padding: 0 2px;
        }

        .legend-item {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #334155;
          font-weight: 600;
        }

        .legend-box {
          width: 16px;
          height: 16px;
          border-radius: 5px;
          border: 1px solid #cbd5e1;
        }

        .readonly-box {
          background: #e5e7eb;
        }

        .editable-box {
          background: #ffffff;
        }

        .saved-box {
          background: #ecfdf5;
          border-color: #86efac;
        }

        .message {
          margin-top: 14px;
          border-radius: 14px;
          padding: 12px 14px;
          background: #fff7ed;
          border: 1px solid #fdba74;
          color: #9a3412;
          font-weight: 700;
        }

        .table-shell {
          margin-top: 14px;
          background: #ffffff;
          border: 1px solid #dbe1e8;
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
        }

        .table-wrap {
          overflow: auto;
          max-height: calc(100vh - 270px);
        }

        .grid {
          width: 100%;
          min-width: 1700px;
          border-collapse: separate;
          border-spacing: 0;
          font-size: 13px;
        }

        .grid thead th {
          position: sticky;
          top: 0;
          z-index: 20;
          background: #0f172a;
          color: #fff;
          text-align: center;
          font-size: 12px;
          line-height: 1.2;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 11px 10px;
          border-bottom: 1px solid #1e293b;
          white-space: nowrap;
        }

        .grid tbody td {
          border-bottom: 1px solid #edf2f7;
          padding: 6px 8px;
          vertical-align: middle;
          background: #fff;
        }

        .grid tbody tr:hover td {
          background: #fafafa;
        }

        .row-saved td {
          background: #f6fff9;
        }

        .sticky-col {
          position: sticky;
          z-index: 10;
        }

        .sticky-col-1 {
          left: 0;
          min-width: 92px;
          max-width: 92px;
          background: inherit !important;
          border-right: 1px solid #e5e7eb;
        }

        .sticky-col-2 {
          left: 92px;
          min-width: 260px;
          max-width: 260px;
          background: inherit !important;
          border-right: 1px solid #e5e7eb;
        }

        .grid thead .sticky-col-1,
        .grid thead .sticky-col-2 {
          background: #0f172a !important;
        }

        .cell-equip {
          font-weight: 800;
          color: #0f172a;
        }

        .readonly-cell {
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 0 10px;
          background: #e5e7eb;
          border: 1px solid #d1d5db;
          border-radius: 10px;
          color: #111827;
          font-weight: 700;
        }

        .empty-mini {
          justify-content: center;
          color: #64748b;
        }

        .text-input,
        .select-input {
          width: 100%;
          height: 36px;
          border-radius: 10px;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #0f172a;
          outline: none;
          padding: 0 10px;
          font-size: 13px;
        }

        .text-input:focus,
        .select-input:focus {
          border-color: #f59e0b;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15);
        }

        .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .updated-cell {
          min-width: 210px;
          color: #334155;
          font-size: 12px;
          line-height: 1.25;
        }

        .updated-date {
          font-weight: 700;
          color: #0f172a;
        }

        .updated-user {
          color: #475569;
          margin-top: 2px;
        }

        .updated-obra {
          color: #64748b;
          margin-top: 2px;
        }

        .muted {
          color: #94a3b8;
        }

        .empty {
          text-align: center;
          padding: 28px 16px !important;
          color: #64748b;
        }

        @media (max-width: 980px) {
          .page {
            padding: 12px;
          }

          .hero {
            flex-direction: column;
            align-items: stretch;
          }

          .hero-right {
            justify-content: stretch;
          }

          .field-date,
          .save-btn {
            width: 100%;
          }

          .field input {
            min-width: 0;
            width: 100%;
          }

          .table-wrap {
            max-height: none;
          }
        }
      `}</style>
    </div>
  );
}
