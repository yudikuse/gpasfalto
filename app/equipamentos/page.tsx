// FILE: app/equipamentos/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type TipoFiltro = "TODOS" | "MANUTENCAO" | "COMPRA" | "ABASTECIMENTO" | "SERVICOS" | "PECAS" | "OUTRO";

type RawLikeRow = {
  id?: number;
  date?: string | null; // "03/12/2025"
  time?: string | null;
  mes_ano?: string | null; // "2026-02"
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

  valor_menor?: number | null; // menor preço considerado
  fornecedor_vencedor?: string | null;
  texto_original?: string | null;

  rn?: number | null;
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

// Normaliza "eh01", "EH01", "EH-01", "eh-1" => "EH-01"
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

// dd/mm/yyyy -> yyyy-mm-dd
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
  // no seu texto aparece "OC" também
  if (t === "OC") return "MANUTENCAO";
  return t || "OUTRO";
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

function approxEq(a: number, b: number, eps = 0.01) {
  return Math.abs(a - b) <= eps;
}

function cleanStr(x: any) {
  const s = String(x ?? "").trim();
  return s ? s : "";
}

// FORNECEDOR = o do menor preço considerado
function pickFornecedor(r: RawLikeRow) {
  const f1 = cleanStr(r.fornecedor_1);
  const f2 = cleanStr(r.fornecedor_2);
  const f3 = cleanStr(r.fornecedor_3);

  const p1 = typeof r.preco_1 === "number" ? r.preco_1 : null;
  const p2 = typeof r.preco_2 === "number" ? r.preco_2 : null;
  const p3 = typeof r.preco_3 === "number" ? r.preco_3 : null;

  const menor = typeof r.valor_menor === "number" ? r.valor_menor : null;

  // 1) se valor_menor bate com algum preco_i, usa fornecedor_i
  if (menor != null) {
    if (p1 != null && approxEq(menor, p1) && f1) return f1;
    if (p2 != null && approxEq(menor, p2) && f2) return f2;
    if (p3 != null && approxEq(menor, p3) && f3) return f3;
  }

  // 2) senão pega o menor entre os preços disponíveis
  const candidates: Array<{ f: string; p: number }> = [];
  if (p1 != null && f1) candidates.push({ f: f1, p: p1 });
  if (p2 != null && f2) candidates.push({ f: f2, p: p2 });
  if (p3 != null && f3) candidates.push({ f: f3, p: p3 });
  if (candidates.length) {
    candidates.sort((a, b) => a.p - b.p);
    return candidates[0].f;
  }

  // 3) fallback: fornecedor_vencedor
  const fv = cleanStr(r.fornecedor_vencedor);
  if (fv) return fv;

  // 4) fallback final: tenta extrair do texto
  const txt = cleanStr(r.texto_original);
  const m = txt.match(/Fornecedor vencedor:\s*([^\n\r]+)/i);
  if (m?.[1]) return m[1].trim();

  return "—";
}

function ymNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}`;
}

function buildMonthOptions(startYm: string, endYm: string) {
  const [sy, sm] = startYm.split("-").map(Number);
  const [ey, em] = endYm.split("-").map(Number);
  const out: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${pad(m, 2)}`);
    m++;
    if (m === 13) {
      m = 1;
      y++;
    }
  }
  return out;
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
  const [ateMes, setAteMes] = useState<string>(ymNow());
  const [busca, setBusca] = useState<string>("");

  const [equipOptions, setEquipOptions] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);

  const monthOptions = useMemo(() => buildMonthOptions("2025-01", ymNow()), []);

  // lista oficial de equipamentos
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

  // busca / monta linhas
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

        // variações comuns do código (EH-01 / EH01 / eh01)
        const rawA = equipNorm; // EH-01
        const rawB = equipNorm.replace("-", ""); // EH01
        const rawC = equipNorm.toLowerCase(); // eh-01
        const rawD = rawB.toLowerCase(); // eh01

        // ===== RAW (dedup view) =====
        // puxa já filtrado por período e equipamento (no SQL do Supa), pra não carregar o mundo
        const rawRes = await supabase
          .from("orders_2025_raw_all_dedup_v")
          .select(
            "id,date,time,mes_ano,tipo_registro,numero_oc,codigo_equipamento,obra,operador,local_entrega,fornecedor_1,fornecedor_2,fornecedor_3,preco_1,preco_2,preco_3,valor_menor,fornecedor_vencedor,texto_original,rn"
          )
          .eq("rn", 1)
          .gte("mes_ano", de)
          .lte("mes_ano", ate)
          .or(
            [
              `codigo_equipamento.ilike.${rawA}`,
              `codigo_equipamento.ilike.${rawB}`,
              `codigo_equipamento.ilike.${rawC}`,
              `codigo_equipamento.ilike.${rawD}`,
            ].join(",")
          )
          .limit(20000);

        if (rawRes.error) throw rawRes.error;

        const filtered: RawLikeRow[] = (rawRes.data || []) as any[];

        // tipo no client (pra manter regra única)
        const filteredTipo = filtered.filter((r) => {
          const t = mapTipo(r.tipo_registro);
          if (tipo !== "TODOS" && t !== tipo) return false;
          return true;
        });

        // ids para buscar itens
        const ids = Array.from(
          new Set(
            filteredTipo
              .map((r) => Number(r.id))
              .filter((n) => Number.isFinite(n)) as number[]
          )
        );

        // ===== ITENS (view) =====
        let itemsByOrder = new Map<number, ItemRowDb[]>();
        if (ids.length) {
          const chunkSize = 800;
          const acc: ItemRowDb[] = [];

          for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            const itRes = await supabase
              .from("orders_2025_items_all_v")
              .select("ordem_id,descricao,quantidade_texto,quantidade_num")
              .in("ordem_id", chunk);

            if (itRes.error) throw itRes.error;
            acc.push(...((itRes.data || []) as any[]));
          }

          const map = new Map<number, ItemRowDb[]>();
          acc.forEach((it) => {
            const oid = Number(it.ordem_id);
            if (!Number.isFinite(oid)) return;
            const list = map.get(oid) || [];
            list.push(it);
            map.set(oid, list);
          });
          itemsByOrder = map;
        }

        // monta linhas
        const out: Line[] = [];

        for (const r of filteredTipo) {
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
                totalOc, // TOTAL da OC
                obra,
                operador,
                textoOriginal,
              });
            });
          }
        }

        // busca livre
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

        // ordena por data/hora desc
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

  // TOTAL = soma OC ÚNICA (não soma repetido por item)
  const totals = useMemo(() => {
    const ocs = new Set<string>();
    let total = 0;

    const ocToTotal = new Map<string, number>();
    for (const l of lines) {
      if (l.oc && l.oc !== "—") ocs.add(l.oc);
      if (l.oc && l.oc !== "—" && l.totalOc != null && !ocToTotal.has(l.oc)) ocToTotal.set(l.oc, l.totalOc);
    }
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
          height: 92px;
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
            height: 76px;
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
              Relatório por equipamento (linha por item quando existir). Na tabela, <b>Total OC</b> é o total do pedido (sem rateio). No topo, o <b>Total</b> soma OC única.
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
            <div className="section-sub">Linha por item (quando existir). Se a OC não tiver itens cadastrados, aparece “(sem item cadastrado)”.</div>

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
