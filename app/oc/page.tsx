// FILE: app/oc/page.tsx
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
  qtd: string; // inteiro (mascarado)
  descricao: string;
  valor: string; // BRL (mascarado)
};

function pad(n: number, size: number) {
  const s = String(n);
  return s.length >= size ? s : "0".repeat(size - s.length) + s;
}

function nowDateBr() {
  const d = new Date();
  return `${pad(d.getDate(), 2)}/${pad(d.getMonth() + 1, 2)}/${d.getFullYear()}`;
}

function nowTime() {
  const d = new Date();
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}`;
}

function mesAno() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}`;
}

function onlyDigits(s: string) {
  return (s || "").replace(/[^\d]/g, "");
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

// digits "434234" => "R$ 4.342,34"
function formatBRLFromDigits(digits: string) {
  const d = digits.replace(/[^\d]/g, "");
  if (!d) return "";
  const cents = Number(d);
  const n = cents / 100;
  return formatBRLFromNumber(n);
}

// Horímetro (máscara): digita "123450" => "1.234,50"
function formatHoursFromDigits(digits: string) {
  const d = digits.replace(/[^\d]/g, "");
  if (!d) return "";
  const n = Number(d) / 100;
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toWhatsappText(lines: string[]) {
  return lines.filter(Boolean).join("\n");
}

function resolvePublicSupabase(): { url: string; key: string; ok: boolean } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const key = publishable || anon;
  return { url, key, ok: Boolean(url && key) };
}

export default function OCPage() {
  const [tipo, setTipo] = useState<OrderType>("MANUTENCAO");

  // Supabase (NUNCA no escopo global)
  const supabase: SupabaseClient | null = useMemo(() => {
    const { url, key, ok } = resolvePublicSupabase();
    if (!ok) return null;
    return createClient(url, key);
  }, []);

  // cabeçalho
  const [idGerado, setIdGerado] = useState<string>("-"); // agora mostra "próximo previsto"
  const [numeroOC, setNumeroOC] = useState<string>("");

  // campos base
  const [equipamento, setEquipamento] = useState<string>("");
  const [obra, setObra] = useState<string>("");
  const [operador, setOperador] = useState<string>("");
  const [horimetro, setHorimetro] = useState<string>(""); // pt-BR decimal (mascarado)
  const [localEntrega, setLocalEntrega] = useState<string>("");
  const [observacoes, setObservacoes] = useState<string>("");

  // fornecedores (até 3)
  const [qtdFornecedores, setQtdFornecedores] = useState<number>(1);
  const [forn1, setForn1] = useState<string>("");
  const [forn2, setForn2] = useState<string>("");
  const [forn3, setForn3] = useState<string>("");
  const [preco1, setPreco1] = useState<string>("");
  const [preco2, setPreco2] = useState<string>("");
  const [preco3, setPreco3] = useState<string>("");

  const [items, setItems] = useState<ItemRow[]>([]);
  const [expandedPreview, setExpandedPreview] = useState<boolean>(true);

  const [equipmentOptions, setEquipmentOptions] = useState<string[]>([]);
  const [supplierOptions, setSupplierOptions] = useState<string[]>([]);

  const [saving, setSaving] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [savedOrderId, setSavedOrderId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // ====== computed: menor preço + vencedor ======
  const computed = useMemo(() => {
    const p1 = parseBRLToNumber(preco1);
    const p2 = parseBRLToNumber(preco2);
    const p3 = parseBRLToNumber(preco3);

    const candidates: { idx: 1 | 2 | 3; price: number; supplier: string }[] = [];
    if (p1 !== null && forn1.trim()) candidates.push({ idx: 1, price: p1, supplier: forn1.trim() });
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

    const obsBlock = observacoes?.trim() ? ["", "*📝 Observações*", observacoes.trim()] : [];

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
      const f1 = forn1.trim();
      const f2 = forn2.trim();
      const f3 = forn3.trim();
      const p1 = preco1.trim();
      const p2 = preco2.trim();
      const p3 = preco3.trim();

      fornLines.push("", "*🏷️ Cotações*");
      fornLines.push(`1) ${f1 || "-"}${p1 ? ` — ${p1}` : ""}`);
      if (qtdFornecedores >= 2) fornLines.push(`2) ${f2 || "-"}${p2 ? ` — ${p2}` : ""}`);
      if (qtdFornecedores >= 3) fornLines.push(`3) ${f3 || "-"}${p3 ? ` — ${p3}` : ""}`);

      if (computed.valorMenor !== null) {
        fornLines.push("", `*💰 Menor preço considerado:* ${formatBRLFromNumber(computed.valorMenor)}`);
        if (computed.fornecedorVencedor) fornLines.push(`*🏆 Fornecedor vencedor:* ${computed.fornecedorVencedor}`);
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

  // ====== load defaults (ID, OC, listas) ======
  useEffect(() => {
    if (!supabase) return;

    (async () => {
      // 0) Próximo ID previsto (último id + 1)
      try {
        const { data } = await supabase.from("orders_2025_raw").select("id").order("id", { ascending: false }).limit(1);
        const lastId = data?.[0]?.id ? Number(data[0].id) : null;
        setIdGerado(lastId !== null && Number.isFinite(lastId) ? String(lastId + 1) : "-");
      } catch {
        setIdGerado("-");
      }

      // 1) OC sequencial (editável)
      try {
        const { data } = await supabase
          .from("orders_2025_raw")
          .select("numero_oc")
          .not("numero_oc", "is", null)
          .order("id", { ascending: false })
          .limit(80);

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

      // 2) equipamentos (VIEW public.equipment_costs_2025 / coluna equipamento)
      try {
        const { data } = await supabase
          .from("equipment_costs_2025")
          .select("equipamento")
          .not("equipamento", "is", null)
          .limit(2000);

        const opts = Array.from(
          new Set((data || []).map((r: any) => String(r.equipamento || "").trim()).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));

        setEquipmentOptions(opts);
      } catch {
        setEquipmentOptions([]);
      }

      // 3) fornecedores (de pedidos existentes)
      try {
        const { data } = await supabase
          .from("orders_2025_raw")
          .select("fornecedor_1,fornecedor_2,fornecedor_3")
          .order("id", { ascending: false })
          .limit(800);

        const all = (data || []).flatMap((r: any) => [r.fornecedor_1, r.fornecedor_2, r.fornecedor_3]);

        const opts = Array.from(new Set(all.map((x) => String(x || "").trim()).filter(Boolean))).sort((a, b) =>
          a.localeCompare(b)
        );

        setSupplierOptions(opts);
      } catch {
        setSupplierOptions([]);
      }
    })();
  }, [supabase]);

  // ====== actions ======
  function resetSaved() {
    setSaved(false);
    setSavedOrderId(null);
  }

  function addItem() {
    setItems((prev) => [...prev, { qtd: "", descricao: "", valor: "" }]);
    resetSaved();
  }

  function updateItem(i: number, patch: Partial<ItemRow>) {
    setItems((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    resetSaved();
  }

  function removeItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
    resetSaved();
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
        "Configuração do Supabase ausente. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY (ou ANON_KEY)."
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

        // ✅ observações ficam no texto_original (whatsappPreview)
        texto_original: whatsappPreview,

        // fornecedores
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
      setIdGerado(String(orderId));
    } catch (e: any) {
      setSaved(false);
      setSavedOrderId(null);
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

  const env = resolvePublicSupabase();

  return (
    <>
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0");

        /* ===== Material Symbols ===== */
        .msi {
          font-family: "Material Symbols Outlined";
          font-weight: 300;
          font-style: normal;
          line-height: 1;
          display: inline-block;
          -webkit-font-feature-settings: "liga";
          -webkit-font-smoothing: antialiased;
          color: var(--gp-muted);
        }
        .msi-18 { font-size: 18px; }
        .msi-20 { font-size: 20px; }
        .msi-22 { font-size: 22px; }

        /* ===== Layout igual dashboard ===== */
        .oc-page .section-title { font-size: 0.95rem; font-weight: 600; }
        .oc-page .section-subtitle { font-size: 0.75rem; color: var(--gp-muted-soft); }

        .oc-page .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
          gap: 8px;
        }

        /* ===== campos ===== */
        .oc-grid {
          display: grid;
          grid-template-columns: repeat(12, minmax(0, 1fr));
          gap: 12px;
          margin-top: 12px;
        }

        .oc-col-6 { grid-column: span 6; }
        .oc-col-12 { grid-column: span 12; }
        .oc-col-4 { grid-column: span 4; }

        .oc-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .oc-label {
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--gp-muted-soft);
        }

        .oc-input,
        .oc-textarea,
        .oc-select {
          width: 100%;
          border: 1px solid #e5e7eb;
          background: #fff;
          border-radius: 14px;
          padding: 10px 12px;
          font-size: 0.92rem;
          outline: none;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
        }

        .oc-input:focus,
        .oc-textarea:focus,
        .oc-select:focus {
          border-color: #cbd5e1;
          box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.15);
        }

        .oc-textarea { min-height: 98px; resize: vertical; }

        .oc-hint {
          margin-top: 6px;
          font-size: 0.8rem;
          color: var(--gp-muted);
        }

        /* ===== chips estilo filter-bar ===== */
        .oc-filterbar {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 999px;
          background: #ffffff;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
          margin-top: 12px;
        }

        .oc-filterlabel {
          font-size: 0.75rem;
          color: var(--gp-muted-soft);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .oc-chip {
          flex: 0 0 auto;
          padding: 8px 12px;
          border-radius: 999px;
          font-size: 0.8rem;
          color: var(--gp-muted);
          background: var(--gp-surface-soft);
          border: 1px solid transparent;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          user-select: none;
        }

        .oc-chip:hover {
          border-color: #e5e7eb;
          background: #fff;
        }

        .oc-chip.active {
          border-color: var(--gp-accent);
          background: var(--gp-accent-soft);
          color: var(--gp-text);
        }

        /* ===== warn/error ===== */
        .oc-warn {
          border-radius: 18px;
          padding: 16px 18px;
          background: #ffffff;
          border: 1px dashed #e5e7eb;
          font-size: 0.9rem;
          color: var(--gp-muted);
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
        }

        .oc-err {
          margin-top: 10px;
          color: #b91c1c;
          font-size: 0.9rem;
          font-weight: 600;
        }

        /* ===== itens ===== */
        .oc-item {
          border-radius: 18px;
          padding: 16px 18px;
          background: var(--gp-surface);
          box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06);
          border: 1px solid #f3f4f6;
          margin-top: 12px;
        }

        .oc-item-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 12px;
        }

        .oc-item-title {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--gp-text);
        }

        .oc-item-actions {
          display: inline-flex;
          gap: 8px;
          align-items: center;
        }

        .oc-btn {
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid #e5e7eb;
          background: #fff;
          font-weight: 600;
          cursor: pointer;
          color: var(--gp-text);
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .oc-btn:hover { background: #f9fafb; }

        .oc-btn-primary {
          border: 1px solid transparent;
          background: var(--gp-accent);
          color: #fff;
        }

        .oc-btn-primary:hover { filter: brightness(0.96); }

        .oc-btn-primary:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .oc-btn-whats {
          border: 1px solid transparent;
          background: #22c55e;
          color: #fff;
        }

        .oc-btn-ghost {
          background: var(--gp-surface-soft);
        }

        /* ===== preview ===== */
        .oc-preview {
          border-radius: 18px;
          padding: 14px 16px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.04);
          white-space: pre-wrap;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          font-size: 0.82rem;
          line-height: 1.6;
          color: #0f172a;
          margin-top: 12px;
        }

        .oc-inline-note {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
          color: var(--gp-muted);
          font-size: 0.75rem;
        }

        /* ===== responsivo ===== */
        @media (max-width: 900px) {
          .oc-col-6 { grid-column: span 12; }
          .oc-col-4 { grid-column: span 12; }
        }
      `}</style>

      <div className="page-root oc-page">
        <div className="page-container">
          {/* HEADER igual dashboard */}
          <header
            className="page-header"
            style={{
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <div
              className="brand"
              style={{
                flexDirection: "column",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <img
                src="/gpasfalto-logo.png"
                alt="GP Asfalto"
                style={{
                  width: 120,
                  height: 120,
                  objectFit: "contain",
                  border: "none",
                  background: "transparent",
                }}
              />
              <div style={{ textAlign: "center" }}>
                <div className="brand-text-main">Registrar OC</div>
                <div className="brand-text-sub">Criar OC rápida e padrão para WhatsApp</div>
              </div>
            </div>

            <div style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <div className="header-pill">
                <span>ID previsto</span>
                <strong>{idGerado}</strong>
              </div>
              <div className="header-pill">
                <span>OC</span>
                <strong>{numeroOC || "—"}</strong>
              </div>
              {saved && savedOrderId ? (
                <div className="header-pill">
                  <span>Salvo</span>
                  <strong>#{savedOrderId}</strong>
                </div>
              ) : null}
            </div>
          </header>

          {!env.ok && (
            <div className="oc-warn">
              Configuração no Vercel necessária: defina <b>NEXT_PUBLIC_SUPABASE_URL</b> e{" "}
              <b>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY</b> (ou <b>NEXT_PUBLIC_SUPABASE_ANON_KEY</b>).
            </div>
          )}

          {/* TIPO (chips estilo dashboard) */}
          <section className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">Tipo de Pedido</div>
                <div className="section-subtitle">Escolha o tipo para montar a mensagem e regras (ex.: cotações).</div>
              </div>
              <div className="oc-inline-note">
                <span className="msi msi-18">bolt</span>
                <span>Prévia sempre disponível</span>
              </div>
            </div>

            <div className="oc-filterbar">
              <div className="oc-filterlabel">
                <span className="msi msi-18">tune</span>
                <span>Tipos</span>
              </div>

              {typeButtons.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className={`oc-chip ${tipo === b.key ? "active" : ""}`}
                  onClick={() => {
                    setTipo(b.key);
                    resetSaved();
                  }}
                >
                  <span className="msi msi-20">{b.icon}</span>
                  <span>{b.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* DADOS */}
          <section className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">Dados essenciais</div>
                <div className="section-subtitle">Preencha o mínimo e copie/mande no WhatsApp após salvar.</div>
              </div>
            </div>

            <div className="oc-grid">
              <div className="oc-field oc-col-6">
                <div className="oc-label">ID (previsto)</div>
                <input className="oc-input" value={idGerado} disabled />
              </div>

              <div className="oc-field oc-col-6">
                <div className="oc-label">OC</div>
                <input
                  className="oc-input"
                  value={numeroOC}
                  onChange={(e) => {
                    setNumeroOC(e.target.value);
                    resetSaved();
                  }}
                  placeholder="OC20337"
                />
              </div>

              <div className="oc-field oc-col-12">
                <div className="oc-label">Equipamento</div>
                <input
                  className="oc-input"
                  value={equipamento}
                  onChange={(e) => {
                    setEquipamento(e.target.value);
                    resetSaved();
                  }}
                  placeholder="Digite ou selecione o equipamento"
                  list="equipList"
                />
                <datalist id="equipList">
                  {equipmentOptions.map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>
                {!equipmentOptions.length && (
                  <div className="oc-hint">(Lista não carregou — você ainda pode digitar livremente.)</div>
                )}
              </div>

              <div className="oc-field oc-col-6">
                <div className="oc-label">Obra</div>
                <input
                  className="oc-input"
                  value={obra}
                  onChange={(e) => {
                    setObra(e.target.value);
                    resetSaved();
                  }}
                  placeholder="Nome da obra"
                />
              </div>

              <div className="oc-field oc-col-6">
                <div className="oc-label">Operador</div>
                <input
                  className="oc-input"
                  value={operador}
                  onChange={(e) => {
                    setOperador(e.target.value);
                    resetSaved();
                  }}
                  placeholder="Nome do operador"
                />
              </div>

              <div className="oc-field oc-col-6">
                <div className="oc-label">Horímetro</div>
                <input
                  className="oc-input"
                  inputMode="numeric"
                  value={horimetro}
                  onChange={(e) => {
                    setHorimetro(formatHoursFromDigits(onlyDigits(e.target.value)));
                    resetSaved();
                  }}
                  placeholder="Ex: 1234,50"
                />
              </div>

              <div className="oc-field oc-col-6">
                <div className="oc-label">Local de entrega</div>
                <input
                  className="oc-input"
                  value={localEntrega}
                  onChange={(e) => {
                    setLocalEntrega(e.target.value);
                    resetSaved();
                  }}
                  placeholder="Endereço ou local"
                />
              </div>

              <div className="oc-field oc-col-12">
                <div className="oc-label">Observações</div>
                <textarea
                  className="oc-textarea"
                  value={observacoes}
                  onChange={(e) => {
                    setObservacoes(e.target.value);
                    resetSaved();
                  }}
                  placeholder="Informações adicionais..."
                />
              </div>
            </div>

            {tipo === "MANUTENCAO" && (
              <div style={{ marginTop: 14 }}>
                <div className="section-header" style={{ marginBottom: 8 }}>
                  <div>
                    <div className="section-title">Cotações</div>
                    <div className="section-subtitle">1–3 fornecedores e preços (menor preço é considerado).</div>
                  </div>
                  {computed.valorMenor !== null ? (
                    <div className="header-pill">
                      <span>Menor preço</span>
                      <strong>{formatBRLFromNumber(computed.valorMenor)}</strong>
                    </div>
                  ) : (
                    <div className="header-pill">
                      <span>Menor preço</span>
                      <strong>—</strong>
                    </div>
                  )}
                </div>

                <datalist id="supList">
                  {supplierOptions.map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>

                <div className="oc-grid" style={{ marginTop: 0 }}>
                  <div className="oc-field oc-col-4">
                    <div className="oc-label">Qtd de fornecedores</div>
                    <select
                      className="oc-select"
                      value={qtdFornecedores}
                      onChange={(e) => {
                        setQtdFornecedores(Number(e.target.value));
                        resetSaved();
                      }}
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                    </select>
                  </div>

                  <div className="oc-field oc-col-4">
                    <div className="oc-label">Fornecedor 1</div>
                    <input
                      className="oc-input"
                      value={forn1}
                      onChange={(e) => {
                        setForn1(e.target.value);
                        resetSaved();
                      }}
                      list="supList"
                      placeholder="Digite ou selecione"
                    />
                  </div>

                  <div className="oc-field oc-col-4">
                    <div className="oc-label">Preço 1</div>
                    <input
                      className="oc-input"
                      inputMode="numeric"
                      value={preco1}
                      onChange={(e) => {
                        setPreco1(formatBRLFromDigits(onlyDigits(e.target.value)));
                        resetSaved();
                      }}
                      placeholder="R$ 0,00"
                    />
                  </div>

                  {qtdFornecedores >= 2 && (
                    <>
                      <div className="oc-field oc-col-6">
                        <div className="oc-label">Fornecedor 2</div>
                        <input
                          className="oc-input"
                          value={forn2}
                          onChange={(e) => {
                            setForn2(e.target.value);
                            resetSaved();
                          }}
                          list="supList"
                          placeholder="Digite ou selecione"
                        />
                      </div>

                      <div className="oc-field oc-col-6">
                        <div className="oc-label">Preço 2</div>
                        <input
                          className="oc-input"
                          inputMode="numeric"
                          value={preco2}
                          onChange={(e) => {
                            setPreco2(formatBRLFromDigits(onlyDigits(e.target.value)));
                            resetSaved();
                          }}
                          placeholder="R$ 0,00"
                        />
                      </div>
                    </>
                  )}

                  {qtdFornecedores >= 3 && (
                    <>
                      <div className="oc-field oc-col-6">
                        <div className="oc-label">Fornecedor 3</div>
                        <input
                          className="oc-input"
                          value={forn3}
                          onChange={(e) => {
                            setForn3(e.target.value);
                            resetSaved();
                          }}
                          list="supList"
                          placeholder="Digite ou selecione"
                        />
                      </div>

                      <div className="oc-field oc-col-6">
                        <div className="oc-label">Preço 3</div>
                        <input
                          className="oc-input"
                          inputMode="numeric"
                          value={preco3}
                          onChange={(e) => {
                            setPreco3(formatBRLFromDigits(onlyDigits(e.target.value)));
                            resetSaved();
                          }}
                          placeholder="R$ 0,00"
                        />
                      </div>
                    </>
                  )}
                </div>

                {computed.valorMenor !== null && computed.fornecedorVencedor ? (
                  <div className="oc-hint">
                    Vencedor: <b style={{ color: "var(--gp-text)" }}>{computed.fornecedorVencedor}</b>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          {/* ITENS */}
          <section className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">Itens da ordem</div>
                <div className="section-subtitle">Adicione itens (quantidade, descrição e valor opcional).</div>
              </div>
              <button className="oc-btn oc-btn-ghost" type="button" onClick={addItem}>
                <span className="msi msi-20">add</span>
                <span>Adicionar item</span>
              </button>
            </div>

            {!items.length ? (
              <div className="oc-warn">Nenhum item adicionado ainda.</div>
            ) : (
              items.map((it, idx) => (
                <div key={idx} className="oc-item">
                  <div className="oc-item-head">
                    <div className="oc-item-title">
                      <span className="msi msi-20">inventory_2</span>
                      <span>Item {idx + 1}</span>
                    </div>
                    <div className="oc-item-actions">
                      <button className="oc-btn" type="button" onClick={() => removeItem(idx)}>
                        <span className="msi msi-20">delete</span>
                        <span>Remover</span>
                      </button>
                    </div>
                  </div>

                  <div className="oc-grid" style={{ marginTop: 0 }}>
                    <div className="oc-field oc-col-4">
                      <div className="oc-label">Quantidade</div>
                      <input
                        className="oc-input"
                        inputMode="numeric"
                        value={it.qtd}
                        onChange={(e) => {
                          const v = onlyDigits(e.target.value).slice(0, 6);
                          updateItem(idx, { qtd: v });
                        }}
                        placeholder="Ex: 2"
                      />
                    </div>

                    <div className="oc-field oc-col-8">
                      <div className="oc-label">Descrição</div>
                      <input
                        className="oc-input"
                        value={it.descricao}
                        onChange={(e) => updateItem(idx, { descricao: e.target.value })}
                        placeholder="Ex: mangueira hidráulica"
                      />
                    </div>

                    <div className="oc-field oc-col-6">
                      <div className="oc-label">Valor (opcional)</div>
                      <input
                        className="oc-input"
                        inputMode="numeric"
                        value={it.valor}
                        onChange={(e) => {
                          const brl = formatBRLFromDigits(onlyDigits(e.target.value));
                          updateItem(idx, { valor: brl });
                        }}
                        placeholder="R$ 0,00"
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </section>

          {/* PREVIEW + AÇÕES */}
          <section className="section-card">
            <div className="section-header">
              <div>
                <div className="section-title">Mensagem (WhatsApp)</div>
                <div className="section-subtitle">Revise a prévia. Copiar/Enviar só aparece após salvar.</div>
              </div>

              <button
                className="oc-btn"
                type="button"
                onClick={() => setExpandedPreview((v) => !v)}
              >
                <span className="msi msi-20">{expandedPreview ? "expand_less" : "expand_more"}</span>
                <span>{expandedPreview ? "Recolher" : "Mostrar"}</span>
              </button>
            </div>

            {expandedPreview && <div className="oc-preview">{whatsappPreview}</div>}

            {errorMsg ? <div className="oc-err">{errorMsg}</div> : null}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14, justifyContent: "flex-end" }}>
              <button className="oc-btn oc-btn-primary" type="button" onClick={saveOrder} disabled={saving}>
                <span className="msi msi-20">{saving ? "hourglass_top" : "save"}</span>
                <span>{saving ? "Salvando..." : "Salvar"}</span>
              </button>

              {saved && (
                <>
                  <button className="oc-btn" type="button" onClick={copyText}>
                    <span className="msi msi-20">content_copy</span>
                    <span>Copiar</span>
                  </button>
                  <button className="oc-btn oc-btn-whats" type="button" onClick={openWhatsapp}>
                    <span className="msi msi-20">send</span>
                    <span>Enviar WhatsApp</span>
                  </button>
                </>
              )}
            </div>

            {saved && savedOrderId ? (
              <div className="oc-hint" style={{ marginTop: 10 }}>
                Salvo com sucesso • ID: <b style={{ color: "var(--gp-text)" }}>{savedOrderId}</b>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </>
  );
}
