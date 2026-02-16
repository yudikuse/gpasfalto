// FILE: app/equipamentos/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type TipoFiltro = "TODOS" | "MANUTENCAO" | "COMPRA" | "ABASTECIMENTO" | "SERVICOS" | "PECAS" | "OUTRO";

type RawLikeRow = {
  id?: number;
  date?: string | null; // "03/12/2025" (texto)
  time?: string | null;
  mes_ano?: string | null; // "2025-12"
  tipo_registro?: string | null;
  numero_oc?: string | null;
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

  valor_menor?: number | null; // total OC
  fornecedor_vencedor?: string | null;
  texto_original?: string | null;
};

type ItemRowDb = {
  id?: number;
  ordem_id?: number | null;
  descricao?: string | null;
  quantidade_texto?: string | null;
  quantidade_num?: number | null;
};

type Line = {
  whenSort: string; // YYYY-MM-DDTHH:mm:ss
  dateTxt: string; // dd/mm/yyyy
  timeTxt: string;
  mesAno: string; // YYYY-MM
  equipamentoNorm: string;
  equipamentoRaw: string;
  tipo: string;
  oc: string;
  item: string;
  qtd: string;
  fornecedor: string;
  totalOc: number | null;
  obra: string;
  operador: string;
  textoOriginal: string;
};

function pad(n: number, size: number) {
  const s = String(n);
  return s.length >= size ? s : "0".repeat(size - s.length) + s;
}

function currencyBRL(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function normalizeEquip(input: string) {
  const raw = (input || "").trim();
  if (!raw) return "";
  const up = raw.toUpperCase();

  const cleaned = up.replace(/\s+/g, "").replace(/_/g, "");
  const m = cleaned.match(/^([A-Z]{1,4})-?(\d{1,3})$/);
  if (m) {
    const prefix = m[1];
    const num = Number(m[2]);
    if (Number.isFinite(num)) return `${prefix}-${pad(num, 2)}`;
  }
  return cleaned.replace(/--+/g, "-");
}

// dd/mm/yyyy -> yyyy-mm-dd (se inválido, retorna null)
function brDateToISO(d: string | null | undefined) {
  const s = (d || "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy}-${pad(mm, 2)}-${pad(dd, 2)}`;
}

function getMesAno(row: RawLikeRow) {
  const ma = (row.mes_ano || "").trim();
  if (/^\d{4}-\d{2}$/.test(ma)) return ma;

  const iso = brDateToISO(row.date);
  if (iso) return iso.slice(0, 7);

  const t = (row.texto_original || "").match(/\b(20\d{2})-(\d{2})\b/);
  if (t) return `${t[1]}-${t[2]}`;

  return "";
}

function mapTipo(tipo_registro: string | null | undefined): string {
  const t = (tipo_registro || "").toUpperCase();
  if (t.includes("ABASTEC")) return "ABASTECIMENTO";
  if (t.includes("SERV")) return "SERVICOS";
  if (t.includes("PECA")) return "PECAS";
  if (t.includes("MANUT")) return "MANUTENCAO";
  if (t.includes("COMPRA")) return "COMPRA";
  return t || "OUTRO";
}

function pickFornecedor(r: RawLikeRow) {
  return (
    (r.fornecedor_vencedor || "").trim() ||
    (r.fornecedor_1 || "").trim() ||
    (r.fornecedor_2 || "").trim() ||
    (r.fornecedor_3 || "").trim() ||
    "—"
  );
}

function resolvePublicSupabase(): { url: string; key: string; ok: boolean } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const key = publishable || anon;
  return { url, key, ok: Boolean(url && key) };
}

function formatQtd(it: ItemRowDb): string {
  const t = (it.quantidade_texto || "").trim();
  if (t) return t;
  if (it.quantidade_num != null && Number.isFinite(it.quantidade_num)) return String(it.quantidade_num);
  return "—";
}

function normalizeOc(oc: string) {
  const s = (oc || "").trim();
  if (!s || s === "—") return "";
  return s.toUpperCase();
}

export default function EquipamentosComprasPage() {
  const env = resolvePublicSupabase();

  const supabase: SupabaseClient | null = useMemo(() => {
    if (!env.ok) return null;
    return createClient(env.url, env.key);
  }, [env.ok, env.url, env.key]);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [equipamento, setEquipamento] = useState<string>("");
  const [tipo, setTipo] = useState<TipoFiltro>("TODOS");
  const [deMes, setDeMes] = useState<string>("2025-01");
  const [ateMes, setAteMes] = useState<string>("2025-12");
  const [busca, setBusca] = useState<string>("");

  const [equipOptions, setEquipOptions] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);

  // meses dinâmicos (2025-01 até 2026-12), você pode estender depois sem mexer no código
  const monthOptions = useMemo(() => {
    const out: string[] = [];
    const startY = 2025;
    const endY = 2026;
    for (let y = startY; y <= endY; y++) {
      for (let m = 1; m <= 12; m++) out.push(`${y}-${pad(m, 2)}`);
    }
    return out;
  }, []);

  useEffect(() => {
    if (!supabase) return;

    (async () => {
      try {
        const res = await supabase.from("equipment_hours_2025").select("equipamento").not("equipamento", "is", null).limit(5000);
        if (res.error) throw res.error;

        const opts = Array.from(
          new Set(
            (res.data || [])
              .map((r: any) => String(r.equipamento || "").trim())
              .filter(Boolean)
              .map(normalizeEquip)
          )
        ).sort((a, b) => a.localeCompare(b));

        setEquipOptions(opts);
        if (!equipamento && opts.length) setEquipamento(opts[0]);
      } catch (e: any) {
        setEquipOptions([]);
        setErrorMsg(e?.message || "Erro ao carregar lista oficial de equipamentos (equipment_hours_2025).");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    if (!equipamento) return;

    (async () => {
      setLoading(true);
      setErrorMsg("");

      try {
        const equipNorm = normalizeEquip(equipamento);
        const de = deMes;
        const ate = ateMes;

        // >>> IMPORTANTÍSSIMO: usar as VIEWS "ALL" (e não a tabela raw/stage isolada)
        const [rawAllRes, itemsAllRes] = await Promise.all([
          supabase.from("orders_2025_raw_all_dedup_v").select("*").limit(100000),
          supabase.from("orders_2025_items_all_v").select("ordem_id,descricao,quantidade_texto,quantidade_num").limit(200000),
        ]);

        if (rawAllRes.error) throw rawAllRes.error;
        if (itemsAllRes.error) throw itemsAllRes.error;

        const all: RawLikeRow[] = (rawAllRes.data || []) as any[];

        // indexa itens por ordem_id
        const itemsByOrder = new Map<number, ItemRowDb[]>();
        (itemsAllRes.data || []).forEach((it: any) => {
          const oid = Number(it.ordem_id);
          if (!Number.isFinite(oid)) return;
          const list = itemsByOrder.get(oid) || [];
          list.push(it);
          itemsByOrder.set(oid, list);
        });

        const filtered = all.filter((r) => {
          const eq = normalizeEquip(String(r.codigo_equipamento || ""));
          if (!eq) return false;
          if (eq !== equipNorm) return false;

          const ma = getMesAno(r);
          if (!ma) return false;
          if (ma < de || ma > ate) return false;

          const t = mapTipo(r.tipo_registro);
          if (tipo !== "TODOS" && t !== tipo) return false;

          return true;
        });

        const out: Line[] = [];

        for (const r of filtered) {
          const id = Number(r.id);
          const mesAno = getMesAno(r) || "";
          const iso = brDateToISO(r.date) || (mesAno ? `${mesAno}-01` : "1970-01-01");
          const time = (r.time || "00:00:00").trim();
          const whenSort = `${iso}T${time.length >= 5 ? time : "00:00:00"}`;

          const oc = (r.numero_oc || "").trim() || "—";
          const tipoTxt = mapTipo(r.tipo_registro);
          const fornecedor = pickFornecedor(r);
          const totalOc = r.valor_menor ?? null;
          const obra = (r.obra || "").trim() || "—";
          const operador = (r.operador || "").trim() || "—";
          const textoOriginal = (r.texto_original || "").trim() || "";

          const eqRaw = String(r.codigo_equipamento || "").trim();
          const eqNorm = normalizeEquip(eqRaw);

          const its = Number.isFinite(id) ? itemsByOrder.get(id) || [] : [];

          if (!its.length) {
            out.push({
              whenSort,
              dateTxt: (r.date || "").trim() || "—",
              timeTxt: time || "—",
              mesAno: mesAno || "—",
              equipamentoNorm: eqNorm,
              equipamentoRaw: eqRaw || eqNorm,
              tipo: tipoTxt,
              oc,
              item: "(sem item cadastrado)",
              qtd: "—",
              fornecedor,
              totalOc,
              obra,
              operador,
              textoOriginal,
            });
          } else {
            its.forEach((it) => {
              out.push({
                whenSort,
                dateTxt: (r.date || "").trim() || "—",
                timeTxt: time || "—",
                mesAno: mesAno || "—",
                equipamentoNorm: eqNorm,
                equipamentoRaw: eqRaw || eqNorm,
                tipo: tipoTxt,
                oc,
                item: (it.descricao || "").trim() || "—",
                qtd: formatQtd(it),
                fornecedor,
                totalOc,
                obra,
                operador,
                textoOriginal,
              });
            });
          }
        }

        const q = busca.trim().toLowerCase();
        const searched = !q
          ? out
          : out.filter((l) => {
              return (
                l.item.toLowerCase().includes(q) ||
                l.oc.toLowerCase().includes(q) ||
                l.obra.toLowerCase().includes(q) ||
                l.fornecedor.toLowerCase().includes(q) ||
                l.textoOriginal.toLowerCase().includes(q)
              );
            });

        searched.sort((a, b) => (a.whenSort < b.whenSort ? 1 : a.whenSort > b.whenSort ? -1 : 0));

        setLines(searched);
      } catch (e: any) {
        setLines([]);
        setErrorMsg(e?.message || "Erro ao carregar relatório.");
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase, equipamento, tipo, deMes, ateMes, busca]);

  // >>> TOTAL do pill: soma por OC única (não soma repetidas por item)
  const totals = useMemo(() => {
    const ocs = new Set<string>();
    const ocToTotal = new Map<string, number>();

    for (const l of lines) {
      const ocKey = normalizeOc(l.oc);
      if (!ocKey) continue;

      ocs.add(ocKey);

      // se vier duplicado, mantém o MAIOR valor (evita erro se uma linha vier null/0 e outra vier com valor real)
      if (l.totalOc != null && Number.isFinite(l.totalOc)) {
        const prev = ocToTotal.get(ocKey);
        if (prev == null) ocToTotal.set(ocKey, l.totalOc);
        else ocToTotal.set(ocKey, Math.max(prev, l.totalOc));
      }
    }

    let total = 0;
    for (const v of ocToTotal.values()) total += v;

    return { ocs: ocs.size, itens: lines.length, total };
  }, [lines]);

  const typeOptions: { key: TipoFiltro; label: string }[] = [
    { key: "TODOS", label: "Todos" },
    { key: "MANUTENCAO", label: "Manutenção" },
    { key: "COMPRA", label: "Compra" },
    { key: "ABASTECIMENTO", label: "Abastecimento" },
    { key: "SERVICOS", label: "Serviços" },
    { key: "PECAS", label: "Peças" },
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
          padding-top: 6px;
        }
        .logo {
          display: flex;
          justify-content: center;
          margin-bottom: 10px;
        }
        .logo img {
          height: 72px;
          width: auto;
          object-fit: contain;
        }
        .title {
          margin: 0;
          font-size: 34px;
          font-weight: 800;
          letter-spacing: -0.02em;
          color: var(--gp-text);
        }
        .subtitle {
          margin-top: 8px;
          font-size: 12px;
          color: var(--gp-muted-soft);
        }
        .pill-row {
          margin-top: 10px;
          display: flex;
          justify-content: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border-radius: 999px;
          background: #fff;
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
          font-weight: 800;
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
          font-size: 14px;
          font-weight: 800;
          margin: 0;
          color: var(--gp-text);
        }
        .section-sub {
          margin-top: 4px;
          font-size: 12px;
          color: var(--gp-muted-soft);
        }
        .filters {
          display: grid;
          grid-template-columns: 260px 180px 120px 120px 1fr;
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
          font-weight: 700;
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
        .muted {
          margin-top: 10px;
          font-size: 12px;
          color: var(--gp-muted-soft);
        }
        .table-wrap {
          overflow-x: auto;
          margin-top: 10px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        thead th {
          text-align: left;
          color: var(--gp-muted);
          border-bottom: 1px solid #e5e7eb;
          padding: 10px 10px;
          white-space: nowrap;
          font-weight: 800;
          font-size: 12px;
        }
        tbody td {
          border-bottom: 1px solid #f3f4f6;
          padding: 10px 10px;
          vertical-align: top;
        }
        tbody tr:hover {
          background: #f9fafb;
        }
        .dateCell {
          white-space: nowrap;
          color: #0f172a;
          font-weight: 700;
        }
        .subDate {
          display: block;
          margin-top: 2px;
          color: var(--gp-muted-soft);
          font-size: 11px;
          font-weight: 600;
        }
        .ocCell {
          white-space: nowrap;
          font-weight: 800;
          color: #0f172a;
        }
        .right {
          text-align: right;
          white-space: nowrap;
          font-weight: 800;
        }
        @media (max-width: 980px) {
          .filters {
            grid-template-columns: 1fr 1fr;
          }
        }
        @media (max-width: 560px) {
          .title {
            font-size: 28px;
          }
          .logo img {
            height: 64px;
          }
          .filters {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <main className="page-root">
        <div className="page-container">
          <div className="hero">
            <div className="logo">
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
            </div>
            <h1 className="title">Compras Manutenção - Equipamentos</h1>
            <div className="subtitle">
              Relatório por equipamento (linha por item quando existir). <b>Total OC</b> na tabela é o total do pedido (sem rateio por peça). No topo, o <b>Total</b> soma OC única.
            </div>

            <div className="pill-row">
              <div className="pill">
                OCs <strong>{totals.ocs}</strong>
              </div>
              <div className="pill">
                Linhas <strong>{totals.itens}</strong>
              </div>
              <div className="pill">
                Total <strong>{currencyBRL(totals.total)}</strong>
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
            <h2 className="section-title">Filtros</h2>
            <div className="section-sub">
              Equipamentos vêm exclusivamente de <b>equipment_hours_2025</b> (lista oficial). Período filtra por <b>mes_ano</b> (YYYY-MM).
            </div>

            <div className="filters">
              <div className="field">
                <div className="label">Equipamento</div>
                <select className="select" value={equipamento} onChange={(e) => setEquipamento(e.target.value)}>
                  {equipOptions.map((eq) => (
                    <option key={eq} value={eq}>
                      {eq}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="label">Tipo</div>
                <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value as TipoFiltro)}>
                  {typeOptions.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="label">De</div>
                <select className="select" value={deMes} onChange={(e) => setDeMes(e.target.value)}>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="label">Até</div>
                <select className="select" value={ateMes} onChange={(e) => setAteMes(e.target.value)}>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <div className="label">Busca</div>
                <input className="input" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="OC, peça, obra, fornecedor, texto…" />
              </div>
            </div>

            <div className="muted">Normalização automática: MN07 / MN-07 / mn07 → MN-07.</div>
          </section>

          <section className="section-card">
            <h2 className="section-title">Resultados</h2>
            <div className="section-sub">Linha por item (quando existir). Se a OC não tiver itens cadastrados, aparece uma linha “(sem item cadastrado)”.</div>

            {loading ? (
              <div className="muted" style={{ marginTop: 12 }}>
                Carregando…
              </div>
            ) : lines.length === 0 ? (
              <div className="muted" style={{ marginTop: 12 }}>
                Nenhum registro encontrado para os filtros atuais.
              </div>
            ) : (
              <div className="table-wrap">
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
                      <th className="right">Total OC</th>
                      <th>Obra</th>
                      <th>Operador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, idx) => (
                      <tr key={`${l.oc}-${idx}-${l.whenSort}`}>
                        <td className="dateCell">
                          {l.dateTxt}
                          <span className="subDate">{l.timeTxt}</span>
                        </td>
                        <td>{l.equipamentoNorm}</td>
                        <td className="ocCell">{l.oc}</td>
                        <td>{l.tipo}</td>
                        <td>{l.item}</td>
                        <td>{l.qtd}</td>
                        <td>{l.fornecedor}</td>
                        <td className="right">{currencyBRL(l.totalOc)}</td>
                        <td>{l.obra}</td>
                        <td>{l.operador}</td>
                      </tr>
                    ))}
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
