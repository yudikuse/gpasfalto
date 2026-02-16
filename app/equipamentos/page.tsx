"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type TipoFiltro = "TODOS" | "MANUTENCAO" | "COMPRA" | "ABASTECIMENTO" | "SERVICOS" | "PECAS" | "OUTRO";

type RawRow = {
  id?: number;
  date?: string | null; // "03/12/2025"
  time?: string | null;
  mes_ano?: string | null; // "2025-12"
  tipo_registro?: string | null;
  numero_oc?: string | null;
  codigo_equipamento?: string | null;
  obra?: string | null;
  operador?: string | null;

  fornecedor_1?: string | null;
  fornecedor_2?: string | null;
  fornecedor_3?: string | null;

  valor_menor?: number | null;
  fornecedor_vencedor?: string | null;
  texto_original?: string | null;

  rn?: number | null; // do view dedup
};

type ItemRow = {
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
  orderId: number | null;
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

function getMesAno(row: RawRow) {
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

function pickFornecedor(r: RawRow) {
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

function formatQtd(it: ItemRow): string {
  const t = (it.quantidade_texto || "").trim();
  if (t) return t;
  if (it.quantidade_num != null && Number.isFinite(it.quantidade_num)) return String(it.quantidade_num);
  return "—";
}

function monthList(fromYYYYMM: string, toYYYYMM: string) {
  const [fy, fm] = fromYYYYMM.split("-").map((x) => Number(x));
  const [ty, tm] = toYYYYMM.split("-").map((x) => Number(x));
  const out: string[] = [];

  let y = fy;
  let m = fm;

  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad(m, 2)}`);
    m++;
    if (m === 13) {
      m = 1;
      y++;
    }
  }
  return out;
}

function currentYYYYMM() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}`;
}

function buildEquipOr(norm: string) {
  // EH-01 => variantes para bater em "Eh01", "EH01", "EH-01", etc
  const compact = norm.replace(/-/g, ""); // EH01
  const variants = Array.from(
    new Set([
      norm,
      compact,
      norm.replace("-", " "),
      norm.replace("-", "_"),
      norm.toLowerCase(),
      compact.toLowerCase(),
    ])
  );

  // usa %...% pq no banco pode ter espaços/dash
  const safe = (v: string) => v.replace(/[%]/g, ""); // só pra não quebrar
  return variants.map((v) => `codigo_equipamento.ilike.%${safe(v)}%`).join(",");
}

async function fetchAllRaw(
  supabase: SupabaseClient,
  args: { equipNorm: string; de: string; ate: string; tipo: TipoFiltro }
): Promise<RawRow[]> {
  const pageSize = 1000;
  const out: RawRow[] = [];
  let from = 0;

  // IMPORTANTÍSSIMO: filtra no banco (sem trazer 83k pro browser)
  while (true) {
    let q = supabase
      .from("orders_2025_raw_all_dedup_v")
      .select(
        "id,date,time,mes_ano,tipo_registro,numero_oc,codigo_equipamento,obra,operador,fornecedor_1,fornecedor_2,fornecedor_3,fornecedor_vencedor,valor_menor,texto_original,rn"
      )
      .gte("mes_ano", args.de)
      .lte("mes_ano", args.ate)
      .or(buildEquipOr(args.equipNorm))
      .range(from, from + pageSize - 1);

    // segurança extra: se por algum motivo o view vier com rn, força rn=1
    q = q.eq("rn", 1);

    if (args.tipo !== "TODOS") {
      // no banco pode estar "PEDIDO_C_..." etc, então filtra por contains via ilike
      // MANUTENCAO => %MANUT%
      const t = args.tipo === "SERVICOS" ? "SERV" : args.tipo === "ABASTECIMENTO" ? "ABASTEC" : args.tipo;
      q = q.ilike("tipo_registro", `%${t}%`);
    }

    const res = await q;
    if (res.error) throw res.error;

    const rows = (res.data || []) as any[];
    out.push(...rows);

    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 200000) break; // trava de segurança
  }

  return out;
}

async function fetchItemsByOrderIds(supabase: SupabaseClient, ids: number[]) {
  const itemsByOrder = new Map<number, ItemRow[]>();
  if (!ids.length) return itemsByOrder;

  const chunkSize = 800;
  const acc: ItemRow[] = [];

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const itRes = await supabase
      .from("orders_2025_items_all_v")
      .select("id,ordem_id,descricao,quantidade_texto,quantidade_num")
      .in("ordem_id", chunk);

    if (itRes.error) throw itRes.error;
    acc.push(...((itRes.data || []) as any[]));
  }

  // dedup de itens idênticos (evita linhas repetidas tipo "filtros de óleo 68" duplicado)
  const seen = new Set<string>();

  for (const it of acc) {
    const oid = Number(it.ordem_id);
    if (!Number.isFinite(oid)) continue;

    const key = [
      oid,
      String(it.descricao || "").trim().toLowerCase(),
      String(it.quantidade_texto || "").trim().toLowerCase(),
      it.quantidade_num == null ? "" : String(it.quantidade_num),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);

    const list = itemsByOrder.get(oid) || [];
    list.push(it);
    itemsByOrder.set(oid, list);
  }

  return itemsByOrder;
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
  const [ateMes, setAteMes] = useState<string>(currentYYYYMM());
  const [busca, setBusca] = useState<string>("");

  const [equipOptions, setEquipOptions] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);

  const monthOptions = useMemo(() => {
    // De 2025-01 até o mês atual (ex.: 2026-02)
    return monthList("2025-01", currentYYYYMM());
  }, []);

  // ====== carrega lista oficial de equipamentos ======
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

  // ====== busca / monta linhas ======
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

        if (ate < de) {
          setLines([]);
          setLoading(false);
          return;
        }

        // 1) traz somente o que precisa do VIEW DEDUP (já filtrado no banco)
        const rawRows = await fetchAllRaw(supabase, { equipNorm, de, ate, tipo });

        // 2) filtra com normalização final (garantia)
        const filtered = rawRows.filter((r) => normalizeEquip(String(r.codigo_equipamento || "")) === equipNorm);

        // ids para buscar itens
        const ids = Array.from(
          new Set(
            filtered
              .map((r) => Number(r.id))
              .filter((n) => Number.isFinite(n)) as number[]
          )
        );

        // 3) itens pelo VIEW
        const itemsByOrder = await fetchItemsByOrderIds(supabase, ids);

        // 4) monta linhas
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
              orderId: Number.isFinite(id) ? id : null,
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
                orderId: Number.isFinite(id) ? id : null,
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

  const totals = useMemo(() => {
    const orderIds = new Set<number>();
    let total = 0;

    const idToTotal = new Map<number, number>();
    for (const l of lines) {
      if (l.orderId != null) orderIds.add(l.orderId);
      if (l.orderId != null && l.totalOc != null && !idToTotal.has(l.orderId)) idToTotal.set(l.orderId, l.totalOc);
    }
    for (const v of idToTotal.values()) total += v;

    return { ordens: orderIds.size, itens: lines.length, total };
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
              Fonte: <b>orders_2025_raw_all_dedup_v</b> (rn=1) + <b>orders_2025_items_all_v</b>. Total OC é TOTAL da OC (sem rateio por peça).
            </div>

            <div className="pill-row">
              <div className="pill">
                Ordens <strong>{totals.ordens}</strong>
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
              Equipamentos vêm de <b>equipment_hours_2025</b> (lista oficial). Período filtra por <b>mes_ano</b> (YYYY-MM).
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

            <div className="muted">
              Normalização: EH01 / EH-01 / Eh01 → <b>EH-01</b>. (A busca no banco é por variações via ILIKE, depois confere pela normalização.)
            </div>
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
                      <tr key={`${l.orderId ?? "x"}-${l.oc}-${idx}-${l.whenSort}`}>
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
