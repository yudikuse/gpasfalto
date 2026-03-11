// FILE: app/oc/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type OrderType = 
  | "COMPRA"
  | "ABASTECIMENTO"
  | "MANUTENCAO"
  | "SERVICOS"
  | "PECAS"
  | "OUTRO";

type ItemRow = {
  qtd: string; // inteiro (digitos)
  descricao: string;
  valor: string; // BRL (mascarado) - NÃO salva em coluna (vira texto)
};

type SuggestMode = "startsWith" | "includes";

function pad(n: number, size: number) {
  const s = String(n);
  return s.length >= size ? s : "0".repeat(size - s.length) + s;
}

function nowDateBr() {
  const d = new Date();
  return ${pad(d.getDate(), 2)}/${pad(d.getMonth() + 1, 2)}/${d.getFullYear()};
}

function nowTime() {
  const d = new Date();
  return ${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)};
}

function mesAno() {
  const d = new Date();
  return ${d.getFullYear()}-${pad(d.getMonth() + 1, 2)};
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
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toWhatsappText(lines: string[]) {
  return lines.filter(Boolean).join("\n");
}

function resolvePublicSupabase(): { url: string; key: string; ok: boolean } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishable =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const key = publishable || anon;
  return { url, key, ok: Boolean(url && key) };
}

function normalizeText(s: string) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function getSuggestions(
  value: string,
  options: string[],
  mode: SuggestMode = "startsWith",
  limit = 8
) {
  const q = normalizeText(value);
  if (!q) return [];

  const starts = options.filter((opt) => normalizeText(opt).startsWith(q));

  if (mode === "startsWith") {
    return starts.slice(0, limit);
  }

  const contains = options.filter((opt) => {
    const n = normalizeText(opt);
    return !n.startsWith(q) && n.includes(q);
  });

  return [...starts, ...contains].slice(0, limit);
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
  const [idGerado, setIdGerado] = useState<string>("-");
  const [numeroOC, setNumeroOC] = useState<string>("");
  const [ocInputVersion, setOcInputVersion] = useState<number>(0);

  // campos base
  const [equipamento, setEquipamento] = useState<string>("");
  const [obra, setObra] = useState<string>("");
  const [operador, setOperador] = useState<string>("");
  const [horimetro, setHorimetro] = useState<string>("");
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
  const [obraOptions, setObraOptions] = useState<string[]>([]);
  const [operadorOptions, setOperadorOptions] = useState<string[]>([]);
  const [localEntregaOptions, setLocalEntregaOptions] = useState<string[]>([]);

  const [saving, setSaving] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [savedOrderId, setSavedOrderId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // autocomplete
  const [showEquipSug, setShowEquipSug] = useState<boolean>(false);
  const [showObraSug, setShowObraSug] = useState<boolean>(false);
  const [showOperadorSug, setShowOperadorSug] = useState<boolean>(false);
  const [showLocalSug, setShowLocalSug] = useState<boolean>(false);

  const equipWrapRef = useRef<HTMLDivElement | null>(null);
  const obraWrapRef = useRef<HTMLDivElement | null>(null);
  const operadorWrapRef = useRef<HTMLDivElement | null>(null);
  const localWrapRef = useRef<HTMLDivElement | null>(null);
  const ocLoadSeqRef = useRef(0);

  const equipSuggestions = useMemo(
    () => getSuggestions(equipamento, equipmentOptions, "startsWith", 8),
    [equipamento, equipmentOptions]
  );

  const obraSuggestions = useMemo(
    () => getSuggestions(obra, obraOptions, "startsWith", 8),
    [obra, obraOptions]
  );

  const operadorSuggestions = useMemo(
    () => getSuggestions(operador, operadorOptions, "startsWith", 8),
    [operador, operadorOptions]
  );

  const localSuggestions = useMemo(
    () => getSuggestions(localEntrega, localEntregaOptions, "startsWith", 8),
    [localEntrega, localEntregaOptions]
  );

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
      *OC:* ${numeroOC || "-"},
      *Data:* ${nowDateBr()} ${nowTime()},
      "",
      "*📍 Dados*",
      • *Equipamento:* ${equipamento || "-"},
      • *Obra:* ${obra || "-"},
      • *Operador:* ${operador || "-"},
      • *Horímetro:* ${horimetro ? ${horimetro} h : "-"},
      • *Entrega:* ${localEntrega || "-"},
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
        const vTxt = v ?  — ${v} : "";
        itLines.push(${i + 1}) ${q}x ${d}${vTxt});
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
      fornLines.push(1) ${f1 || "-"}${p1 ?  — ${p1} : ""});
      if (qtdFornecedores >= 2) fornLines.push(2) ${f2 || "-"}${p2 ?  — ${p2} : ""});
      if (qtdFornecedores >= 3) fornLines.push(3) ${f3 || "-"}${p3 ?  — ${p3} : ""});

      if (computed.valorMenor !== null) {
        fornLines.push("", *💰 Menor preço considerado:* ${formatBRLFromNumber(computed.valorMenor)});
        if (computed.fornecedorVencedor) fornLines.push(*🏆 Fornecedor vencedor:* ${computed.fornecedorVencedor});
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

  async function loadNextIdPrevisto() {
    if (!supabase) return;

    try {
      const { data } = await supabase
        .from("orders_2025_raw")
        .select("id")
        .order("id", { ascending: false })
        .limit(1);

      const lastId = data?.[0]?.id ? Number(data[0].id) : null;
      setIdGerado(lastId !== null && Number.isFinite(lastId) ? String(lastId + 1) : "-");
    } catch {
      setIdGerado("-");
    }
  }

  const forceNumeroOC = useCallback((nextOc: string) => {
    setNumeroOC(nextOc);
    setOcInputVersion((v) => v + 1);
  }, []);

 const loadNextNumeroOC = useCallback(async () => {
  if (!supabase) return;

  try {
    const { data, error } = await supabase
      .from("orders_2025_raw")
      .select("numero_oc")
      .ilike("numero_oc", "OC%")
      .order("numero_oc", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const atual = Number(onlyDigits(String(data?.numero_oc || "")));
    const proximo = Number.isFinite(atual) && atual > 0 ? atual + 1 : 20000;

    setNumeroOC(OC${proximo});
  } catch {
    setNumeroOC("OC20000");
  }
}, [supabase]);

  // ====== load defaults (ID, OC, listas) ======
  useEffect(() => {
    if (!supabase) return;

    (async () => {
      await loadNextIdPrevisto();
      await loadNextNumeroOC();

      try {
        const { data } = await supabase
          .from("equipment_costs_2025_v")
          .select("equipamento")
          .not("equipamento", "is", null)
          .limit(5000);

        const opts = Array.from(
          new Set((data || []).map((r: any) => String(r.equipamento || "").trim()).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));

        setEquipmentOptions(opts);
      } catch {
        setEquipmentOptions([]);
      }

      try {
        const { data } = await supabase
          .from("orders_2025_raw")
          .select("fornecedor_1,fornecedor_2,fornecedor_3,obra,operador,local_entrega")
          .order("id", { ascending: false })
          .limit(1200);

        const allSup = (data || []).flatMap((r: any) => [r.fornecedor_1, r.fornecedor_2, r.fornecedor_3]);
        setSupplierOptions(
          Array.from(new Set(allSup.map((x) => String(x || "").trim()).filter(Boolean))).sort((a, b) =>
            a.localeCompare(b)
          )
        );

        setObraOptions(
          Array.from(new Set((data || []).map((r: any) => String(r.obra || "").trim()).filter(Boolean))).sort((a, b) =>
            a.localeCompare(b)
          )
        );

        setOperadorOptions(
          Array.from(new Set((data || []).map((r: any) => String(r.operador || "").trim()).filter(Boolean))).sort(
            (a, b) => a.localeCompare(b)
          )
        );

        setLocalEntregaOptions(
          Array.from(
            new Set((data || []).map((r: any) => String(r.local_entrega || "").trim()).filter(Boolean))
          ).sort((a, b) => a.localeCompare(b))
        );
      } catch {
        setSupplierOptions([]);
        setObraOptions([]);
        setOperadorOptions([]);
        setLocalEntregaOptions([]);
      }
    })();
  }, [supabase, loadNextNumeroOC]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;

      if (equipWrapRef.current && !equipWrapRef.current.contains(target)) setShowEquipSug(false);
      if (obraWrapRef.current && !obraWrapRef.current.contains(target)) setShowObraSug(false);
      if (operadorWrapRef.current && !operadorWrapRef.current.contains(target)) setShowOperadorSug(false);
      if (localWrapRef.current && !localWrapRef.current.contains(target)) setShowLocalSug(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
    const url = https://wa.me/?text=${encodeURIComponent(whatsappPreview)};
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

    const numeroOcNormalizado = (numeroOC || "").trim();
    if (!numeroOcNormalizado) {
      setErrorMsg("Informe a OC antes de salvar.");
      return;
    }

    setSaving(true);

    try {
      const firstItem = items[0] || null;

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

        numero_oc: numeroOcNormalizado,
        codigo_equipamento: equipamento || null,
        obra: obra || null,
        operador: operador || null,
        horimetro: horimetro || null,
        local_entrega: localEntrega || null,

        material: firstItem?.descricao ? String(firstItem.descricao).slice(0, 255) : null,
        quantidade_texto: firstItem?.qtd ? String(firstItem.qtd).slice(0, 50) : null,
        placa: null,

        texto_original: whatsappPreview,

        fornecedor_1: tipo === "MANUTENCAO" ? (forn1 || null) : null,
        fornecedor_2: tipo === "MANUTENCAO" && qtdFornecedores >= 2 ? (forn2 || null) : null,
        fornecedor_3: tipo === "MANUTENCAO" && qtdFornecedores >= 3 ? (forn3 || null) : null,

        preco_1: tipo === "MANUTENCAO" ? parseBRLToNumber(preco1) : null,
        preco_2: tipo === "MANUTENCAO" && qtdFornecedores >= 2 ? parseBRLToNumber(preco2) : null,
        preco_3: tipo === "MANUTENCAO" && qtdFornecedores >= 3 ? parseBRLToNumber(preco3) : null,

        valor_menor: tipo === "MANUTENCAO" ? computed.valorMenor : null,
        fornecedor_vencedor: tipo === "MANUTENCAO" ? computed.fornecedorVencedor : null,
      };

      const { data: existingRows, error: existingErr } = await supabase
        .from("orders_2025_raw")
        .select("id")
        .eq("numero_oc", numeroOcNormalizado)
        .order("id", { ascending: true })
        .limit(2);

      if (existingErr) throw existingErr;

      if ((existingRows || []).length > 1) {
        throw new Error(
          Já existe mais de um registro com a OC ${numeroOcNormalizado}. Não foi feita nenhuma alteração por segurança.
        );
      }

      let orderId: number;

      if ((existingRows || []).length === 1) {
        const confirmed = window.confirm(
          A OC ${numeroOcNormalizado} já existe. Deseja atualizar o registro existente?
        );

        if (!confirmed) {
          setSaving(false);
          return;
        }

        orderId = Number(existingRows[0].id);

        const { error: errUpdate } = await supabase
          .from("orders_2025_raw")
          .update(payload)
          .eq("id", orderId);

        if (errUpdate) throw errUpdate;

        const { error: errDeleteItems } = await supabase
          .from("orders_2025_items")
          .delete()
          .eq("ordem_id", orderId);

        if (errDeleteItems) throw errDeleteItems;
      } else {
        const { data: inserted, error: errInsert } = await supabase
          .from("orders_2025_raw")
          .insert(payload)
          .select("id")
          .single();

        if (errInsert) throw errInsert;

        orderId = Number(inserted?.id);
      }

      setSavedOrderId(orderId);
      setIdGerado(String(orderId));

      if (items.length) {
        const d = nowDateBr();
        const h = nowTime();

        const rows = items.map((it) => {
          const qtdNum = it.qtd ? Number(onlyDigits(it.qtd)) : null;
          const qtdText = it.qtd ? String(onlyDigits(it.qtd)) : null;

          const desc =
            (it.descricao || "").trim() +
            (it.valor ?  — ${it.valor} : "");

          return {
            ordem_id: orderId,
            data: d,
            hora: h,
            numero_oc: numeroOcNormalizado,
            descricao: desc ? desc.slice(0, 500) : null,
            quantidade_texto: qtdText,
            quantidade_num: qtdNum,
          };
        });

        const { error: errItems } = await supabase.from("orders_2025_items").insert(rows);
        if (errItems) throw errItems;
      }

      await loadNextIdPrevisto();
      await loadNextNumeroOC();

      setSaved(true);
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
      <style jsx global>{
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

        .msi-sm {
          font-size: 18px;
          color: var(--gp-muted);
        }

        .oc-root {
          min-height: 100vh;
          background: radial-gradient(circle at top, #f9fafb 0, #f3f4f6 45%, #e5e7eb);
          display: flex;
          justify-content: center;
          padding: 32px 16px;
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
          padding: 6px 14px 0;
        }

        .oc-logo {
          display: flex;
          justify-content: center;
          margin: 0 0 10px;
        }

        .oc-logo img {
          height: 92px;
          width: auto;
          display: block;
          object-fit: contain;
        }

        .oc-title {
          margin: 0;
          font-size: 34px;
          font-weight: 700;
          letter-spacing: -0.02em;
          color: var(--gp-text);
        }

        .oc-subtitle {
          margin-top: 6px;
          font-size: 13px;
          color: var(--gp-muted-soft);
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
          align-items: center;
          gap: 8px;
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

        .type-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 12px;
        }

        .type-btn {
          border: 1px solid #e5e7eb;
          background: #fff;
          border-radius: 14px;
          padding: 12px 10px;
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

        .row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-top: 12px;
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
          gap: 6px;
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
          padding: 11px 12px;
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
          min-height: 96px;
          resize: vertical;
        }

        .muted {
          font-size: 12px;
          color: var(--gp-muted-soft);
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

        .item-grid {
          display: grid;
          grid-template-columns: 160px 1fr;
          gap: 14px;
        }

        .item-grid-2 {
          display: grid;
          grid-template-columns: 1fr 150px;
          gap: 14px;
          margin-top: 14px;
          align-items: end;
        }

        .btn-remove {
          border: 1px solid #e5e7eb;
          background: #fff;
          border-radius: 12px;
          padding: 11px 12px;
          cursor: pointer;
          color: var(--gp-muted);
          font-weight: 700;
        }

        .preview-toggle {
          width: 100%;
          border: 1px solid #e5e7eb;
          background: #fff;
          border-radius: 14px;
          padding: 12px 14px;
          cursor: pointer;
          font-weight: 900;
          color: #0f172a;
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
          margin-top: 14px;
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
          font-weight: 900;
          cursor: pointer;
        }

        .err {
          margin-top: 10px;
          color: #b91c1c;
          font-size: 13px;
          font-weight: 700;
        }

        .autocomplete-wrap {
          position: relative;
        }

        .autocomplete-list {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          right: 0;
          z-index: 30;
          margin: 0;
          padding: 6px;
          list-style: none;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          background: #fff;
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.10);
          max-height: 240px;
          overflow-y: auto;
        }

        .autocomplete-item {
          width: 100%;
          border: none;
          background: transparent;
          text-align: left;
          padding: 10px 12px;
          border-radius: 10px;
          font-size: 14px;
          color: #0f172a;
          cursor: pointer;
        }

        .autocomplete-item:hover {
          background: #f3f4f6;
        }

        @media (max-width: 560px) {
          .oc-title {
            font-size: 28px;
          }
          .row,
          .grid-2 {
            grid-template-columns: 1fr;
          }
          .item-grid {
            grid-template-columns: 1fr;
          }
          .item-grid-2 {
            grid-template-columns: 1fr;
          }
          .oc-logo img {
            height: 76px;
          }
          .type-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
      }</style>

      <main className="oc-root">
        <div className="oc-container">
          <div className="oc-hero">
            <div className="oc-logo">
              <img src="/gpasfalto-logo.png" alt="GP Asfalto" />
            </div>
            <h1 className="oc-title">Registrar OC</h1>
            <div className="oc-subtitle">Criar OC rápida e padrão para WhatsApp</div>
          </div>

          {!env.ok && (
            <div className="warn">
              Configuração no Vercel necessária: defina <b>NEXT_PUBLIC_SUPABASE_URL</b> e{" "}
              <b>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY</b> (ou <b>NEXT_PUBLIC_SUPABASE_ANON_KEY</b>).
            </div>
          )}

          <section className="section-card">
            <div className="section-head">
              <span className="msi msi-sm">widgets</span>
              <h2 className="section-title">Tipo de Pedido</h2>
            </div>

            <div className="type-grid">
              {typeButtons.map((b) => (
                <button
                  key={b.key}
                  className={type-btn ${tipo === b.key ? "active" : ""}}
                  onClick={() => {
                    setTipo(b.key);
                    resetSaved();
                  }}
                  type="button"
                >
                  <span className="msi">{b.icon}</span>
                  <strong>{b.label}</strong>
                </button>
              ))}
            </div>
          </section>

          <section className="section-card">
            <div className="section-head">
              <span className="msi msi-sm">description</span>
              <h2 className="section-title">Dados Essenciais</h2>
            </div>
            <div className="section-sub">Padrão: Manutenção</div>

            <div className="row">
              <div className="field">
                <div className="label">ID (previsto)</div>
                <input className="input" value={idGerado} disabled />
              </div>

              <div className="field">
                <div className="label">OC</div>
                <input
                  key={oc-input-${ocInputVersion}}
                  id={numero_oc_${ocInputVersion}}
                  name={numero_oc_${ocInputVersion}}
                  className="input"
                  value={numeroOC}
                  onChange={(e) => {
                    setNumeroOC(e.target.value);
                    resetSaved();
                  }}
                  placeholder="OC20337"
                  autoComplete="new-password"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <div className="label">Equipamento</div>
              <div className="autocomplete-wrap" ref={equipWrapRef}>
                <input
                  className="input"
                  value={equipamento}
                  onChange={(e) => {
                    setEquipamento(e.target.value);
                    setShowEquipSug(true);
                    resetSaved();
                  }}
                  onFocus={() => setShowEquipSug(true)}
                  placeholder="Digite ou selecione o equipamento"
                  autoComplete="off"
                />
                {showEquipSug && equipSuggestions.length > 0 && (
                  <ul className="autocomplete-list">
                    {equipSuggestions.map((x) => (
                      <li key={x}>
                        <button
                          type="button"
                          className="autocomplete-item"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setEquipamento(x);
                            setShowEquipSug(false);
                            resetSaved();
                          }}
                        >
                          {x}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <datalist id="equipList">
                {equipmentOptions.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
              {!equipmentOptions.length && (
                <div className="muted" style={{ marginTop: 6 }}>
                  (Lista não carregou — você ainda pode digitar livremente.)
                </div>
              )}
            </div>

            <datalist id="obraList">
              {obraOptions.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
            <datalist id="operadorList">
              {operadorOptions.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
            <datalist id="localEntregaList">
              {localEntregaOptions.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>

            <div className="grid-2">
              <div className="field">
                <div className="label">Obra</div>
                <div className="autocomplete-wrap" ref={obraWrapRef}>
                  <input
                    className="input"
                    value={obra}
                    onChange={(e) => {
                      setObra(e.target.value);
                      setShowObraSug(true);
                      resetSaved();
                    }}
                    onFocus={() => setShowObraSug(true)}
                    placeholder="Nome da obra"
                    autoComplete="off"
                  />
                  {showObraSug && obraSuggestions.length > 0 && (
                    <ul className="autocomplete-list">
                      {obraSuggestions.map((x) => (
                        <li key={x}>
                          <button
                            type="button"
                            className="autocomplete-item"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setObra(x);
                              setShowObraSug(false);
                              resetSaved();
                            }}
                          >
                            {x}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="field">
                <div className="label">Operador</div>
                <div className="autocomplete-wrap" ref={operadorWrapRef}>
                  <input
                    className="input"
                    value={operador}
                    onChange={(e) => {
                      setOperador(e.target.value);
                      setShowOperadorSug(true);
                      resetSaved();
                    }}
                    onFocus={() => setShowOperadorSug(true)}
                    placeholder="Nome do operador"
                    autoComplete="off"
                  />
                  {showOperadorSug && operadorSuggestions.length > 0 && (
                    <ul className="autocomplete-list">
                      {operadorSuggestions.map((x) => (
                        <li key={x}>
                          <button
                            type="button"
                            className="autocomplete-item"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setOperador(x);
                              setShowOperadorSug(false);
                              resetSaved();
                            }}
                          >
                            {x}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div className="grid-2">
              <div className="field">
                <div className="label">Horímetro</div>
                <input
                  className="input"
                  inputMode="numeric"
                  value={horimetro}
                  onChange={(e) => {
                    setHorimetro(formatHoursFromDigits(onlyDigits(e.target.value)));
                    resetSaved();
                  }}
                  placeholder="Ex: 1234,50"
                />
              </div>

              <div className="field">
                <div className="label">Local de entrega</div>
                <div className="autocomplete-wrap" ref={localWrapRef}>
                  <input
                    className="input"
                    value={localEntrega}
                    onChange={(e) => {
                      setLocalEntrega(e.target.value);
                      setShowLocalSug(true);
                      resetSaved();
                    }}
                    onFocus={() => setShowLocalSug(true)}
                    placeholder="Endereço ou local"
                    autoComplete="off"
                  />
                  {showLocalSug && localSuggestions.length > 0 && (
                    <ul className="autocomplete-list">
                      {localSuggestions.map((x) => (
                        <li key={x}>
                          <button
                            type="button"
                            className="autocomplete-item"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setLocalEntrega(x);
                              setShowLocalSug(false);
                              resetSaved();
                            }}
                          >
                            {x}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <div className="label">Observações</div>
              <textarea
                className="textarea"
                value={observacoes}
                onChange={(e) => {
                  setObservacoes(e.target.value);
                  resetSaved();
                }}
                placeholder="Informações adicionais..."
              />
              <div className="muted">
                Observações são salvas dentro de <b>texto_original</b> (mensagem WhatsApp), para não quebrar o parse.
              </div>
            </div>

            {tipo === "MANUTENCAO" && (
              <div style={{ marginTop: 14 }}>
                <div className="section-head" style={{ marginTop: 6 }}>
                  <span className="msi msi-sm">store</span>
                  <div className="label">Fornecedores (cotações)</div>
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Escolha 1–3 fornecedores e informe os preços. Menor preço será considerado.
                </div>

                <div className="field" style={{ width: 140, marginTop: 10 }}>
                  <div className="label">Qtd</div>
                  <select
                    className="select"
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

                <datalist id="supList">
                  {supplierOptions.map((x) => (
                    <option key={x} value={x} />
                  ))}
                </datalist>

                <div className="grid-2" style={{ marginTop: 10 }}>
                  <div className="field">
                    <div className="label">Fornecedor 1</div>
                    <input
                      className="input"
                      value={forn1}
                      onChange={(e) => {
                        setForn1(e.target.value);
                        resetSaved();
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
                        resetSaved();
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
                            resetSaved();
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
                            resetSaved();
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
                            resetSaved();
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
                            resetSaved();
                          }}
                          placeholder="R$ 0,00"
                        />
                      </div>
                    </>
                  )}
                </div>

                {computed.valorMenor !== null && (
                  <div className="muted" style={{ marginTop: 10 }}>
                    Menor preço considerado:{" "}
                    <strong style={{ color: "#0f172a" }}>{formatBRLFromNumber(computed.valorMenor)}</strong>
                    {computed.fornecedorVencedor ? (
                      <>
                        {" "}
                        • Vencedor:{" "}
                        <strong style={{ color: "#0f172a" }}>{computed.fornecedorVencedor}</strong>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="section-card">
            <div className="section-head">
              <span className="msi msi-sm">inventory_2</span>
              <h2 className="section-title">Itens da ordem</h2>
            </div>

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
                    <div className="item-grid">
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

                    <div className="item-grid-2">
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
                        <div className="muted">Valor é guardado no texto do item (não existe coluna de valor em items).</div>
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

          <section className="section-card">
            <button className="preview-toggle" type="button" onClick={() => setExpandedPreview((v) => !v)}>
              <span>Prévia da mensagem (WhatsApp)</span>
              <span className="muted">{expandedPreview ? "Recolher ▲" : "Mostrar ▼"}</span>
            </button>

            {expandedPreview && <div className="preview-box">{whatsappPreview}</div>}

            {errorMsg ? <div className="err">{errorMsg}</div> : null}

            <div className="actions">
              <button className="btn-primary" type="button" onClick={saveOrder} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </button>

              {saved && (
                <>
                  <button className="btn-secondary" type="button" onClick={copyText}>
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
                Salvo com sucesso • ID: <strong>{savedOrderId}</strong>
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </>
  );
}
