// FILE: app/equipamentos/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type TipoFiltro =
  | "TODOS"
  | "MANUTENCAO"
  | "COMPRA"
  | "PECAS"
  | "SERVICOS"
  | "ABASTECIMENTO"
  | "OUTRO";

type RawStageRow = {
  id: number;
  date: string | null; // "03/12/2025"
  time: string | null; // "12:29:49"
  mes_ano: string | null; // "2025-12"
  tipo_registro: string | null;
  numero_oc: string | null;
  codigo_equipamento: string | null;
  obra: string | null;
  solicitante: string | null;
  operador: string | null;
  horimetro: string | null;
  local_entrega: string | null;
  valor_menor: number | null;
  texto_original: string | null;
  fornecedor_1: string | null;
  fornecedor_2: string | null;
  fornecedor_3: string | null;
  preco_1: number | null;
  preco_2: number | null;
  preco_3: number | null;
  fornecedor_vencedor: string | null;
};

type ItemRow = {
  id: number;
  ordem_id: number;
  descricao: string | null;
  quantidade_texto: string | null;
  quantidade_num: number | null;
};

type JoinedRow = {
  ordem_id: number;
  oc: string | null;
  tipo_registro: string | null;
  data: string | null;
  hora: string | null;
  mes_ano: string | null;

  equipamento_raw: string | null;
  equipamento_norm: string;
  equipamento_display: string;

  obra: string | null;
  operador: string | null;

  fornecedor: string | null; // vencedor > fornecedor_1 > ...
  valor_oc: number | null; // TOTAL da OC (sem rateio por peça)

  item_descricao: string | null;
  item_qtd_num: number | null;
  item_qtd_txt: string | null;

  texto_original: string | null;
};

function resolvePublicSupabase(): { url: string; key: string; ok: boolean } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishable =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const key = publishable || anon;
  return { url, key, ok: Boolean(url && key) };
}

function onlyDigits(s: string) {
  return (s || "").replace(/[^\d]/g, "");
}

// Normaliza: remove espaços, remove "-", upper, separa letras+números
// Ex: "mn07" -> "MN07"; "MN-07" -> "MN07"; "RC-04" -> "RC04"
function normalizeEquip(input: string | null | undefined): string {
  const s = String(input || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-/g, "");
  return s;
}

// Canoniza para exibição: "MN07" -> "MN-07", "RC04" -> "RC-04"
// Se não bater no padrão, retorna o original normalizado.
function canonicalDisplay(norm: string): string {
  const m = norm.match(/^([A-Z]{1,4})(\d{1,4})$/);
  if (!m) return norm;
  const letters = m[1];
  const nums = m[2].padStart(2, "0");
  return `${letters}-${nums}`;
}

function tipoFromRegistro(tipo_registro: string | null): TipoFiltro {
  const t = (tipo_registro || "").toUpperCase();
  if (t.includes("ABASTEC")) return "ABASTECIMENTO";
  if (t.includes("MANUT")) return "MANUTENCAO";
  if (t.includes("PECAS")) return "PECAS";
  if (t.includes("SERV")) return "SERVICOS";
  if (t.includes("COMPRA")) return "COMPRA";
  return "OUTRO";
}

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function parseBrDateToSortable(d: string | null): number {
  // "03/12/2025" -> 20251203
  if (!d) return 0;
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return 0;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yyyy))
    return 0;
  return yyyy * 10000 + mm * 100 + dd;
}

export default function EquipamentosComprasPage() {
  // Supabase (NUNCA no escopo global)
  const supabase: SupabaseClient | null = useMemo(() => {
    const env = resolvePublicSupabase();
    if (!env.ok) return null;
    return createClient(env.url, env.key);
  }, []);

  const env = resolvePublicSupabase();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Equipamentos válidos (somente da equipment_hours_2025)
  const [equipList, setEquipList] = useState<string[]>([]); // display
  const [equipNormSet, setEquipNormSet] = useState<Set<string>>(new Set()); // norm

  // filtros
  const [equipamento, setEquipamento] = useState<string>(""); // display selecionado
  const [tipo, setTipo] = useState<TipoFiltro>("MANUTENCAO");
  const [de, setDe] = useState<string>("2025-01");
  const [ate, setAte] = useState<string>("2025-12");
  const [busca, setBusca] = useState<string>("");

  // dados
  const [rows, setRows] = useState<JoinedRow[]>([]);

  // ====== carregar lista de equipamentos (equipment_hours_2025) ======
  useEffect(() => {
    if (!supabase) return;

    (async () => {
      setErrorMsg("");
      try {
        // pega equipamentos da tabela de horas (apenas lista oficial)
        const res: any = await supabase
          .from("equipment_hours_2025")
          .select("equipamento")
          .not("equipamento", "is", null)
          .limit(5000);

        if (res.error) throw res.error;

        const raw: string[] = (res.data || [])
          .map((r: any) => String(r.equipamento || "").trim())
          .filter(Boolean);

        // normaliza + canonicaliza para exibir
        const normSet = new Set<string>();
        const displaySet = new Set<string>();

        raw.forEach((e) => {
          const n = normalizeEquip(e);
          if (!n) return;
          normSet.add(n);
          displaySet.add(canonicalDisplay(n));
        });

        const list = Array.from(displaySet).sort((a, b) =>
          a.localeCompare(b)
        );

        setEquipNormSet(normSet);
        setEquipList(list);

        // define default se vazio
        if (!equipamento && list.length) {
          setEquipamento(list[0]);
        }
      } catch (e: any) {
        setEquipList([]);
        setEquipNormSet(new Set());
        setErrorMsg(e?.message || "Erro ao carregar lista de equipamentos.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // ====== carregar relatório (orders_2025_raw_stage + orders_2025_items) ======
  useEffect(() => {
    if (!supabase) return;
    if (!equipamento) return;

    (async () => {
      setLoading(true);
      setErrorMsg("");

      try {
        const selectedNorm = normalizeEquip(equipamento);
        const deVal = de || "2025-01";
        const ateVal = ate || "2025-12";

        // 1) traz OCs no período (stage)
        // Observação: a normalização MN07/MN-07 é feita no client,
        // então trazemos período e filtramos aqui.
        const ocRes: any = await supabase
          .from("orders_2025_raw_stage")
          .select(
            "id,date,time,mes_ano,tipo_registro,numero_oc,codigo_equipamento,obra,operador,local_entrega,valor_menor,texto_original,fornecedor_1,fornecedor_2,fornecedor_3,preco_1,preco_2,preco_3,fornecedor_vencedor"
          )
          .gte("mes_ano", deVal)
          .lte("mes_ano", ateVal)
          .limit(5000);

        if (ocRes.error) throw ocRes.error;

        const ocRows: RawStageRow[] = Array.isArray(ocRes.data)
          ? (ocRes.data as any)
          : [];

        // 2) filtra OCs por equipamento (normalizado) e por lista oficial (hours)
        const ocFiltered = ocRows.filter((r) => {
          const n = normalizeEquip(r.codigo_equipamento);
          if (!n) return false;
          // só entra se equipamento está na lista oficial do hours
          if (equipNormSet.size && !equipNormSet.has(n)) return false;
          // filtro equipamento selecionado
          return n === selectedNorm;
        });

        // 3) busca itens dessas OCs (orders_2025_items)
        const ocIds = ocFiltered.map((r) => r.id).filter(Boolean);

        let itemsByOrder = new Map<number, ItemRow[]>();
        if (ocIds.length) {
          // Supabase tem limite no "in" dependendo do tamanho; chunk por segurança
          const chunkSize = 250;
          const allItems: ItemRow[] = [];

          for (let i = 0; i < ocIds.length; i += chunkSize) {
            const chunk = ocIds.slice(i, i + chunkSize);
            const itRes: any = await supabase
              .from("orders_2025_items")
              .select("id,ordem_id,descricao,quantidade_texto,quantidade_num")
              .in("ordem_id", chunk)
              .limit(10000);

            if (itRes.error) throw itRes.error;
            (itRes.data || []).forEach((x: any) => allItems.push(x));
          }

          itemsByOrder = allItems.reduce((map, it) => {
            const k = Number(it.ordem_id);
            if (!map.has(k)) map.set(k, []);
            map.get(k)!.push(it);
            return map;
          }, new Map<number, ItemRow[]>());
        }

        // 4) monta linhas “relatório do comprador”: uma linha por item
        const joined: JoinedRow[] = [];

        ocFiltered.forEach((oc) => {
          const fornecedor =
            oc.fornecedor_vencedor ||
            oc.fornecedor_1 ||
            oc.fornecedor_2 ||
            oc.fornecedor_3 ||
            null;

          const eqNorm = normalizeEquip(oc.codigo_equipamento);
          const eqDisp = canonicalDisplay(eqNorm);

          const its = itemsByOrder.get(oc.id) || [];

          if (!its.length) {
            // mesmo sem itens, mantém 1 linha pra não “sumir” OC
            joined.push({
              ordem_id: oc.id,
              oc: oc.numero_oc,
              tipo_registro: oc.tipo_registro,
              data: oc.date,
              hora: oc.time,
              mes_ano: oc.mes_ano,

              equipamento_raw: oc.codigo_equipamento,
              equipamento_norm: eqNorm,
              equipamento_display: eqDisp,

              obra: oc.obra,
              operador: oc.operador,

              fornecedor,
              valor_oc: oc.valor_menor,

              item_descricao: null,
              item_qtd_num: null,
              item_qtd_txt: null,

              texto_original: oc.texto_original,
            });
            return;
          }

          its.forEach((it) => {
            joined.push({
              ordem_id: oc.id,
              oc: oc.numero_oc,
              tipo_registro: oc.tipo_registro,
              data: oc.date,
              hora: oc.time,
              mes_ano: oc.mes_ano,

              equipamento_raw: oc.codigo_equipamento,
              equipamento_norm: eqNorm,
              equipamento_display: eqDisp,

              obra: oc.obra,
              operador: oc.operador,

              fornecedor,
              valor_oc: oc.valor_menor,

              item_descricao: it.descricao,
              item_qtd_num: it.quantidade_num,
              item_qtd_txt: it.quantidade_texto,

              texto_original: oc.texto_original,
            });
          });
        });

        // 5) filtros client: tipo + busca
        const b = busca.trim().toLowerCase();

        let filtered = joined;

        if (tipo !== "TODOS") {
          filtered = filtered.filter(
            (r) => tipoFromRegistro(r.tipo_registro) === tipo
          );
        }

        if (b) {
          filtered = filtered.filter((r) => {
            const hay = [
              r.oc,
              r.tipo_registro,
              r.equipamento_display,
              r.obra,
              r.operador,
              r.fornecedor,
              r.item_descricao,
              r.item_qtd_txt,
              r.texto_original,
            ]
              .map((x) => String(x || "").toLowerCase())
              .join(" | ");
            return hay.includes(b);
          });
        }

        // 6) ordena por data desc, depois id desc
        filtered.sort((a, b2) => {
          const da = parseBrDateToSortable(a.data);
          const db = parseBrDateToSortable(b2.data);
          if (db !== da) return db - da;
          return (b2.ordem_id || 0) - (a.ordem_id || 0);
        });

        setRows(filtered);
      } catch (e: any) {
        setRows([]);
        setErrorMsg(e?.message || "Erro ao carregar compras por equipamento.");
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase, equipamento, tipo, de, ate, busca, equipNormSet]);

  const stats = useMemo(() => {
    const ocSet = new Set<number>();
    let total = 0;

    rows.forEach((r) => {
      ocSet.add(r.ordem_id);
      if (r.valor_oc != null) total += r.valor_oc;
    });

    return {
      ocs: ocSet.size,
      itens: rows.filter((r) => r.item_descricao).length,
      total,
    };
  }, [rows]);

  const tipoOptions: { key: TipoFiltro; label: string }[] = [
    { key: "MANUTENCAO", label: "Manutenção" },
    { key: "COMPRA", label: "Compra" },
    { key: "PECAS", label: "Peças" },
    { key: "SERVICOS", label: "Serviços" },
    { key: "ABASTECIMENTO", label: "Abastecimento" },
    { key: "OUTRO", label: "Outro" },
    { key: "TODOS", label: "Todos" },
  ];

  return (
    <>
      <style jsx global>{`
        .eq-page-root {
          min-height: 100vh;
          background: radial-gradient(circle at top, #f9fafb 0, #f3f4f6 45%, #e5e7eb);
          display: flex;
          justify-content: center;
          padding: 32px 16px;
        }

        .eq-page-container {
          width: 100%;
          max-width: 1120px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .eq-hero {
          text-align: center;
          padding-top: 6px;
        }

        .eq-logo {
          display: flex;
          justify-content: center;
          margin: 0 0 10px;
        }

        .eq-logo img {
          height: 92px;
          width: auto;
          display: block;
          object-fit: contain;
        }

        .eq-title {
          margin: 0;
          font-size: 30px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--gp-text);
        }

        .eq-subtitle {
          margin-top: 6px;
          font-size: 13px;
          color: var(--gp-muted-soft);
        }

        .pill-row {
          display: flex;
          justify-content: center;
          gap: 10px;
          margin-top: 10px;
          flex-wrap: wrap;
        }

        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border-radius: 999px;
          background: #fff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
          font-size: 12px;
          color: var(--gp-muted);
        }

        .pill strong {
          color: var(--gp-text);
          font-weight: 700;
        }

        .warn {
          border-radius: 16px;
          border: 1px solid rgba(251, 146, 60, 0.35);
          background: rgba(255, 237, 213, 0.75);
          padding: 12px 14px;
          color: #7c2d12;
          font-weight: 700;
          font-size: 13px;
          box-shadow: 0 12px 26px rgba(15, 23, 42, 0.06);
        }

        .section-card {
          border-radius: 18px;
          padding: 18px 20px;
          background: var(--gp-surface);
          box-shadow: 0 16px 36px rgba(15, 23, 42, 0.06);
        }

        .section-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }

        .section-title {
          font-size: 0.95rem;
          font-weight: 600;
          margin: 0;
        }

        .section-sub {
          font-size: 0.75rem;
          color: var(--gp-muted-soft);
        }

        .filters {
          display: grid;
          grid-template-columns: 260px 200px 140px 140px 1fr;
          gap: 10px;
          align-items: end;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .label {
          font-size: 12px;
          font-weight: 650;
          color: #111827;
        }

        .input,
        .select {
          width: 100%;
          border: 1px solid #e5e7eb;
          background: #fff;
          border-radius: 12px;
          padding: 10px 12px;
          font-size: 14px;
          outline: none;
        }

        .input:focus,
        .select:focus {
          border-color: #cbd5e1;
          box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.15);
        }

        .table-wrapper {
          overflow-x: auto;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.82rem;
        }

        th,
        td {
          padding: 8px 10px;
          text-align: left;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: top;
        }

        thead th {
          color: var(--gp-muted);
          font-weight: 700;
          border-bottom: 1px solid #e5e7eb;
          background: #fff;
          position: sticky;
          top: 0;
          z-index: 1;
        }

        tbody tr:hover {
          background: #f9fafb;
        }

        .muted {
          color: var(--gp-muted);
        }

        .note {
          margin-top: 8px;
          font-size: 12px;
          color: var(--gp-muted);
        }

        .state {
          border-radius: 14px;
          padding: 14px;
          border: 1px dashed #e5e7eb;
          background: #fff;
          color: var(--gp-muted);
          font-size: 14px;
        }

        @media (max-width: 980px) {
          .filters {
            grid-template-columns: 1fr 1fr;
          }
        }
      `}</style>

      <main className="eq-page-root">
        <div className="eq-page-container">
          <div className="eq-hero">
            <div className="eq-logo">
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
            </div>
            <h1 className="eq-title">Compras Manutenção - Equipamentos</h1>
            <div className="eq-subtitle">
              Relatório para o comprador explorar: peça, fornecedor, data e total da OC (sem rateio por peça).
            </div>

            <div className="pill-row">
              <div className="pill">
                OCs <strong>{stats.ocs}</strong>
              </div>
              <div className="pill">
                Itens <strong>{stats.itens}</strong>
              </div>
              <div className="pill">
                Total <strong>{currency.format(stats.total)}</strong>
              </div>
            </div>
          </div>

          {!env.ok && (
            <div className="warn">
              Configuração no Vercel necessária: defina <b>NEXT_PUBLIC_SUPABASE_URL</b> e{" "}
              <b>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY</b> (ou <b>NEXT_PUBLIC_SUPABASE_ANON_KEY</b>).
            </div>
          )}

          {errorMsg ? <div className="warn">{errorMsg}</div> : null}

          <section className="section-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">Filtros</h2>
                <div className="section-sub">
                  Equipamentos vêm exclusivamente do <b>equipment_hours_2025</b> (lista oficial).
                </div>
              </div>
              <div className="section-sub">
                Fonte: <b>orders_2025_raw_stage</b> + <b>orders_2025_items</b>
              </div>
            </div>

            <div className="filters">
              <div className="field">
                <div className="label">Equipamento</div>
                <select
                  className="select"
                  value={equipamento}
                  onChange={(e) => setEquipamento(e.target.value)}
                >
                  {equipList.length === 0 ? (
                    <option value="">(sem equipamentos)</option>
                  ) : (
                    equipList.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="field">
                <div className="label">Tipo</div>
                <select
                  className="select"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as TipoFiltro)}
                >
                  {tipoOptions.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="label">De</div>
                <input
                  className="input"
                  value={de}
                  onChange={(e) => setDe(e.target.value)}
                  placeholder="2025-01"
                />
              </div>

              <div className="field">
                <div className="label">Até</div>
                <input
                  className="input"
                  value={ate}
                  onChange={(e) => setAte(e.target.value)}
                  placeholder="2025-12"
                />
              </div>

              <div className="field">
                <div className="label">Busca</div>
                <input
                  className="input"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="OC, peça, obra, fornecedor, texto..."
                />
              </div>
            </div>

            <div className="note">
              Importante: várias OCs têm várias peças, mas <b>o valor é o TOTAL da OC</b> (não é valor por item).
              A tela normaliza <b>MN07 / MN-07 / mn07</b> automaticamente.
            </div>
          </section>

          <section className="section-card">
            <div className="section-head">
              <div>
                <h2 className="section-title">Resultados</h2>
                <div className="section-sub">
                  Linha por item (quando existir). Se a OC não tiver itens cadastrados, aparece uma linha “sem item”.
                </div>
              </div>
              <div className="section-sub">
                {loading ? "Carregando..." : `${rows.length} linhas`}
              </div>
            </div>

            {loading ? (
              <div className="state">Carregando dados…</div>
            ) : rows.length === 0 ? (
              <div className="state">Nenhum registro encontrado para os filtros atuais.</div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Equip.</th>
                      <th>OC</th>
                      <th>Tipo</th>
                      <th>Item</th>
                      <th>Qtd</th>
                      <th>Fornecedor</th>
                      <th>Total OC</th>
                      <th>Obra</th>
                      <th>Operador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => {
                      const tipoLbl = tipoFromRegistro(r.tipo_registro);
                      const qtd =
                        r.item_qtd_num != null
                          ? String(r.item_qtd_num)
                          : r.item_qtd_txt
                          ? r.item_qtd_txt
                          : "";
                      return (
                        <tr key={`${r.ordem_id}-${idx}`}>
                          <td>
                            <div>{r.data || "—"}</div>
                            <div className="muted">{r.hora || ""}</div>
                          </td>
                          <td>{r.equipamento_display}</td>
                          <td>{r.oc || "—"}</td>
                          <td>{tipoLbl}</td>
                          <td>
                            {r.item_descricao ? (
                              r.item_descricao
                            ) : (
                              <span className="muted">(sem item cadastrado)</span>
                            )}
                          </td>
                          <td>{qtd || "—"}</td>
                          <td>{r.fornecedor || "—"}</td>
                          <td>{r.valor_oc != null ? currency.format(r.valor_oc) : "—"}</td>
                          <td>{r.obra || "—"}</td>
                          <td>{r.operador || "—"}</td>
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
