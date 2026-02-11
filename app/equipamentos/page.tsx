"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type OrderTypeFilter =
  | "ALL"
  | "PEDIDO_COMPRA_MANUTENCAO"
  | "PEDIDO_ABASTECIMENTO"
  | "PEDIDO_PECAS"
  | "PEDIDO_SERVICOS"
  | "PEDIDO_COMPRA"
  | "OC";

type RawStageRow = {
  id: number;
  date: string | null; // dd/mm/yyyy
  time: string | null; // hh:mm:ss
  mes_ano: string | null; // yyyy-mm
  tipo_registro: string | null;
  numero_oc: string | null;
  codigo_equipamento: string | null;
  obra: string | null;
  operador: string | null;
  local_entrega: string | null;

  // campos comuns do parser
  material: string | null;
  quantidade_texto: string | null;

  // cotações/valor
  valor_menor: number | null;
  fornecedor_1: string | null;
  fornecedor_2: string | null;
  fornecedor_3: string | null;
  preco_1: number | null;
  preco_2: number | null;
  preco_3: number | null;

  texto_original: string | null;
};

type ItemRow = {
  id: number;
  ordem_id: number | null;
  numero_oc: string | null;
  descricao: string | null;
  quantidade_texto: string | null;
  quantidade_num: number | null;
  data: string | null;
  hora: string | null;
};

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function onlyDigits(s: string) {
  return (s || "").replace(/[^\d]/g, "");
}

function normalizeEquip(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // remove espaços internos e normaliza hífen
  s = s.replace(/\s+/g, "").replace(/–/g, "-").replace(/—/g, "-");

  // Ex: mn07 | mn-07 | MN07 | MN-7 | kb02 -> MN-07 / KB-02 etc.
  const m = s.match(/^([a-zA-Z]{1,4})-?(\d{1,3})$/);
  if (m) {
    const prefix = m[1].toUpperCase();
    const num = m[2].padStart(2, "0");
    return `${prefix}-${num}`;
  }

  // Ex: CP-04 (já ok) ou algo com múltiplos hífens
  s = s.toUpperCase().replace(/-+/g, "-");

  return s;
}

function normForSearch(s: string) {
  return (s || "").toLowerCase().trim();
}

function asMonthLabel(ym: string) {
  // ym: yyyy-mm
  const [y, m] = ym.split("-");
  const mm = Number(m);
  const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  if (!Number.isFinite(mm) || mm < 1 || mm > 12) return ym;
  return `${months[mm - 1]}/${y}`;
}

function resolvePublicSupabase(): { url: string; key: string; ok: boolean } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const key = publishable || anon;
  return { url, key, ok: Boolean(url && key) };
}

export default function EquipamentosPage() {
  const supabase: SupabaseClient | null = useMemo(() => {
    const env = resolvePublicSupabase();
    if (!env.ok) return null;
    return createClient(env.url, env.key);
  }, []);

  const env = resolvePublicSupabase();

  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string>("");

  const [equipmentOptions, setEquipmentOptions] = useState<string[]>([]);
  const [equipamento, setEquipamento] = useState<string>("");

  const [tipo, setTipo] = useState<OrderTypeFilter>("ALL");
  const [fromYM, setFromYM] = useState<string>("2025-01");
  const [toYM, setToYM] = useState<string>("2025-12");
  const [q, setQ] = useState<string>("");

  const [ocs, setOcs] = useState<RawStageRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);

  // ====== load equipment options ======
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setErr(
        "Configuração do Supabase ausente. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY (ou NEXT_PUBLIC_SUPABASE_ANON_KEY)."
      );
      return;
    }

    (async () => {
      setLoading(true);
      setErr("");

      try {
        // 1) equipamentos do dashboard (fonte estável)
        const v1 = await supabase
          .from("equipment_costs_2025_v")
          .select("equipamento")
          .not("equipamento", "is", null)
          .limit(5000);

        if (v1.error) throw v1.error;

        // 2) equipamentos vindos dos pedidos (pode ter mn07, mn-07 etc)
        const v2 = await supabase
          .from("orders_2025_raw_stage")
          .select("codigo_equipamento")
          .not("codigo_equipamento", "is", null)
          .limit(5000);

        if (v2.error) throw v2.error;

        const allRaw = [
          ...(v1.data || []).map((r: any) => r.equipamento),
          ...(v2.data || []).map((r: any) => r.codigo_equipamento),
        ];

        const normalized = allRaw
          .map((x) => normalizeEquip(x))
          .filter(Boolean) as string[];

        const uniq = Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b, "pt-BR"));

        setEquipmentOptions(uniq);
      } catch (e: any) {
        setErr(e?.message || "Erro ao carregar lista de equipamentos.");
        setEquipmentOptions([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase]);

  // ====== fetch OCs + Items ======
  async function fetchData() {
    if (!supabase) return;

    setLoading(true);
    setErr("");

    try {
      // OCs
      let query = supabase
        .from("orders_2025_raw_stage")
        .select(
          [
            "id",
            "date",
            "time",
            "mes_ano",
            "tipo_registro",
            "numero_oc",
            "codigo_equipamento",
            "obra",
            "operador",
            "local_entrega",
            "material",
            "quantidade_texto",
            "valor_menor",
            "fornecedor_1",
            "fornecedor_2",
            "fornecedor_3",
            "preco_1",
            "preco_2",
            "preco_3",
            "texto_original",
          ].join(",")
        )
        .not("id", "is", null);

      // período (mes_ano é texto yyyy-mm; dá pra usar gte/lte)
      if (fromYM) query = query.gte("mes_ano", fromYM);
      if (toYM) query = query.lte("mes_ano", toYM);

      // tipo
      if (tipo !== "ALL") query = query.eq("tipo_registro", tipo);

      // equipamento (normalizado no client -> filtro por matches no client para não depender do formato no banco)
      // Observação: aqui não filtramos no SQL para não perder mn07 vs mn-07; fazemos no client depois.

      // ordenação
      query = query.order("id", { ascending: false }).limit(1500);

      const ocRes = await query;
      if (ocRes.error) throw ocRes.error;

      let ocRows = (ocRes.data || []) as RawStageRow[];

      // normaliza equipamento no client e filtra
      const selectedNorm = normalizeEquip(equipamento);
      if (selectedNorm) {
        ocRows = ocRows.filter((r) => normalizeEquip(r.codigo_equipamento) === selectedNorm);
      }

      // busca livre (OC, peça/material, obra, fornecedor, texto)
      const qq = normForSearch(q);
      if (qq) {
        ocRows = ocRows.filter((r) => {
          const hay = [
            r.numero_oc || "",
            r.codigo_equipamento || "",
            r.obra || "",
            r.operador || "",
            r.local_entrega || "",
            r.material || "",
            r.quantidade_texto || "",
            r.fornecedor_1 || "",
            r.fornecedor_2 || "",
            r.fornecedor_3 || "",
            r.texto_original || "",
          ]
            .join(" | ")
            .toLowerCase();
          return hay.includes(qq);
        });
      }

      setOcs(ocRows);

      // Itens: pega itens vinculados às OCs retornadas (ordem_id in ids)
      const ids = ocRows.map((r) => r.id).filter((x) => Number.isFinite(x));
      if (!ids.length) {
        setItems([]);
        setLoading(false);
        return;
      }

      // NOTE: schema real tem quantidade_texto e quantidade_num (não "quantidade")
      const itemRes = await supabase
        .from("orders_2025_items")
        .select("id,ordem_id,data,hora,numero_oc,descricao,quantidade_texto,quantidade_num")
        .in("ordem_id", ids)
        .limit(5000);

      if (itemRes.error) throw itemRes.error;

      let itemRows = (itemRes.data || []) as ItemRow[];

      // busca também dentro dos itens
      if (qq) {
        itemRows = itemRows.filter((it) => {
          const hay = [it.numero_oc || "", it.descricao || "", it.quantidade_texto || ""].join(" | ").toLowerCase();
          return hay.includes(qq);
        });

        // se filtrou itens, também filtra OCs para só as que têm itens batendo OU a própria OC bateu no texto
        const idsWithItems = new Set(itemRows.map((x) => x.ordem_id).filter(Boolean) as number[]);
        ocRows = ocRows.filter((r) => idsWithItems.has(r.id) || true); // mantém OCs que já passaram no filtro acima
        setOcs(ocRows);
      }

      setItems(itemRows);
    } catch (e: any) {
      setErr(e?.message || "Erro ao buscar dados.");
      setOcs([]);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!supabase) return;
    // fetch inicial
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // ====== computed ======
  const itemsByOrderId = useMemo(() => {
    const map = new Map<number, ItemRow[]>();
    for (const it of items) {
      const id = it.ordem_id;
      if (!id) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(it);
    }
    // ordena itens por id
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => (a.id || 0) - (b.id || 0));
      map.set(k, arr);
    }
    return map;
  }, [items]);

  const totals = useMemo(() => {
    const ocCount = ocs.length;
    const itemCount = items.length;

    // Total = soma do valor_menor (tratado como TOTAL da OC)
    const totalValue = ocs.reduce((acc, r) => acc + (r.valor_menor ?? 0), 0);

    return { ocCount, itemCount, totalValue };
  }, [ocs, items]);

  const typeOptions: { value: OrderTypeFilter; label: string }[] = [
    { value: "ALL", label: "Todos" },
    { value: "PEDIDO_COMPRA_MANUTENCAO", label: "Manutenção" },
    { value: "PEDIDO_ABASTECIMENTO", label: "Abastecimento" },
    { value: "PEDIDO_PECAS", label: "Peças" },
    { value: "PEDIDO_SERVICOS", label: "Serviços" },
    { value: "PEDIDO_COMPRA", label: "Compra" },
    { value: "OC", label: "OC" },
  ];

  return (
    <>
      <style jsx global>{`
        .equip-root {
          min-height: 100vh;
          background: radial-gradient(circle at top, #f9fafb 0, #f3f4f6 45%, #e5e7eb);
          display: flex;
          justify-content: center;
          padding: 32px 16px;
        }

        .equip-container {
          width: 100%;
          max-width: 1120px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .equip-hero {
          text-align: center;
          padding: 6px 14px 0;
        }

        .equip-logo {
          display: flex;
          justify-content: center;
          margin: 0 0 10px;
        }

        .equip-logo img {
          height: 92px;
          width: auto;
          display: block;
          object-fit: contain;
        }

        .equip-title {
          margin: 0;
          font-size: 34px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--gp-text);
        }

        .equip-subtitle {
          margin-top: 6px;
          font-size: 13px;
          color: var(--gp-muted-soft);
        }

        .pill-row {
          margin-top: 10px;
          display: inline-flex;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: center;
        }

        .pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
          font-size: 12px;
          color: var(--gp-muted);
        }

        .pill strong {
          color: var(--gp-text);
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
          color: var(--gp-text);
        }

        .section-sub {
          margin-top: 4px;
          font-size: 12px;
          color: var(--gp-muted-soft);
        }

        .filters-grid {
          margin-top: 14px;
          display: grid;
          grid-template-columns: 280px 240px 140px 140px 1fr;
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
          padding: 11px 12px;
          font-size: 14px;
          outline: none;
        }

        .input:focus,
        .select:focus {
          border-color: #cbd5e1;
          box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.15);
        }

        .btn {
          border: none;
          background: #059669;
          color: #fff;
          border-radius: 12px;
          padding: 11px 12px;
          font-weight: 900;
          cursor: pointer;
        }

        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .muted {
          font-size: 12px;
          color: var(--gp-muted-soft);
        }

        .results-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }

        .oc-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .oc-card {
          border: 1px solid #eef2f7;
          border-radius: 16px;
          background: #ffffff;
          box-shadow: 0 10px 20px rgba(15, 23, 42, 0.03);
          overflow: hidden;
        }

        .oc-top {
          padding: 14px 16px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 10px;
          align-items: start;
          border-bottom: 1px solid #f1f5f9;
        }

        .oc-title {
          font-weight: 900;
          color: #0f172a;
        }

        .oc-meta {
          margin-top: 4px;
          font-size: 12px;
          color: var(--gp-muted);
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .tag {
          padding: 4px 8px;
          border-radius: 999px;
          background: var(--gp-surface-soft);
          font-size: 12px;
          color: var(--gp-muted);
        }

        .oc-total {
          text-align: right;
        }

        .oc-total .val {
          font-weight: 900;
          color: #0f172a;
        }

        .oc-body {
          padding: 12px 16px 16px;
        }

        .items-title {
          font-size: 12px;
          font-weight: 900;
          color: #0f172a;
          margin-bottom: 8px;
        }

        .item-row {
          display: grid;
          grid-template-columns: 110px 1fr;
          gap: 10px;
          padding: 8px 0;
          border-bottom: 1px dashed #eef2f7;
          font-size: 13px;
        }

        .item-row:last-child {
          border-bottom: none;
        }

        .qty {
          font-weight: 800;
          color: #0f172a;
        }

        .desc {
          color: #0f172a;
        }

        .empty {
          border: 1px dashed #e5e7eb;
          border-radius: 16px;
          padding: 14px 16px;
          background: #fff;
          color: var(--gp-muted);
        }

        @media (max-width: 980px) {
          .filters-grid {
            grid-template-columns: 1fr 1fr;
          }
        }

        @media (max-width: 560px) {
          .equip-title {
            font-size: 28px;
          }
          .equip-logo img {
            height: 76px;
          }
          .filters-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <main className="equip-root">
        <div className="equip-container">
          <div className="equip-hero">
            <div className="equip-logo">
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
            </div>
            <h1 className="equip-title">Explosão por Máquina</h1>
            <div className="equip-subtitle">
              OCs + itens por equipamento • valor tratado como <b>TOTAL da OC</b> (sem rateio por peça) • fonte:{" "}
              <b>orders_2025_raw_stage</b>
            </div>

            <div className="pill-row">
              <span className="pill">
                OCs <strong>{totals.ocCount}</strong>
              </span>
              <span className="pill">
                Itens <strong>{totals.itemCount}</strong>
              </span>
              <span className="pill">
                Total <strong>{currency.format(totals.totalValue)}</strong>
              </span>
            </div>
          </div>

          {!env.ok && (
            <div className="warn">
              Configuração no Vercel necessária: defina <b>NEXT_PUBLIC_SUPABASE_URL</b> e{" "}
              <b>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY</b> (ou <b>NEXT_PUBLIC_SUPABASE_ANON_KEY</b>).
            </div>
          )}

          {err ? <div className="warn">{err}</div> : null}

          <section className="section-card">
            <div className="section-title">Filtros</div>
            <div className="section-sub">
              Use equipamento + tipo + período. A busca livre procura também dentro dos itens e do texto original.
            </div>

            <div className="filters-grid">
              <div className="field">
                <div className="label">Equipamento</div>
                <select className="select" value={equipamento} onChange={(e) => setEquipamento(e.target.value)}>
                  <option value="">(Selecione)</option>
                  {equipmentOptions.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
                <div className="muted">{equipamento ? `Normalizado: ${normalizeEquip(equipamento)}` : " "}</div>
              </div>

              <div className="field">
                <div className="label">Tipo</div>
                <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as OrderTypeFilter)}>
                  {typeOptions.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="label">De</div>
                <input className="input" value={fromYM} onChange={(e) => setFromYM(e.target.value)} placeholder="2025-01" />
                <div className="muted">{fromYM ? asMonthLabel(fromYM) : " "}</div>
              </div>

              <div className="field">
                <div className="label">Até</div>
                <input className="input" value={toYM} onChange={(e) => setToYM(e.target.value)} placeholder="2025-12" />
                <div className="muted">{toYM ? asMonthLabel(toYM) : " "}</div>
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

              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <button className="btn" type="button" onClick={fetchData} disabled={loading || !supabase}>
                  {loading ? "Carregando..." : "Aplicar filtros"}
                </button>
              </div>
            </div>
          </section>

          <section className="section-card">
            <div className="results-head">
              <div>
                <div className="section-title">Resultados</div>
                <div className="section-sub">
                  Atenção: muitas OCs possuem várias peças, mas o valor representa o conjunto (TOTAL da OC).
                </div>
              </div>
              <div className="muted">{loading ? "Atualizando..." : `${ocs.length} OC(s)`}</div>
            </div>

            {!loading && ocs.length === 0 ? (
              <div className="empty">Nenhuma OC encontrada para os filtros atuais.</div>
            ) : (
              <div className="oc-list">
                {ocs.map((oc) => {
                  const eq = normalizeEquip(oc.codigo_equipamento) || "-";
                  const ocNum = oc.numero_oc || "-";
                  const date = oc.date || "-";
                  const time = oc.time || "";
                  const typ = oc.tipo_registro || "-";
                  const total = oc.valor_menor != null ? currency.format(oc.valor_menor) : "—";
                  const ocItems = itemsByOrderId.get(oc.id) || [];

                  return (
                    <div key={oc.id} className="oc-card">
                      <div className="oc-top">
                        <div>
                          <div className="oc-title">
                            {ocNum} • {eq}
                          </div>
                          <div className="oc-meta">
                            <span className="tag">
                              {date} {time ? `· ${time}` : ""}
                            </span>
                            <span className="tag">{typ}</span>
                            {oc.obra ? <span className="tag">Obra: {oc.obra}</span> : null}
                            {oc.operador ? <span className="tag">Operador: {oc.operador}</span> : null}
                            {oc.local_entrega ? <span className="tag">Entrega: {oc.local_entrega}</span> : null}
                          </div>
                        </div>

                        <div className="oc-total">
                          <div className="muted">Total (OC)</div>
                          <div className="val">{total}</div>
                        </div>
                      </div>

                      <div className="oc-body">
                        <div className="items-title">Peças / itens</div>

                        {ocItems.length ? (
                          ocItems.map((it) => {
                            const qty =
                              it.quantidade_texto?.trim() ||
                              (it.quantidade_num != null ? String(it.quantidade_num) : "");
                            return (
                              <div key={it.id} className="item-row">
                                <div className="qty">{qty || "—"}</div>
                                <div className="desc">{it.descricao || "—"}</div>
                              </div>
                            );
                          })
                        ) : (
                          <>
                            {/* fallback quando não existe item explodido */}
                            <div className="item-row">
                              <div className="qty">{oc.quantidade_texto || "—"}</div>
                              <div className="desc">{oc.material || "—"}</div>
                            </div>
                            <div className="muted" style={{ marginTop: 8 }}>
                              (Sem itens em <b>orders_2025_items</b> para esta OC — mostrando material/quantidade do stage.)
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="muted" style={{ textAlign: "center" }}>
            Dica: se ainda aparecer duplicado (ex: KB-02 e kb02), já está normalizando para um padrão único.
          </div>
        </div>
      </main>
    </>
  );
}
