// FILE: app/equipamentos/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type RawOrder = {
  id: number;
  date: string | null; // dd/mm/yyyy
  time: string | null; // hh:mm:ss
  mes_ano: string | null; // yyyy-mm
  tipo_registro: string | null;
  numero_oc: string | null;
  codigo_equipamento: string | null;
  obra: string | null;
  solicitante: string | null;
  operador: string | null;
  horimetro: string | null;
  material: string | null;
  quantidade_texto: string | null;
  local_entrega: string | null;
  placa: string | null;
  valor_menor: number | null; // TOTAL da OC
  moeda: string | null;
  texto_original: string | null;
};

type OrderItem = {
  ordem_id: number;
  date: string | null;
  time: string | null;
  numero_oc: string | null;
  descricao: string | null;
  quantidade_texto: string | null;
  quantidade_num: number | null;
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function safeStr(x: any) {
  const s = String(x ?? "").trim();
  return s;
}

function uniqSorted(list: string[]) {
  return Array.from(new Set(list.map((x) => x.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "pt-BR", { sensitivity: "base" })
  );
}

export default function ExplosaoEquipamentosPage() {
  // filtros
  const [equipamento, setEquipamento] = useState<string>("all");
  const [tipo, setTipo] = useState<string>("all");
  const [mesIni, setMesIni] = useState<string>("all");
  const [mesFim, setMesFim] = useState<string>("all");
  const [q, setQ] = useState<string>("");

  // dados
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [equipOptions, setEquipOptions] = useState<string[]>([]);
  const [tipoOptions, setTipoOptions] = useState<string[]>([]);
  const [mesOptions, setMesOptions] = useState<string[]>([]);

  const [orders, setOrders] = useState<RawOrder[]>([]);
  const [itemsByOrder, setItemsByOrder] = useState<Record<number, OrderItem[]>>({});

  // UI
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  // ===== bootstrap: carregar listas (equipamentos / tipos / meses) =====
  useEffect(() => {
    let alive = true;

    async function bootstrap() {
      setLoading(true);
      setError(null);

      try {
        // 1) Equipamentos: usa view do dashboard (mesma fonte que você pediu antes)
        // (pega "equipamento" e usa como lista)
        const eqRes = await supabase
          .from("equipment_costs_2025_v")
          .select("equipamento")
          .not("equipamento", "is", null)
          .limit(5000);

        // fallback: também busca em orders_2025_raw caso view esteja limitada
        const eqRes2 = await supabase
          .from("orders_2025_raw")
          .select("codigo_equipamento")
          .not("codigo_equipamento", "is", null)
          .limit(5000);

        const eqList = uniqSorted([
          ...(eqRes.data || []).map((r: any) => safeStr(r.equipamento)),
          ...(eqRes2.data || []).map((r: any) => safeStr(r.codigo_equipamento)),
        ]);

        // 2) Tipos e meses (do raw)
        const metaRes = await supabase
          .from("orders_2025_raw")
          .select("tipo_registro, mes_ano")
          .not("mes_ano", "is", null)
          .limit(5000);

        const tipos = uniqSorted((metaRes.data || []).map((r: any) => safeStr(r.tipo_registro)));
        const meses = uniqSorted((metaRes.data || []).map((r: any) => safeStr(r.mes_ano)));

        if (!alive) return;

        setEquipOptions(eqList);
        setTipoOptions(tipos);
        setMesOptions(meses);

        // defaults: período todo se existir
        if (meses.length) {
          setMesIni(meses[0] ?? "all");
          setMesFim(meses[meses.length - 1] ?? "all");
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Falha ao carregar listas.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      alive = false;
    };
  }, []);

  // ===== carregar OCs + Itens, conforme filtros principais =====
  useEffect(() => {
    let alive = true;

    async function load() {
      setError(null);
      setLoading(true);

      try {
        // base query
        let query = supabase
          .from("orders_2025_raw")
          .select(
            "id,date,time,mes_ano,tipo_registro,numero_oc,codigo_equipamento,obra,solicitante,operador,horimetro,material,quantidade_texto,local_entrega,placa,valor_menor,moeda,texto_original"
          )
          .order("id", { ascending: false })
          .limit(600);

        if (equipamento !== "all") {
          query = query.eq("codigo_equipamento", equipamento);
        }
        if (tipo !== "all") {
          query = query.eq("tipo_registro", tipo);
        }
        if (mesIni !== "all") {
          query = query.gte("mes_ano", mesIni);
        }
        if (mesFim !== "all") {
          query = query.lte("mes_ano", mesFim);
        }

        const res = await query;
        if (res.error) throw res.error;

        const rows = (res.data || []) as RawOrder[];

        // pega itens para todos os order ids retornados
        const ids = rows.map((r) => r.id).filter((x) => Number.isFinite(x));
        let itemsMap: Record<number, OrderItem[]> = {};

        if (ids.length) {
          // busca itens em lote (ordem_id IN ids)
          // (se der limite do PostgREST por tamanho, como são até 600, costuma ok)
          const itemsRes = await supabase
            .from("orders_2025_items")
            .select("ordem_id,date,time,numero_oc,descricao,quantidade_texto,quantidade_num")
            .in("ordem_id", ids)
            .limit(5000);

          if (itemsRes.error) throw itemsRes.error;

          (itemsRes.data || []).forEach((it: any) => {
            const oid = Number(it.ordem_id);
            if (!itemsMap[oid]) itemsMap[oid] = [];
            itemsMap[oid].push(it as OrderItem);
          });

          // ordena itens dentro de cada OC
          for (const k of Object.keys(itemsMap)) {
            itemsMap[Number(k)] = itemsMap[Number(k)].sort((a, b) => {
              const da = safeStr(a.descricao);
              const db = safeStr(b.descricao);
              return da.localeCompare(db, "pt-BR", { sensitivity: "base" });
            });
          }
        }

        if (!alive) return;

        setOrders(rows);
        setItemsByOrder(itemsMap);

        // expande automaticamente as 2 primeiras
        const nextExpanded: Record<number, boolean> = {};
        rows.slice(0, 2).forEach((r) => (nextExpanded[r.id] = true));
        setExpanded((prev) => ({ ...prev, ...nextExpanded }));
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Falha ao carregar ordens/itens.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [equipamento, tipo, mesIni, mesFim]);

  // ===== filtro livre (client-side) =====
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return orders;

    return orders.filter((r) => {
      const hay = [
        r.numero_oc,
        r.codigo_equipamento,
        r.obra,
        r.operador,
        r.local_entrega,
        r.material,
        r.texto_original,
      ]
        .map((x) => safeStr(x).toLowerCase())
        .join(" | ");

      if (hay.includes(needle)) return true;

      // também busca nos itens
      const its = itemsByOrder[r.id] || [];
      const hayItems = its.map((it) => safeStr(it.descricao).toLowerCase()).join(" | ");
      return hayItems.includes(needle);
    });
  }, [orders, q, itemsByOrder]);

  // ===== KPIs =====
  const kpis = useMemo(() => {
    const totalOCs = filtered.length;
    const totalValor = filtered.reduce((acc, r) => acc + (r.valor_menor ?? 0), 0);
    const totalItens = filtered.reduce((acc, r) => acc + (itemsByOrder[r.id]?.length ?? 0), 0);

    return { totalOCs, totalValor, totalItens };
  }, [filtered, itemsByOrder]);

  const tipoLabel = (t: string | null) => {
    const x = safeStr(t);
    if (!x) return "—";
    return x.replaceAll("_", " ");
  };

  return (
    <div className="page-root">
      <style jsx global>{`
        /* só o que precisa para esta tela */
        .ex-header-logo {
          width: 120px;
          height: 120px;
          object-fit: contain;
          border: none;
          background: transparent;
        }

        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 12px;
          border-radius: 999px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
          font-size: 0.8rem;
          color: var(--gp-muted);
        }

        .pill strong {
          color: var(--gp-text);
          font-weight: 700;
        }

        .ex-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }

        .oc-card {
          border-radius: 18px;
          padding: 16px 18px;
          background: var(--gp-surface);
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
          border: 1px solid #eef2f7;
        }

        .oc-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }

        .oc-left {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .oc-title {
          font-size: 1rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--gp-text);
        }

        .oc-sub {
          font-size: 0.8rem;
          color: var(--gp-muted);
        }

        .oc-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }

        .oc-meta .chip {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 0.75rem;
          color: var(--gp-muted);
          background: var(--gp-surface-soft);
          border: none;
        }

        .oc-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .btn-mini {
          border: 1px solid #e5e7eb;
          background: #fff;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--gp-muted);
          cursor: pointer;
        }

        .btn-mini:hover {
          background: #f9fafb;
        }

        .oc-body {
          margin-top: 12px;
          border-top: 1px solid #f1f5f9;
          padding-top: 12px;
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }

        .oc-block-title {
          font-size: 0.8rem;
          font-weight: 700;
          color: var(--gp-text);
          margin-bottom: 6px;
        }

        .items-list {
          border: 1px solid #eef2f7;
          border-radius: 14px;
          background: #fff;
          padding: 10px 12px;
        }

        .items-list ul {
          margin: 0;
          padding-left: 18px;
        }

        .items-list li {
          margin: 4px 0;
          font-size: 0.85rem;
          color: #0f172a;
        }

        .raw-box {
          border: 1px solid #eef2f7;
          border-radius: 14px;
          background: #ffffff;
          padding: 12px;
          white-space: pre-wrap;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
            "Courier New", monospace;
          font-size: 0.78rem;
          line-height: 1.45;
          color: #0f172a;
          max-height: 260px;
          overflow: auto;
        }

        @media (max-width: 720px) {
          .ex-header-logo {
            width: 90px;
            height: 90px;
          }
        }
      `}</style>

      <div className="page-container">
        {/* HEADER / LOGO CENTRALIZADA */}
        <header
          className="page-header"
          style={{
            flexDirection: "column",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <div
            className="brand"
            style={{
              flexDirection: "column",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <img
              src="/gpasfalto-logo.png"
              alt="GP Asfalto"
              className="ex-header-logo"
            />
            <div style={{ textAlign: "center" }}>
              <div className="brand-text-main">Explosão por Máquina</div>
              <div className="brand-text-sub">
                OCs + itens por equipamento · valor tratado como TOTAL da OC (sem rateio por peça)
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <span className="pill">
              OCs <strong>{kpis.totalOCs}</strong>
            </span>
            <span className="pill">
              Itens <strong>{kpis.totalItens}</strong>
            </span>
            <span className="pill">
              Total <strong>{currency.format(kpis.totalValor)}</strong>
            </span>
          </div>
        </header>

        {/* FILTROS */}
        <section className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Filtros</div>
              <div className="section-subtitle">
                Use equipamento + tipo + período. A busca livre procura também dentro dos itens e do texto original.
              </div>
            </div>
          </div>

          <div className="filter-bar" style={{ borderRadius: 18, padding: "12px 14px" }}>
            <div className="filter-group" style={{ width: "100%", gap: 10 }}>
              <div className="filter-chip" style={{ background: "#fff", border: "1px solid #e5e7eb" }}>
                <span style={{ marginRight: 8 }}>Equipamento:</span>
                <select
                  value={equipamento}
                  onChange={(e) => setEquipamento(e.target.value)}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: "0.85rem",
                    outline: "none",
                    minWidth: 220,
                  }}
                >
                  <option value="all">Todos</option>
                  {equipOptions.map((eq) => (
                    <option key={eq} value={eq}>
                      {eq}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-chip" style={{ background: "#fff", border: "1px solid #e5e7eb" }}>
                <span style={{ marginRight: 8 }}>Tipo:</span>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value)}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: "0.85rem",
                    outline: "none",
                    minWidth: 240,
                  }}
                >
                  <option value="all">Todos</option>
                  {tipoOptions.map((t) => (
                    <option key={t} value={t}>
                      {tipoLabel(t)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-chip" style={{ background: "#fff", border: "1px solid #e5e7eb" }}>
                <span style={{ marginRight: 8 }}>De:</span>
                <select
                  value={mesIni}
                  onChange={(e) => setMesIni(e.target.value)}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: "0.85rem",
                    outline: "none",
                    minWidth: 120,
                  }}
                >
                  <option value="all">—</option>
                  {mesOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-chip" style={{ background: "#fff", border: "1px solid #e5e7eb" }}>
                <span style={{ marginRight: 8 }}>Até:</span>
                <select
                  value={mesFim}
                  onChange={(e) => setMesFim(e.target.value)}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: "0.85rem",
                    outline: "none",
                    minWidth: 120,
                  }}
                >
                  <option value="all">—</option>
                  {mesOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-chip" style={{ background: "#fff", border: "1px solid #e5e7eb", flex: "1 1 260px" }}>
                <span style={{ marginRight: 8 }}>Busca:</span>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="OC, peça, obra, operador, local, texto..."
                  style={{
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    fontSize: "0.85rem",
                    width: "100%",
                  }}
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="state-card" style={{ marginTop: 12 }}>
              {error}
            </div>
          )}
        </section>

        {/* LISTA */}
        <section className="ex-grid">
          {loading ? (
            <div className="state-card">Carregando…</div>
          ) : filtered.length === 0 ? (
            <div className="state-card">Nenhuma OC encontrada com os filtros atuais.</div>
          ) : (
            filtered.map((r) => {
              const its = itemsByOrder[r.id] || [];
              const isOpen = Boolean(expanded[r.id]);

              const titleLeft = `${safeStr(r.numero_oc) || `ID ${r.id}`}`;
              const titleRight = safeStr(r.codigo_equipamento) || "—";

              const total = r.valor_menor ?? null;
              const totalTxt = total != null ? currency.format(total) : "—";

              return (
                <div key={r.id} className="oc-card">
                  <div className="oc-head">
                    <div className="oc-left">
                      <div className="oc-title">
                        {titleLeft} <span style={{ color: "var(--gp-muted)" }}>·</span>{" "}
                        <span style={{ color: "var(--gp-text)" }}>{titleRight}</span>
                      </div>
                      <div className="oc-sub">
                        {safeStr(r.date) || "—"} {safeStr(r.time) ? `· ${safeStr(r.time)}` : ""}{" "}
                        {safeStr(r.mes_ano) ? `· ${safeStr(r.mes_ano)}` : ""}
                      </div>

                      <div className="oc-meta">
                        <span className="chip">Tipo: {tipoLabel(r.tipo_registro)}</span>
                        <span className="chip">Total OC: {totalTxt}</span>
                        <span className="chip">Itens: {its.length}</span>
                        {safeStr(r.obra) ? <span className="chip">Obra: {safeStr(r.obra)}</span> : null}
                        {safeStr(r.operador) ? <span className="chip">Operador: {safeStr(r.operador)}</span> : null}
                        {safeStr(r.local_entrega) ? (
                          <span className="chip">Entrega: {safeStr(r.local_entrega)}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="oc-actions">
                      <button
                        className="btn-mini"
                        type="button"
                        onClick={() => setExpanded((p) => ({ ...p, [r.id]: !Boolean(p[r.id]) }))}
                      >
                        {isOpen ? "Recolher ▲" : "Detalhar ▼"}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="oc-body">
                      <div>
                        <div className="oc-block-title">Peças / Itens</div>
                        <div className="items-list">
                          {its.length === 0 ? (
                            <div style={{ color: "var(--gp-muted)", fontSize: "0.85rem" }}>
                              (Sem itens na tabela <strong>orders_2025_items</strong> para esta OC.)
                            </div>
                          ) : (
                            <ul>
                              {its.map((it, idx) => {
                                const qtd =
                                  safeStr(it.quantidade_texto) ||
                                  (it.quantidade_num != null ? String(it.quantidade_num) : "");
                                const d = safeStr(it.descricao) || "—";
                                return (
                                  <li key={idx}>
                                    {qtd ? <strong>{qtd} </strong> : null}
                                    {d}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                        <div style={{ marginTop: 8, fontSize: "0.78rem", color: "var(--gp-muted)" }}>
                          *Valor acima é o <strong>total da OC</strong>. Não há valor por item nesta base.
                        </div>
                      </div>

                      <div>
                        <div className="oc-block-title">Texto original (WhatsApp)</div>
                        <div className="raw-box">{safeStr(r.texto_original) || "—"}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}
