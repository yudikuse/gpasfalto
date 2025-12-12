"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type OrderType =
  | "COMPRA"
  | "ABASTECIMENTO"
  | "MANUTENCAO"
  | "SERVICOS"
  | "PECAS"
  | "OUTRO";

type ItemRow = {
  qtd: string; // mascarado (inteiro)
  descricao: string;
  valor: string; // mascarado (R$)
};

function pad(n: number, size: number) {
  const s = String(n);
  return s.length >= size ? s : "0".repeat(size - s.length) + s;
}

function nowDateBr() {
  const d = new Date();
  const dd = pad(d.getDate(), 2);
  const mm = pad(d.getMonth() + 1, 2);
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function nowTime() {
  const d = new Date();
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(
    d.getSeconds(),
    2
  )}`;
}

function mesAno() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}`;
}

function onlyDigits(s: string) {
  return (s || "").replace(/[^\d]/g, "");
}

function normalizeDecimalPtBR(input: string) {
  let s = (input || "").replace(/[^\d,]/g, "");
  const parts = s.split(",");
  if (parts.length > 2) s = parts[0] + "," + parts.slice(1).join("");
  const [a, b] = s.split(",");
  const dec = (b || "").slice(0, 2);
  return dec.length ? `${a || "0"},${dec}` : a || "";
}

function formatBRLFromNumber(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseBRLToNumber(value: string) {
  if (!value) return null;
  const s = value
    .replace(/\s/g, "")
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function formatBRLFromDigits(digits: string) {
  const d = digits.replace(/[^\d]/g, "");
  if (!d) return "";
  const cents = Number(d);
  const n = cents / 100;
  return formatBRLFromNumber(n);
}

function toWhatsappText(lines: string[]) {
  return lines.filter(Boolean).join("\n");
}

export default function OCPage() {
  const [tipo, setTipo] = useState<OrderType>("MANUTENCAO");

  // cabeçalho
  const [idGerado, setIdGerado] = useState<string>("-");
  const [numeroOC, setNumeroOC] = useState<string>("");

  // campos base
  const [equipamento, setEquipamento] = useState<string>("");
  const [obra, setObra] = useState<string>("");
  const [operador, setOperador] = useState<string>("");
  const [horimetro, setHorimetro] = useState<string>("");
  const [localEntrega, setLocalEntrega] = useState<string>("");
  const [observacoes, setObservacoes] = useState<string>("");

  // fornecedores
  const [qtdFornecedores, setQtdFornecedores] = useState<number>(1);
  const [forn1, setForn1] = useState<string>("");
  const [forn2, setForn2] = useState<string>("");
  const [forn3, setForn3] = useState<string>("");
  const [preco1, setPreco1] = useState<string>("");
  const [preco2, setPreco2] = useState<string>("");
  const [preco3, setPreco3] = useState<string>("");

  const [items, setItems] = useState<ItemRow[]>([]);
  const [expandedPreview, setExpandedPreview] = useState<boolean>(false);

  const [equipmentOptions, setEquipmentOptions] = useState<string[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<string[]>([]);

  const [saving, setSaving] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [savedOrderId, setSavedOrderId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // ✅ Lazy init do Supabase (evita quebrar no build/prerender)
  const supabase = useMemo<SupabaseClient | null>(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    return createClient(url, key);
  }, []);

  // ====== load defaults (OC sequencial + listas) ======
  useEffect(() => {
    (async () => {
      if (!supabase) return;

      // 1) OC sequencial
      try {
        const { data } = await supabase
          .from("orders_2025_raw")
          .select("numero_oc")
          .not("numero_oc", "is", null)
          .order("id", { ascending: false })
          .limit(50);

        const last = (data || [])
          .map((r: any) => String(r.numero_oc || ""))
          .find((x) => x.toUpperCase().startsWith("OC"));

        let nextNum = 20000;
        if (last) {
          const digits = onlyDigits(last);
          if (digits) nextNum = Number(digits) + 1;
        }
        setNumeroOC(`OC${nextNum}`);
      } catch {
        setNumeroOC("OC20000");
      }

      // 2) equipamentos
      try {
        const { data } = await supabase
          .from("equipment_hours")
          .select("codigo_equipamento")
          .not("codigo_equipamento", "is", null);

        const opts = Array.from(
          new Set(
            (data || [])
              .map((r: any) => String(r.codigo_equipamento).trim())
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b));
        setEquipmentOptions(opts);
      } catch {
        setEquipmentOptions([]);
      }

      // 3) fornecedores
      try {
        const { data } = await supabase
          .from("orders_2025_raw")
          .select("fornecedor_1,fornecedor_2,fornecedor_3")
          .limit(700)
          .order("id", { ascending: false });

        const all = (data || []).flatMap((r: any) => [
          r.fornecedor_1,
          r.fornecedor_2,
          r.fornecedor_3,
        ]);

        const opts = Array.from(
          new Set(all.map((x) => String(x || "").trim()).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));

        setSupplierOptions(opts);
      } catch {
        setSupplierOptions([]);
      }
    })();
  }, [supabase]);

  // ====== computed: menor preço + vencedor ======
  const computed = useMemo(() => {
    const p1 = parseBRLToNumber(preco1);
    const p2 = parseBRLToNumber(preco2);
    const p3 = parseBRLToNumber(preco3);

    const candidates: { idx: 1 | 2 | 3; price: number; supplier: string }[] =
      [];
    if (p1 !== null && forn1.trim())
      candidates.push({ idx: 1, price: p1, supplier: forn1.trim() });
    if (qtdFornecedores >= 2 && p2 !== null && forn2.trim())
      candidates.push({ idx: 2, price: p2, supplier: forn2.trim() });
    if (qtdFornecedores >= 3 && p3 !== null && forn3.trim())
      candidates.push({ idx: 3, price: p3, supplier: forn3.trim() });

    candidates.sort((a, b) => a.price - b.price);
    const winner = candidates[0] || null;

    return {
      valorMenor: winner ? winner.price : null,
      fornecedorVencedor: winner ? winner.supplier : null,
    };
  }, [preco1, preco2, preco3, forn1, forn2, forn3, qtdFornecedores]);

  // ====== preview whatsapp ======
  const whatsappPreview = useMemo(() => {
    const titulo =
      tipo === "ABASTECIMENTO"
        ? "*🛢️ PEDIDO DE ABASTECIMENTO*"
        : tipo === "MANUTENCAO"
        ? "*🛠️ PEDIDO DE MANUTENÇÃO*"
        : tipo === "PECAS"
        ? "*🔧 PEDIDO DE PEÇAS*"
        : tipo === "SERVICOS"
        ? "*🧾 PEDIDO DE SERVIÇOS*"
        : tipo === "COMPRA"
        ? "*🛒 PEDIDO DE COMPRA*"
        : "*📌 PEDIDO*";

    const header = [
      titulo,
      `*OC:* ${numeroOC || "-"}`,
      `*Data:* ${nowDateBr()} ${nowTime()}`,
      "",
      "*📍 Dados*",
      `• *Equipamento:* ${equipamento || "-"}`,
      `• *Obra:* ${obra || "-"}`,
      `• *Operador:* ${operador || "-"}`,
      `• *Horímetro:* ${horimetro ? `${horimetro} h` : "-"}`,
      `• *Entrega:* ${localEntrega || "-"}`,
    ];

    const obsBlock = observacoes?.trim()
      ? ["", "*📝 Observações*", observacoes.trim()]
      : [];

    const itLines: string[] = [];
    if (items.length) {
      itLines.push("", "*📦 Itens*");
      items.forEach((it, i) => {
        const q = it.qtd || "-";
        const d = it.descricao || "-";
        const v = it.valor || "";
        const vTxt = v ? ` — ${v}` : "";
        itLines.push(`${i + 1}) ${q}x ${d}${vTxt}`);
      });
    }

    const fornLines: string[] = [];
    if (tipo === "MANUTENCAO") {
      fornLines.push("", "*🏷️ Cotações*");
      fornLines.push(`1) ${forn1.trim() || "-"} ${preco1 ? `— ${preco1}` : ""}`.trim());
      if (qtdFornecedores >= 2)
        fornLines.push(`2) ${forn2.trim() || "-"} ${preco2 ? `— ${preco2}` : ""}`.trim());
      if (qtdFornecedores >= 3)
        fornLines.push(`3) ${forn3.trim() || "-"} ${preco3 ? `— ${preco3}` : ""}`.trim());

      fornLines.push(
        "",
        `*✅ Aprovado automático:* SIM`,
        `*💰 Menor preço considerado:* ${
          computed.valorMenor !== null ? formatBRLFromNumber(computed.valorMenor) : "-"
        }`
      );
      if (computed.fornecedorVencedor) {
        fornLines.push(`*🏆 Fornecedor vencedor:* ${computed.fornecedorVencedor}`);
      }
    }

    return toWhatsappText([...header, ...obsBlock, ...itLines, ...fornLines]).trim();
  }, [
    tipo,
    numeroOC,
    equipamento,
    obra,
    operador,
    horimetro,
    localEntrega,
    observacoes,
    items,
    qtdFornecedores,
    forn1,
    forn2,
    forn3,
    preco1,
    preco2,
    preco3,
    computed.valorMenor,
    computed.fornecedorVencedor,
  ]);

  function addItem() {
    setItems((prev) => [...prev, { qtd: "", descricao: "", valor: "" }]);
    setSaved(false);
    setSavedOrderId(null);
    setIdGerado("-");
  }

  function updateItem(i: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    setSaved(false);
    setSavedOrderId(null);
    setIdGerado("-");
  }

  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
    setSaved(false);
    setSavedOrderId(null);
    setIdGerado("-");
  }

  async function copyText() {
    await navigator.clipboard.writeText(whatsappPreview);
  }

  function openWhatsapp() {
    const url = `https://wa.me/?text=${encodeURIComponent(whatsappPreview)}`;
    window.open(url, "_blank");
  }

  async function saveOrder() {
    setErrorMsg("");

    if (!supabase) {
      setErrorMsg(
        "Variáveis do Supabase não configuradas no deploy (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)."
      );
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        date: nowDateBr(),
        time: nowTime(),
        mes_ano: mesAno(),

        tipo_registro:
          tipo === "MANUTENCAO"
            ? "PEDIDO_COMPRA_MANUTENCAO"
            : tipo === "ABASTECIMENTO"
            ? "PEDIDO_ABASTECIMENTO"
            : tipo === "PECAS"
            ? "PEDIDO_PECAS"
            : tipo === "SERVICOS"
            ? "PEDIDO_SERVICOS"
            : tipo === "COMPRA"
            ? "PEDIDO_COMPRA"
            : "OC",

        numero_oc: numeroOC || null,
        codigo_equipamento: equipamento || null,
        obra: obra || null,
        operador: operador || null,
        horimetro: horimetro || null,
        local_entrega: localEntrega || null,
        observacoes: observacoes || null,

        texto_original: whatsappPreview,

        aprovado_auto: true,

        fornecedor_1: tipo === "MANUTENCAO" ? (forn1 || null) : null,
        fornecedor_2: tipo === "MANUTENCAO" && qtdFornecedores >= 2 ? (forn2 || null) : null,
        fornecedor_3: tipo === "MANUTENCAO" && qtdFornecedores >= 3 ? (forn3 || null) : null,

        preco_1: tipo === "MANUTENCAO" ? parseBRLToNumber(preco1) : null,
        preco_2: tipo === "MANUTENCAO" && qtdFornecedores >= 2 ? parseBRLToNumber(preco2) : null,
        preco_3: tipo === "MANUTENCAO" && qtdFornecedores >= 3 ? parseBRLToNumber(preco3) : null,

        valor_menor: tipo === "MANUTENCAO" ? computed.valorMenor : null,
        fornecedor_vencedor: tipo === "MANUTENCAO" ? computed.fornecedorVencedor : null,
      };

      const { data: inserted, error: err1 } = await supabase
        .from("orders_2025_raw")
        .insert(payload)
        .select("id")
        .single();

      if (err1) throw err1;

      const orderId = inserted?.id as number;
      setSavedOrderId(orderId);
      setIdGerado(String(orderId));

      if (items.length) {
        const rows = items.map((it) => ({
          ordem_id: orderId,
          quantidade: it.qtd ? Number(onlyDigits(it.qtd)) : null,
          descricao: it.descricao || null,
          valor: parseBRLToNumber(it.valor),
        }));

        const { error: err2 } = await supabase.from("orders_2025_items").insert(rows);
        if (err2) throw err2;
      }

      setSaved(true);
    } catch (e: any) {
      setSaved(false);
      setSavedOrderId(null);
      setIdGerado("-");
      setErrorMsg(e?.message || "Erro ao salvar no Supabase.");
    } finally {
      setSaving(false);
    }
  }

  const typeButtons = [
    { key: "COMPRA" as const, label: "Compra", icon: "shopping_cart" },
    { key: "ABASTECIMENTO" as const, label: "Abastecimento", icon: "local_gas_station" },
    { key: "MANUTENCAO" as const, label: "Manutenção", icon: "build" },
    { key: "SERVICOS" as const, label: "Serviços", icon: "receipt_long" },
    { key: "PECAS" as const, label: "Peças", icon: "settings" },
    { key: "OUTRO" as const, label: "Outro", icon: "add" },
  ];

  return (
    <>
      {/* Material Symbols (Google) */}
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0");
        .msi {
          font-family: "Material Symbols Outlined";
          font-weight: 300;
          font-style: normal;
          font-size: 22px;
          line-height: 1;
          display: inline-block;
          -webkit-font-feature-settings: "liga";
          -webkit-font-smoothing: antialiased;
          color: var(--gp-muted);
        }
        .oc-root {
          min-height: 100vh;
          background: radial-gradient(circle at top, #f9fafb 0, #f3f4f6 45%, #e5e7eb);
          display: flex;
          justify-content: center;
          padding: 34px 16px 46px;
        }
        .oc-container {
          width: 100%;
          max-width: 760px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .oc-hero {
          text-align: center;
          padding: 8px 14px 0;
        }
        .oc-logo {
          display: flex;
          justify-content: center;
          margin-bottom: 12px;
        }
        .oc-logo img {
          height: 108px;
          width: auto;
          display: block;
          object-fit: contain;
        }
        .oc-title {
          margin: 0;
          font-size: 34px;
          font-weight: 750;
          letter-spacing: -0.02em;
          color: var(--gp-text);
        }
        .oc-subtitle {
          margin-top: 6px;
          font-size: 13px;
          color: var(--gp-muted-soft);
        }
        .section-card {
          border-radius: 18px;
          padding: 18px 20px;
          background: var(--gp-surface);
          box-shadow: 0 16px 36px rgba(15, 23, 42, 0.06);
        }
        .section-title {
          font-size: 14px;
          font-weight: 700;
          margin: 0;
          color: var(--gp-text);
        }
        .section-sub {
          margin-top: 4px;
          font-size: 12px;
          color: var(--gp-muted-soft);
        }
        .type-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }
        .type-btn {
          border: 1px solid #e5e7eb;
          background: #fff;
          border-radius: 14px;
          padding: 14px 10px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          box-shadow: 0 10px 24px rgba(15, 23, 42, 0.04);
          transition: transform 0.04s ease, border-color 0.08s ease, background 0.08s ease;
        }
        .type-btn:hover {
          transform: translateY(-1px);
        }
        .type-btn strong {
          font-size: 13px;
          font-weight: 650;
          color: var(--gp-text);
        }
        .type-btn.active {
          border-color: #10b981;
          background: #ecfdf5;
          box-shadow: 0 14px 34px rgba(16, 185, 129, 0.12);
        }
        .grid-2 {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-top: 12px;
        }
        .field {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }
        .label {
          font-size: 12px;
          font-weight: 650;
          color: #111827;
        }
        .input,
        .textarea,
        .select {
          width: 100%;
          border: 1px solid #e5e7eb;
          background: #fff;
          border-radius: 12px;
          padding: 12px 12px;
          font-size: 14px;
          outline: none;
        }
        .input:focus,
        .textarea:focus,
        .select:focus {
          border-color: #cbd5e1;
          box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.15);
        }
        .textarea {
          min-height: 106px;
          resize: vertical;
        }
        .row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .muted {
          font-size: 12px;
          color: var(--gp-muted-soft);
        }
        .items-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          margin-top: 4px;
        }
        .btn-add {
          width: 100%;
          border: 1px dashed #a7f3d0;
          background: #ecfdf5;
          color: #047857;
          border-radius: 14px;
          padding: 12px;
          font-weight: 800;
          cursor: pointer;
        }
        .item-card {
          margin-top: 12px;
          border: 1px solid #eef2f7;
          border-radius: 16px;
          padding: 16px;
          background: #ffffff;
          box-shadow: 0 10px 20px rgba(15, 23, 42, 0.03);
        }
        .item-row {
          display: grid;
          grid-template-columns: 140px 1fr;
          gap: 12px;
        }
        .item-row-2 {
          display: grid;
          grid-template-columns: 1fr 140px;
          gap: 12px;
          margin-top: 12px;
          align-items: end;
        }
        .btn-remove {
          border: 1px solid #e5e7eb;
          background: #fff;
          border-radius: 12px;
          padding: 12px 12px;
          cursor: pointer;
          color: var(--gp-muted);
          font-weight: 700;
        }
        .preview-toggle {
          width: 100%;
          border: 1px solid #a7f3d0;
          background: #ecfdf5;
          border-radius: 14px;
          padding: 12px;
          cursor: pointer;
          font-weight: 800;
          color: #047857;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .preview-box {
          margin-top: 12px;
          border: 1px solid #eef2f7;
          border-radius: 16px;
          background: #ffffff;
          padding: 14px;
          white-space: pre-wrap;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
            "Courier New", monospace;
          font-size: 13px;
          line-height: 1.5;
          color: #0f172a;
        }
        .actions {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
        }
        .btn-primary {
          border: none;
          background: #059669;
          color: #fff;
          border-radius: 14px;
          padding: 13px 14px;
          font-weight: 900;
          cursor: pointer;
        }
        .btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .btn-secondary {
          border: 1px solid #e5e7eb;
          background: #fff;
          border-radius: 14px;
          padding: 13px 14px;
          font-weight: 900;
          cursor: pointer;
          color: #0f172a;
        }
        .btn-whats {
          border: none;
          background: #22c55e;
          color: #fff;
          border-radius: 14px;
          padding: 13px 14px;
          font-weight: 950;
          cursor: pointer;
        }
        .err {
          margin-top: 10px;
          color: #b91c1c;
          font-size: 13px;
          font-weight: 700;
        }
        @media (max-width: 560px) {
          .oc-title {
            font-size: 28px;
          }
          .row,
          .grid-2 {
            grid-template-columns: 1fr;
          }
          .item-row,
          .item-row-2 {
            grid-template-columns: 1fr;
          }
          .oc-logo img {
            height: 92px;
          }
        }
      `}</style>

      <main className="oc-root">
        <div className="oc-container">
          <div className="oc-hero">
            <div className="oc-logo">
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
            </div>
            <h1 className="oc-title">Registrar OC</h1>
            <div className="oc-subtitle">Criar OC rápida e padrão para WhatsApp</div>
          </div>

          {!supabase ? (
            <section className="section-card">
              <h2 className="section-title">Configuração necessária</h2>
              <div className="section-sub" style={{ marginTop: 8 }}>
                Configure no Vercel as variáveis:
                <br />
                <strong>NEXT_PUBLIC_SUPABASE_URL</strong> e{" "}
                <strong>NEXT_PUBLIC_SUPABASE_ANON_KEY</strong>
              </div>
            </section>
          ) : null}

          {/* Tipo */}
          <section className="section-card">
            <h2 className="section-title">Tipo de Pedido</h2>
            <div className="type-grid">
              {typeButtons.map((b) => (
                <button
                  key={b.key}
                  className={`type-btn ${tipo === b.key ? "active" : ""}`}
                  onClick={() => {
                    setTipo(b.key);
                    setSaved(false);
                    setSavedOrderId(null);
                    setIdGerado("-");
                  }}
                  type="button"
                >
                  <span className="msi">{b.icon}</span>
                  <strong>{b.label}</strong>
                </button>
              ))}
            </div>
          </section>

          {/* Dados */}
          <section className="section-card">
            <div className="items-header">
              <div>
                <h2 className="section-title">Dados Essenciais</h2>
                <div className="section-sub">Padrão: Manutenção</div>
              </div>
              <div className="muted">Salva no Supabase</div>
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <div className="field">
                <div className="label">ID</div>
                <input className="input" value={idGerado} disabled />
              </div>

              <div className="field">
                <div className="label">OC</div>
                <input
                  className="input"
                  value={numeroOC}
                  onChange={(e) => {
                    setNumeroOC(e.target.value);
                    setSaved(false);
                    setSavedOrderId(null);
                    setIdGerado("-");
                  }}
                  placeholder="OC20337"
                />
              </div>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <div className="label">Equipamento</div>
              <input
                className="input"
                value={equipamento}
                onChange={(e) => {
                  setEquipamento(e.target.value);
                  setSaved(false);
                  setSavedOrderId(null);
                  setIdGerado("-");
                }}
                placeholder="Digite ou selecione o equipamento"
                list="equipList"
              />
              <datalist id="equipList">
                {equipmentOptions.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </div>

            <div className="grid-2">
              <div className="field">
                <div className="label">Obra</div>
                <input
                  className="input"
                  value={obra}
                  onChange={(e) => {
                    setObra(e.target.value);
                    setSaved(false);
                    setSavedOrderId(null);
                    setIdGerado("-");
                  }}
                  placeholder="Nome da obra"
                />
              </div>

              <div className="field">
                <div className="label">Operador</div>
                <input
                  className="input"
                  value={operador}
                  onChange={(e) => {
                    setOperador(e.target.value);
                    setSaved(false);
                    setSavedOrderId(null);
                    setIdGerado("-");
                  }}
                  placeholder="Nome do operador"
                />
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <div className="label">Horímetro</div>
                <input
                  className="input"
                  inputMode="decimal"
                  value={horimetro}
                  onChange={(e) => {
                    setHorimetro(normalizeDecimalPtBR(e.target.value));
                    setSaved(false);
                    setSavedOrderId(null);
                    setIdGerado("-");
                  }}
                  placeholder="Ex: 1234,50"
                />
              </div>

              <div className="field">
                <div className="label">Local de entrega</div>
                <input
                  className="input"
                  value={localEntrega}
                  onChange={(e) => {
                    setLocalEntrega(e.target.value);
                    setSaved(false);
                    setSavedOrderId(null);
                    setIdGerado("-");
                  }}
                  placeholder="Endereço ou local"
                />
              </div>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <div className="label">Observações</div>
              <textarea
                className="textarea"
                value={observacoes}
                onChange={(e) => {
                  setObservacoes(e.target.value);
                  setSaved(false);
                  setSavedOrderId(null);
                  setIdGerado("-");
                }}
                placeholder="Informações adicionais..."
              />
            </div>

            {tipo === "MANUTENCAO" && (
              <div style={{ marginTop: 14 }}>
                <div className="items-header">
                  <div>
                    <div className="label" style={{ marginBottom: 4 }}>
                      Fornecedores (cotações)
                    </div>
                    <div className="muted">
                      Escolha 1–3 fornecedores e informe os preços.
                    </div>
                  </div>

                  <div className="field" style={{ width: 150 }}>
                    <div className="label">Qtd</div>
                    <select
                      className="select"
                      value={qtdFornecedores}
                      onChange={(e) => {
                        setQtdFornecedores(Number(e.target.value));
                        setSaved(false);
                        setSavedOrderId(null);
                        setIdGerado("-");
                      }}
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                    </select>
                  </div>
                </div>

                <div className="grid-2" style={{ marginTop: 10 }}>
                  <div className="field">
                    <div className="label">Fornecedor 1</div>
                    <input
                      className="input"
                      value={forn1}
                      onChange={(e) => {
                        setForn1(e.target.value);
                        setSaved(false);
                        setSavedOrderId(null);
                        setIdGerado("-");
                      }}
                      list="supList"
                      placeholder="Digite ou selecione"
                    />
                  </div>
                  <div className="field">
                    <div className="label">Preço 1</div>
                    <input
                      className="input"
                      inputMode="numeric"
                      value={preco1}
                      onChange={(e) => {
                        setPreco1(formatBRLFromDigits(onlyDigits(e.target.value)));
                        setSaved(false);
                        setSavedOrderId(null);
                        setIdGerado("-");
                      }}
                      placeholder="R$ 0,00"
                    />
                  </div>

                  {qtdFornecedores >= 2 && (
                    <>
                      <div className="field">
                        <div className="label">Fornecedor 2</div>
                        <input
                          className="input"
                          value={forn2}
                          onChange={(e) => {
                            setForn2(e.target.value);
                            setSaved(false);
                            setSavedOrderId(null);
                            setIdGerado("-");
                          }}
                          list="supList"
                          placeholder="Digite ou selecione"
                        />
                      </div>
                      <div className="field">
                        <div className="label">Preço 2</div>
                        <input
                          className="input"
                          inputMode="numeric"
                          value={preco2}
                          onChange={(e) => {
                            setPreco2(formatBRLFromDigits(onlyDigits(e.target.value)));
                            setSaved(false);
                            setSavedOrderId(null);
                            setIdGerado("-");
                          }}
                          placeholder="R$ 0,00"
                        />
                      </div>
                    </>
                  )}

                  {qtdFornecedores >= 3 && (
                    <>
                      <div className="field">
                        <div className="label">Fornecedor 3</div>
                        <input
                          className="input"
                          value={forn3}
                          onChange={(e) => {
                            setForn3(e.target.value);
                            setSaved(false);
                            setSavedOrderId(null);
                            setIdGerado("-");
                          }}
                          list="supList"
                          placeholder="Digite ou selecione"
                        />
                      </div>
                      <div className="field">
                        <div className="label">Preço 3</div>
                        <input
                          className="input"
                          inputMode="numeric"
                          value={preco3}
                          onChange={(e) => {
                            setPreco3(formatBRLFromDigits(onlyDigits(e.target.value)));
                            setSaved(false);
                            setSavedOrderId(null);
                            setIdGerado("-");
                          }}
                          placeholder="R$ 0,00"
                        />
                      </div>
                    </>
                  )}
                </div>

                <datalist id="supList">
                  {supplierOptions.map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>

                <div className="muted" style={{ marginTop: 10 }}>
                  Menor preço considerado:{" "}
                  <strong style={{ color: "#0f172a" }}>
                    {computed.valorMenor !== null
                      ? formatBRLFromNumber(computed.valorMenor)
                      : "-"}
                  </strong>
                  {computed.fornecedorVencedor ? (
                    <>
                      {" "}
                      • Vencedor:{" "}
                      <strong style={{ color: "#0f172a" }}>
                        {computed.fornecedorVencedor}
                      </strong>
                    </>
                  ) : null}
                </div>
              </div>
            )}
          </section>

          {/* Itens */}
          <section className="section-card">
            <h2 className="section-title">Itens da ordem</h2>

            <div style={{ marginTop: 12 }}>
              <button className="btn-add" type="button" onClick={addItem}>
                + Adicionar item
              </button>

              {!items.length ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  Nenhum item adicionado ainda.
                </div>
              ) : (
                items.map((it, idx) => (
                  <div key={idx} className="item-card">
                    <div className="item-row">
                      <div className="field">
                        <div className="label">Quantidade</div>
                        <input
                          className="input"
                          inputMode="numeric"
                          value={it.qtd}
                          onChange={(e) => {
                            const v = onlyDigits(e.target.value).slice(0, 6);
                            updateItem(idx, { qtd: v });
                          }}
                          placeholder="Ex: 2"
                        />
                      </div>

                      <div className="field">
                        <div className="label">Descrição</div>
                        <input
                          className="input"
                          value={it.descricao}
                          onChange={(e) => updateItem(idx, { descricao: e.target.value })}
                          placeholder="Ex: mangueira hidráulica"
                        />
                      </div>
                    </div>

                    <div className="item-row-2">
                      <div className="field">
                        <div className="label">Valor (opcional)</div>
                        <input
                          className="input"
                          inputMode="numeric"
                          value={it.valor}
                          onChange={(e) => {
                            const brl = formatBRLFromDigits(onlyDigits(e.target.value));
                            updateItem(idx, { valor: brl });
                          }}
                          placeholder="R$ 0,00"
                        />
                      </div>

                      <button className="btn-remove" type="button" onClick={() => removeItem(idx)}>
                        Remover
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Preview + ações */}
          <section className="section-card">
            <button
              className="preview-toggle"
              type="button"
              onClick={() => setExpandedPreview((v) => !v)}
            >
              <span>Prévia da mensagem (WhatsApp)</span>
              <span className="muted">{expandedPreview ? "Recolher ▲" : "Mostrar ▼"}</span>
            </button>

            {expandedPreview && <div className="preview-box">{whatsappPreview}</div>}

            {errorMsg ? <div className="err">{errorMsg}</div> : null}

            <div className="actions" style={{ marginTop: 14 }}>
              <button className="btn-primary" type="button" onClick={saveOrder} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </button>

              {saved && (
                <>
                  <button className="btn-secondary" type="button" onClick={async () => navigator.clipboard.writeText(whatsappPreview)}>
                    Copiar mensagem
                  </button>
                  <button className="btn-whats" type="button" onClick={openWhatsapp}>
                    Enviar no WhatsApp
                  </button>
                </>
              )}
            </div>

            {saved && savedOrderId ? (
              <div className="muted" style={{ marginTop: 10 }}>
                Salvo com sucesso no Supabase • ID: <strong>{savedOrderId}</strong>
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </>
  );
}
