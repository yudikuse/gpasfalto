// FILE: app/equipamentos/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type OrderRow = {
  id: number;
  date: string | null;
  time: string | null;
  mes_ano: string | null;
  tipo_registro: string | null;
  numero_oc: string | null;

  codigo_equipamento: string | null;
  obra: string | null;
  operador: string | null;
  local_entrega: string | null;

  fornecedor_1?: string | null;
  fornecedor_2?: string | null;
  fornecedor_3?: string | null;

  preco_1?: number | null;
  preco_2?: number | null;
  preco_3?: number | null;

  valor_menor?: number | null;
  fornecedor_vencedor?: string | null;

  texto_original?: string | null;
};

type ItemRow = {
  id?: number;
  ordem_id: number;
  quantidade: number | null;
  descricao: string | null;
  valor: number | null;
};

function resolvePublicSupabase(): { url: string; key: string; ok: boolean } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const key = publishable || anon;
  return { url, key, ok: Boolean(url && key) };
}

function pad(n: number, size: number) {
  const s = String(n);
  return s.length >= size ? s : "0".repeat(size - s.length) + s;
}

function normalizeEquip(input: string | null | undefined): string {
  const raw = (input || "").trim();
  if (!raw) return "";

  // remove espaços e underscores, sobe pra upper
  const cleaned = raw.replace(/\s+/g, "").replace(/_/g, "-").toUpperCase();

  // pega prefixo + número mesmo que venha sem traço: MN07 / MN-7 / mn07 etc
  // ex: KB-02, MN07, mn-7, PC01, UA-2
  const m = cleaned.match(/^([A-Z]{1,6})-?(\d{1,3})$/);
  if (m) {
    const prefix = m[1];
    const num = Number(m[2]);
    if (Number.isFinite(num)) return `${prefix}-${pad(num, 2)}`;
  }

  // se não encaixar, devolve apenas upper mesmo
  return cleaned;
}

function normalizeText(s: string | null | undefined) {
  return (s || "").toString().trim();
}

function inRangeMesAno(mesAno: string, start: string, end: string) {
  // mesAno: "2025-01"
  return mesAno >= start && mesAno <= end;
}

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function prettyTipo(tipo: string | null | undefined) {
  const t = (tipo || "").toUpperCase();
  if (t.includes("ABAST")) return "Abastecimento";
  if (t.includes("MANUT")) return "Manutenção";
  if (t.includes("PECAS")) return "Peças";
  if (t.includes("SERV")) return "Serviços";
  if (t.includes("COMPRA")) return "Compra";
  if (t === "OC") return "OC";
  return t ? t : "-";
}

function tipoKey(tipo: string | null | undefined) {
  const t = (tipo || "").toUpperCase();
  if (t.includes("ABAST")) return "ABASTECIMENTO";
  if (t.includes("MANUT")) return "MANUTENCAO";
  if (t.includes("PECAS")) return "PECAS";
  if (t.includes("SERV")) return "SERVICOS";
  if (t.includes("COMPRA")) return "COMPRA";
  if (t === "OC") return "OC";
  return "OUTRO";
}

async function pickFirstExistingOrdersTable(supabase: SupabaseClient) {
  // tenta stage primeiro (como você está usando), cai pro raw se não existir
  const candidates = ["orders_2025_raw_stage", "orders_2025_raw"];
  for (const table of candidates) {
    const test = await supabase.from(table).select("id").limit(1);
    if (!test.error) return table;
  }
  return "orders_2025_raw_stage";
}

export default function EquipamentosExplosaoPage() {
  const env = resolvePublicSupabase();

  const supabase: SupabaseClient | null = useMemo(() => {
    if (!env.ok) return null;
    return createClient(env.url, env.key);
  }, [env.ok, env.url, env.key]);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [ordersTable, setOrdersTable] = useState<string>("orders_2025_raw_stage");

  // filtros
  const [equip, setEquip] = useState<string>(""); // NORMALIZADO
  const [tipo, setTipo] = useState<string>("TODOS");
  const [fromMesAno, setFromMesAno] = useState<string>("2025-01");
  const [toMesAno, setToMesAno] = useState<string>("2025-12");
  const [q, setQ] = useState<string>("");

  // UI
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (!supabase) return;

    (async () => {
      setLoading(true);
      setErrorMsg("");

      try {
        const table = await pickFirstExistingOrdersTable(supabase);
        setOrdersTable(table);

        const ordersRes = await supabase
          .from(table)
          .select(
            "id,date,time,mes_ano,tipo_registro,numero_oc,codigo_equipamento,obra,operador,local_entrega,fornecedor_1,fornecedor_2,fornecedor_3,preco_1,preco_2,preco_3,valor_menor,fornecedor_vencedor,texto_original"
          )
          .order("id", { ascending: false })
          .limit(5000);

        if (ordersRes.error) throw ordersRes.error;

        const ordersData = (ordersRes.data || []) as any[];
        const normalizedOrders: OrderRow[] = ordersData.map((r) => ({
          ...r,
          codigo_equipamento: r.codigo_equipamento ?? null,
        }));

        // itens (puxa bastante porque pode ter muitas linhas)
        const itemsRes = await supabase
          .from("orders_2025_items")
          .select("id,ordem_id,quantidade,descricao,valor")
          .order("ordem_id", { ascending: false })
          .limit(20000);

        if (itemsRes.error) throw itemsRes.error;

        setOrders(normalizedOrders);
        setItems((itemsRes.data || []) as ItemRow[]);

        // se não tem equipamento escolhido, tenta selecionar o 1º que existir (normalizado)
        const firstEquip = normalizedOrders
          .map((o) => normalizeEquip(o.codigo_equipamento))
          .find((x) => !!x);
        if (!equip && firstEquip) setEquip(firstEquip);
      } catch (e: any) {
        setErrorMsg(e?.message || "Erro ao carregar dados.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const equipOptions = useMemo(() => {
    const set = new Set<string>();
    orders.forEach((o) => {
      const n = normalizeEquip(o.codigo_equipamento);
      if (n) set.add(n);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [orders]);

  const itemsByOrder = useMemo(() => {
    const map = new Map<number, ItemRow[]>();
    items.forEach((it) => {
      if (!map.has(it.ordem_id)) map.set(it.ordem_id, []);
      map.get(it.ordem_id)!.push(it);
    });
    // ordena itens por id se tiver
    for (const [k, list] of map.entries()) {
      list.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
      map.set(k, list);
    }
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();

    const base = orders.filter((o) => {
      const eq = normalizeEquip(o.codigo_equipamento);
      if (equip && eq !== equip) return false;

      const m = normalizeText(o.mes_ano);
      if (m && (fromMesAno || toMesAno)) {
        const start = fromMesAno || "0000-00";
        const end = toMesAno || "9999-99";
        if (!inRangeMesAno(m, start, end)) return false;
      }

      if (tipo !== "TODOS") {
        if (tipoKey(o.tipo_registro) !== tipo) return false;
      }

      if (qLower) {
        const hay = [
          o.numero_oc,
          o.tipo_registro,
          o.codigo_equipamento,
          o.obra,
          o.operador,
          o.local_entrega,
          o.fornecedor_vencedor,
          o.texto_original,
        ]
          .map((x) => (x || "").toString().toLowerCase())
          .join(" | ");

        // procura também nos itens da ordem
        const it = itemsByOrder.get(o.id) || [];
        const itHay = it
          .map((r) => `${r.quantidade ?? ""} ${r.descricao ?? ""} ${r.valor ?? ""}`.toLowerCase())
          .join(" | ");

        if (!hay.includes(qLower) && !itHay.includes(qLower)) return false;
      }

      return true;
    });

    return base;
  }, [orders, equip, fromMesAno, toMesAno, tipo, q, itemsByOrder]);

  const computed = useMemo(() => {
    let countOrders = 0;
    let countItems = 0;
    let total = 0;

    filtered.forEach((o) => {
      countOrders += 1;
      const it = itemsByOrder.get(o.id) || [];
      countItems += it.length;

      // TOTAL da OC (sem rateio por peça)
      // regra:
      // - se valor_menor existe -> considera como total da OC (normalmente cotação vencedora)
      // - senão soma valores dos itens (se tiver)
      // - senão 0
      const vm = typeof o.valor_menor === "number" ? o.valor_menor : null;
      if (vm != null && Number.isFinite(vm)) {
        total += vm;
      } else {
        const sumItems = it.reduce((acc, r) => acc + (typeof r.valor === "number" ? r.valor : 0), 0);
        total += sumItems;
      }
    });

    return { countOrders, countItems, total };
  }, [filtered, itemsByOrder]);

  const monthOptions = useMemo(() => {
    // 2025-01 .. 2025-12
    const list: string[] = [];
    for (let m = 1; m <= 12; m++) list.push(`2025-${pad(m, 2)}`);
    return list;
  }, []);

  const typeOptions = [
    { key: "TODOS", label: "Todos" },
    { key: "MANUTENCAO", label: "Manutenção" },
    { key: "COMPRA", label: "Compra" },
    { key: "ABASTECIMENTO", label: "Abastecimento" },
    { key: "PECAS", label: "Peças" },
    { key: "SERVICOS", label: "Serviços" },
    { key: "OC", label: "OC" },
    { key: "OUTRO", label: "Outro" },
  ];

  return (
    <>
      <style jsx global>{`
        .page-root {
          min-height: 100vh;
          background: radial-gradient(circle at top, #f9fafb 0, #f3f4f6 45%, #e5e7eb);
          display: flex;
          justify-content: center;
          padding: 32px 16px;
        }
        .page-container {
          width: 100%;
          max-width: 1120px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .hero {
          text-align: center;
          padding: 6px 14px 0;
        }
        .hero-logo {
          display: flex;
          justify-content: center;
          margin: 0 0 10px;
        }
        .hero-logo img {
          height: 92px;
          width: auto;
          display: block;
          object-fit: contain;
        }
        .hero-title {
          margin: 0;
          font-size: 30px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--gp-text);
        }
        .hero-sub {
          margin-top: 6px;
          font-size: 13px;
          color: var(--gp-muted-soft);
        }

        .pill-row {
          display: flex;
          justify-content: center;
          gap: 8px;
          margin-top: 10px;
          flex-wrap: wrap;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border-radius: 999px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
          font-size: 12px;
          color: var(--gp-muted);
        }
        .pill strong {
          color: #0f172a;
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

        .section-title {
          font-size: 0.95rem;
          font-weight: 650;
          margin: 0;
        }
        .section-subtitle {
          margin-top: 4px;
          font-size: 0.75rem;
          color: var(--gp-muted-soft);
        }

        .filter-grid {
          display: grid;
          grid-template-columns: 280px 260px 140px 140px 1fr;
          gap: 10px;
          margin-top: 12px;
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
          padding: 11px 12px;
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
          margin-top: 12px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.85rem;
        }
        th,
        td {
          padding: 10px 10px;
          text-align: left;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: top;
        }
        thead th {
          color: var(--gp-muted);
          font-weight: 700;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          border-bottom: 1px solid #e5e7eb;
        }

        .row-btn {
          border: 1px solid #e5e7eb;
          background: #fff;
          border-radius: 12px;
          padding: 8px 10px;
          cursor: pointer;
          font-weight: 700;
          color: #0f172a;
        }

        .badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 12px;
          border: 1px solid #e5e7eb;
          background: #f9fafb;
          color: var(--gp-muted);
          white-space: nowrap;
        }

        .items-box {
          margin-top: 10px;
          border: 1px solid #eef2f7;
          border-radius: 14px;
          background: #ffffff;
          padding: 12px;
        }
        .items-box .it {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 0;
          border-bottom: 1px dashed #eef2f7;
        }
        .items-box .it:last-child {
          border-bottom: none;
        }
        .muted {
          color: var(--gp-muted);
          font-size: 12px;
        }

        @media (max-width: 980px) {
          .filter-grid {
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (max-width: 560px) {
          .hero-logo img {
            height: 76px;
          }
          .hero-title {
            font-size: 26px;
          }
          .filter-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="page-root">
        <div className="page-container">
          <div className="hero">
            <div className="hero-logo">
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
            </div>
            <h1 className="hero-title">Explosão por Máquina</h1>
            <div className="hero-sub">
              OCs + itens por equipamento · valor tratado como TOTAL da OC (sem rateio por peça) · fonte:{" "}
              <b>{ordersTable}</b>
            </div>

            <div className="pill-row">
              <div className="pill">
                OCs <strong>{computed.countOrders}</strong>
              </div>
              <div className="pill">
                Itens <strong>{computed.countItems}</strong>
              </div>
              <div className="pill">
                Total <strong>{currency.format(computed.total)}</strong>
              </div>
            </div>
          </div>

          {!env.ok && (
            <div className="warn">
              Configure no Vercel: <b>NEXT_PUBLIC_SUPABASE_URL</b> e{" "}
              <b>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY</b> (ou <b>NEXT_PUBLIC_SUPABASE_ANON_KEY</b>).
            </div>
          )}

          {errorMsg ? <div className="warn">{errorMsg}</div> : null}

          <section className="section-card">
            <div className="section-title">Filtros</div>
            <div className="section-subtitle">
              Use equipamento + tipo + período. A busca livre procura também dentro dos itens e do texto original.
            </div>

            <div className="filter-grid">
              <div className="field">
                <div className="label">Equipamento</div>
                <select className="select" value={equip} onChange={(e) => setEquip(e.target.value)}>
                  <option value="">(Selecione)</option>
                  {equipOptions.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
                <div className="muted" style={{ marginTop: 2 }}>
                  Normalizado (ex: MN-07). Se no banco tiver mn07/mn-07, aqui vira um só.
                </div>
              </div>

              <div className="field">
                <div className="label">Tipo</div>
                <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  {typeOptions.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="label">De</div>
                <select className="select" value={fromMesAno} onChange={(e) => setFromMesAno(e.target.value)}>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="label">Até</div>
                <select className="select" value={toMesAno} onChange={(e) => setToMesAno(e.target.value)}>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="label">Busca</div>
                <input
                  className="input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="OC, peça, obra, fornecedor, texto..."
                />
              </div>
            </div>
          </section>

          <section className="section-card">
            <div className="section-title">Resultados</div>
            <div className="section-subtitle">
              Atenção: muitas OCs possuem várias peças, mas o valor pode representar o conjunto (TOTAL da OC).
            </div>

            {loading ? (
              <div className="muted" style={{ marginTop: 12 }}>
                Carregando…
              </div>
            ) : filtered.length === 0 ? (
              <div className="muted" style={{ marginTop: 12 }}>
                Nenhuma OC encontrada para os filtros atuais.
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 80 }}>ID</th>
                      <th style={{ width: 110 }}>Mês</th>
                      <th style={{ width: 120 }}>OC</th>
                      <th style={{ width: 140 }}>Tipo</th>
                      <th>Obra / Entrega</th>
                      <th style={{ width: 170 }}>Fornecedor</th>
                      <th style={{ width: 140, textAlign: "right" }}>Total</th>
                      <th style={{ width: 120 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((o) => {
                      const it = itemsByOrder.get(o.id) || [];
                      const total =
                        typeof o.valor_menor === "number" && Number.isFinite(o.valor_menor)
                          ? o.valor_menor
                          : it.reduce((acc, r) => acc + (typeof r.valor === "number" ? r.valor : 0), 0);

                      const isOpen = expandedId === o.id;

                      return (
                        <tr key={o.id}>
                          <td>{o.id}</td>
                          <td>{o.mes_ano || "-"}</td>
                          <td>
                            <div style={{ fontWeight: 750 }}>{o.numero_oc || "-"}</div>
                            <div className="muted">{normalizeEquip(o.codigo_equipamento) || "-"}</div>
                          </td>
                          <td>
                            <span className="badge">{prettyTipo(o.tipo_registro)}</span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 650 }}>{o.obra || "-"}</div>
                            <div className="muted">{o.local_entrega || "-"}</div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 650 }}>{o.fornecedor_vencedor || "-"}</div>
                            <div className="muted">
                              {o.valor_menor != null ? `Menor preço: ${currency.format(o.valor_menor)}` : "—"}
                            </div>
                          </td>
                          <td style={{ textAlign: "right", fontWeight: 800 }}>{currency.format(total)}</td>
                          <td style={{ textAlign: "right" }}>
                            <button className="row-btn" onClick={() => setExpandedId(isOpen ? null : o.id)}>
                              {isOpen ? "Fechar" : `Itens (${it.length})`}
                            </button>

                            {isOpen && (
                              <div className="items-box">
                                {it.length === 0 ? (
                                  <div className="muted">Sem itens vinculados nesta OC.</div>
                                ) : (
                                  it.map((r, idx) => (
                                    <div key={`${o.id}-${idx}`} className="it">
                                      <div>
                                        <div style={{ fontWeight: 650 }}>
                                          {(r.quantidade ?? 0).toString()}x {r.descricao || "-"}
                                        </div>
                                        <div className="muted">ordem_id: {r.ordem_id}</div>
                                      </div>
                                      <div style={{ fontWeight: 800 }}>
                                        {r.valor != null ? currency.format(r.valor) : "—"}
                                      </div>
                                    </div>
                                  ))
                                )}

                                <div style={{ marginTop: 10 }} className="muted">
                                  Texto original:{" "}
                                  <span style={{ color: "#0f172a" }}>
                                    {(o.texto_original || "").slice(0, 160) || "—"}
                                    {(o.texto_original || "").length > 160 ? "…" : ""}
                                  </span>
                                </div>
                              </div>
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

          <div className="muted" style={{ textAlign: "center" }}>
            Dica: se ainda aparecer duplicado na lista (ex: KB-02 e kb02), me mande 3 exemplos reais e eu ajusto a regra de normalização para bater 100%.
          </div>
        </div>
      </div>
    </>
  );
}
