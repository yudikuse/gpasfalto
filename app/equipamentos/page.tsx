// FILE: app/equipamentos/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type OrderType =
  | "TODOS"
  | "PEDIDO_COMPRA"
  | "PEDIDO_ABASTECIMENTO"
  | "PEDIDO_COMPRA_MANUTENCAO"
  | "PEDIDO_PECAS"
  | "PEDIDO_SERVICOS"
  | "OC";

type RawStageRow = {
  id: number;
  date: string | null;
  time: string | null;
  mes_ano: string | null; // "2025-12"
  tipo_registro: string | null;
  numero_oc: string | null;

  // campos comuns (podem ser null)
  codigo_equipamento?: string | null;
  obra?: string | null;
  operador?: string | null;
  local_entrega?: string | null;

  fornecedor_1?: string | null;
  fornecedor_2?: string | null;
  fornecedor_3?: string | null;

  preco_1?: number | null;
  preco_2?: number | null;
  preco_3?: number | null;

  valor_menor?: number | null; // total da OC (tratado como total)
  fornecedor_vencedor?: string | null;

  texto_original?: string | null; // WhatsApp
};

type EquipCostRow = {
  equipamento: string | null;
};

function resolvePublicSupabase(): { url: string; key: string; ok: boolean } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const key = publishable || anon;
  return { url, key, ok: Boolean(url && key) };
}

function safeUpper(s: string) {
  return (s || "").trim().toUpperCase();
}

// Normaliza: "mn07" | "mn-07" | "MN 07" -> "MN-07"
function normalizeEquip(raw: string) {
  const s = safeUpper(raw)
    .replace(/\s+/g, "")
    .replace(/_/g, "")
    .replace(/\./g, "")
    .replace(/\//g, "")
    .replace(/-+/g, ""); // remove hífen para comparar

  if (!s) return "";

  // se ficar tipo "MN07" ou "KB02"
  const m = s.match(/^([A-Z]{1,4})(\d{1,4})$/);
  if (m) {
    const letters = m[1];
    const digits = m[2].padStart(2, "0");
    return `${letters}-${digits}`;
  }

  return s; // fallback
}

function monthToLabel(mesAno: string | null) {
  if (!mesAno) return "";
  // "2025-12" -> "12/2025"
  const parts = mesAno.split("-");
  if (parts.length !== 2) return mesAno;
  return `${parts[1]}/${parts[0]}`;
}

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function detectOrderType(tipo_registro: string | null): OrderType {
  const t = safeUpper(tipo_registro || "");
  if (!t) return "TODOS";
  if (t === "PEDIDO_COMPRA") return "PEDIDO_COMPRA";
  if (t === "PEDIDO_ABASTECIMENTO") return "PEDIDO_ABASTECIMENTO";
  if (t === "PEDIDO_COMPRA_MANUTENCAO") return "PEDIDO_COMPRA_MANUTENCAO";
  if (t === "PEDIDO_PECAS") return "PEDIDO_PECAS";
  if (t === "PEDIDO_SERVICOS") return "PEDIDO_SERVICOS";
  if (t === "OC") return "OC";
  return "TODOS";
}

// Extrai itens do texto_original (não tenta ratear valor; só lista)
function extractItensFromTexto(texto: string | null) {
  const t = (texto || "").trim();
  if (!t) return [];

  // tenta achar bloco "*📦 Itens*" até antes de "*🏷️ Cotações*" ou fim
  const lines = t.split("\n").map((x) => x.trimEnd());
  const startIdx = lines.findIndex((l) => safeUpper(l).includes("ITENS"));
  if (startIdx === -1) return [];

  const endIdx = lines.findIndex((l, idx) => idx > startIdx && safeUpper(l).includes("COTA"));
  const slice = lines.slice(startIdx + 1, endIdx === -1 ? lines.length : endIdx);

  // mantém linhas numeradas "1) ..." ou "•" etc
  const items = slice
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("*") && !safeUpper(l).includes("ITENS"));

  // se veio muito lixo, filtra para linhas com ")"
  const numbered = items.filter((l) => /^\d+\)/.test(l));
  return numbered.length ? numbered : items.slice(0, 30);
}

function inPeriod(mes_ano: string | null, from: string, to: string) {
  // from/to: "2025-01"
  if (!mes_ano) return false;
  return mes_ano >= from && mes_ano <= to;
}

export default function EquipamentosExplosaoPage() {
  const env = resolvePublicSupabase();

  // Supabase (NUNCA global)
  const supabase: SupabaseClient | null = useMemo(() => {
    if (!env.ok) return null;
    return createClient(env.url, env.key);
  }, [env.ok, env.url, env.key]);

  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [equipamento, setEquipamento] = useState<string>("");
  const [tipo, setTipo] = useState<OrderType>("TODOS");
  const [fromMesAno, setFromMesAno] = useState<string>("2025-01");
  const [toMesAno, setToMesAno] = useState<string>("2025-12");
  const [busca, setBusca] = useState<string>("");

  const [equipOptions, setEquipOptions] = useState<string[]>([]);
  const [rows, setRows] = useState<RawStageRow[]>([]);

  // load
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setErrorMsg(
        "Configuração do Supabase ausente. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY (ou NEXT_PUBLIC_SUPABASE_ANON_KEY)."
      );
      return;
    }

    (async () => {
      setLoading(true);
      setErrorMsg("");

      try {
        // 1) options de equipamento: junta equipment_costs_2025 + orders_2025_raw_stage
        const [eqRes, ocEqRes] = await Promise.all([
          supabase.from("equipment_costs_2025").select("equipamento").limit(5000),
          supabase.from("orders_2025_raw_stage").select("codigo_equipamento").limit(5000),
        ]);

        if (eqRes.error) throw eqRes.error;
        if (ocEqRes.error) throw ocEqRes.error;

        const fromCosts = ((eqRes.data || []) as unknown as EquipCostRow[])
          .map((r) => normalizeEquip(String(r.equipamento || "")))
          .filter(Boolean);

        const fromOCs = (ocEqRes.data || [])
          .map((r: any) => normalizeEquip(String(r?.codigo_equipamento || "")))
          .filter(Boolean);

        const unique = Array.from(new Set([...fromCosts, ...fromOCs])).sort((a, b) => a.localeCompare(b));
        setEquipOptions(unique);

        // default: primeiro da lista
        if (!equipamento && unique.length) setEquipamento(unique[0]);

        // 2) carrega OCs stage (colunas que existem)
        const ocRes = await supabase
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
              "fornecedor_1",
              "fornecedor_2",
              "fornecedor_3",
              "preco_1",
              "preco_2",
              "preco_3",
              "valor_menor",
              "fornecedor_vencedor",
              "texto_original",
            ].join(",")
          )
          .limit(10000);

        if (ocRes.error) throw ocRes.error;

        // ✅ FIX do seu erro de build:
        // trata como unknown antes de converter para o seu tipo (evita GenericStringError[])
        const ocRows: RawStageRow[] = Array.isArray(ocRes.data)
          ? ((ocRes.data as unknown) as RawStageRow[])
          : [];

        setRows(ocRows);
      } catch (e: any) {
        setErrorMsg(e?.message || "Erro ao carregar dados.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const filtered = useMemo(() => {
    const selectedNorm = normalizeEquip(equipamento);
    const q = safeUpper(busca).trim();

    return rows
      .filter((r) => {
        if (!inPeriod(r.mes_ano, fromMesAno, toMesAno)) return false;

        const rType = detectOrderType(r.tipo_registro);
        if (tipo !== "TODOS" && rType !== tipo) return false;

        const rEquip = normalizeEquip(String(r.codigo_equipamento || ""));
        if (selectedNorm && rEquip !== selectedNorm) return false;

        if (!q) return true;

        const hay = safeUpper(
          [
            r.numero_oc,
            r.tipo_registro,
            r.codigo_equipamento,
            r.obra,
            r.operador,
            r.local_entrega,
            r.fornecedor_1,
            r.fornecedor_2,
            r.fornecedor_3,
            r.fornecedor_vencedor,
            r.texto_original,
          ]
            .filter(Boolean)
            .join(" | ")
        );

        return hay.includes(q);
      })
      .sort((a, b) => (a.mes_ano || "").localeCompare(b.mes_ano || ""));
  }, [rows, equipamento, tipo, fromMesAno, toMesAno, busca]);

  const totals = useMemo(() => {
    let total = 0;
    let ocs = 0;
    let itens = 0;

    for (const r of filtered) {
      ocs += 1;
      total += Number(r.valor_menor || 0);

      const its = extractItensFromTexto(r.texto_original);
      itens += its.length;
    }

    return { total, ocs, itens };
  }, [filtered]);

  const typeOptions: { key: OrderType; label: string }[] = [
    { key: "TODOS", label: "Todos" },
    { key: "PEDIDO_COMPRA_MANUTENCAO", label: "Manutenção" },
    { key: "PEDIDO_ABASTECIMENTO", label: "Abastecimento" },
    { key: "PEDIDO_PECAS", label: "Peças" },
    { key: "PEDIDO_SERVICOS", label: "Serviços" },
    { key: "PEDIDO_COMPRA", label: "Compra" },
    { key: "OC", label: "OC" },
  ];

  return (
    <>
      <style jsx global>{`
        .eq-root {
          min-height: 100vh;
          background: radial-gradient(circle at top, #f9fafb 0, #f3f4f6 45%, #e5e7eb);
          display: flex;
          justify-content: center;
          padding: 32px 16px;
        }

        .eq-container {
          width: 100%;
          max-width: 1120px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .eq-hero {
          text-align: center;
          padding: 6px 14px 0;
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
          font-size: 34px;
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
          gap: 8px;
          margin-top: 10px;
          flex-wrap: wrap;
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
          font-weight: 600;
          margin: 0;
        }

        .section-subtitle {
          font-size: 0.75rem;
          color: var(--gp-muted-soft);
          margin-top: 4px;
        }

        .filters {
          display: grid;
          grid-template-columns: 280px 220px 140px 140px 1fr;
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

        .results-head {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }

        .note {
          font-size: 12px;
          color: var(--gp-muted);
          margin-top: 6px;
        }

        .list {
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .card {
          border: 1px solid #eef2f7;
          border-radius: 16px;
          padding: 14px;
          background: #ffffff;
          box-shadow: 0 10px 20px rgba(15, 23, 42, 0.03);
        }

        .card-top {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }

        .card-title {
          font-weight: 800;
          color: #0f172a;
          font-size: 14px;
        }

        .card-meta {
          font-size: 12px;
          color: var(--gp-muted);
          margin-top: 4px;
        }

        .right {
          text-align: right;
        }

        .big {
          font-weight: 900;
          color: #0f172a;
        }

        .items {
          margin-top: 10px;
          border-top: 1px dashed #e5e7eb;
          padding-top: 10px;
          font-size: 12px;
          color: #0f172a;
        }

        .items ul {
          margin: 8px 0 0 18px;
        }

        .mono {
          white-space: pre-wrap;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
            "Courier New", monospace;
          font-size: 12px;
          color: #0f172a;
          margin-top: 10px;
          border-top: 1px dashed #e5e7eb;
          padding-top: 10px;
        }

        @media (max-width: 980px) {
          .filters {
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (max-width: 560px) {
          .eq-title {
            font-size: 28px;
          }
          .eq-logo img {
            height: 76px;
          }
          .filters {
            grid-template-columns: 1fr;
          }
          .right {
            text-align: left;
          }
        }
      `}</style>

      <main className="eq-root">
        <div className="eq-container">
          <div className="eq-hero">
            <div className="eq-logo">
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
            </div>
            <h1 className="eq-title">Explosão por Máquina</h1>
            <div className="eq-subtitle">
              OCs + itens por equipamento • valor tratado como <b>TOTAL da OC</b> (sem rateio por peça) • fonte:{" "}
              <b>orders_2025_raw_stage</b>
            </div>

            <div className="pill-row">
              <div className="pill">
                OCs <strong>{totals.ocs}</strong>
              </div>
              <div className="pill">
                Itens <strong>{totals.itens}</strong>
              </div>
              <div className="pill">
                Total <strong>{currency.format(totals.total)}</strong>
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
            <div className="results-head">
              <div>
                <div className="section-title">Filtros</div>
                <div className="section-subtitle">
                  Use equipamento + tipo + período. A busca livre procura também dentro do texto original.
                </div>
              </div>
            </div>

            <div className="filters">
              <div className="field">
                <div className="label">Equipamento</div>
                <select className="select" value={equipamento} onChange={(e) => setEquipamento(e.target.value)}>
                  {!equipOptions.length ? <option value="">(Carregando...)</option> : null}
                  {equipOptions.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="label">Tipo</div>
                <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as OrderType)}>
                  {typeOptions.map((x) => (
                    <option key={x.key} value={x.key}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="label">De</div>
                <input className="input" value={fromMesAno} onChange={(e) => setFromMesAno(e.target.value)} />
              </div>

              <div className="field">
                <div className="label">Até</div>
                <input className="input" value={toMesAno} onChange={(e) => setToMesAno(e.target.value)} />
              </div>

              <div className="field">
                <div className="label">Busca</div>
                <input
                  className="input"
                  placeholder="OC, peça, obra, fornecedor, texto..."
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="section-card">
            <div className="results-head">
              <div>
                <div className="section-title">Resultados</div>
                <div className="section-subtitle">
                  Atenção: muitas OCs possuem várias peças, mas o valor representa o conjunto (TOTAL da OC).
                </div>
              </div>
              <div className="note">{loading ? "Carregando..." : `${filtered.length} OCs no filtro`}</div>
            </div>

            {!loading && filtered.length === 0 ? (
              <div className="note" style={{ marginTop: 10 }}>
                Nenhuma OC encontrada para os filtros atuais.
              </div>
            ) : (
              <div className="list">
                {filtered.map((r) => {
                  const it = extractItensFromTexto(r.texto_original);
                  const rType = detectOrderType(r.tipo_registro);
                  const total = Number(r.valor_menor || 0);
                  return (
                    <div key={r.id} className="card">
                      <div className="card-top">
                        <div>
                          <div className="card-title">
                            {r.numero_oc || "(sem OC)"} • {rType} • {normalizeEquip(String(r.codigo_equipamento || ""))}
                          </div>
                          <div className="card-meta">
                            {monthToLabel(r.mes_ano)} • {r.date || "-"} {r.time || ""}
                            {r.obra ? ` • Obra: ${r.obra}` : ""}
                            {r.operador ? ` • Operador: ${r.operador}` : ""}
                            {r.local_entrega ? ` • Entrega: ${r.local_entrega}` : ""}
                          </div>
                          {(r.fornecedor_vencedor || r.fornecedor_1 || r.fornecedor_2 || r.fornecedor_3) && (
                            <div className="card-meta">
                              Fornecedor:{" "}
                              <b>{r.fornecedor_vencedor || r.fornecedor_1 || r.fornecedor_2 || r.fornecedor_3}</b>
                            </div>
                          )}
                        </div>

                        <div className="right">
                          <div className="card-meta">Total OC</div>
                          <div className="big">{currency.format(total)}</div>
                          <div className="card-meta">Itens: {it.length}</div>
                        </div>
                      </div>

                      {it.length > 0 && (
                        <div className="items">
                          <div className="card-meta" style={{ margin: 0 }}>
                            Itens (extraídos do WhatsApp):
                          </div>
                          <ul>
                            {it.slice(0, 25).map((x, idx) => (
                              <li key={idx}>{x}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {r.texto_original ? (
                        <details style={{ marginTop: 10 }}>
                          <summary style={{ cursor: "pointer", color: "#111827", fontWeight: 700 }}>
                            Ver texto original (WhatsApp)
                          </summary>
                          <div className="mono">{r.texto_original}</div>
                        </details>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="note" style={{ textAlign: "center" }}>
            Dica: essa tela já trata <b>MN07 / MN-07 / MN 07</b> como <b>MN-07</b>.
          </div>
        </div>
      </main>
    </>
  );
}
