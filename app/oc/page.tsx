// FILE: app/oc/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type OrderType =
  | "COMPRA"
  | "ABASTECIMENTO"
  | "MANUTENCAO"
  | "SERVICOS"
  | "PECAS"
  | "OUTRO";

type OrderItem = {
  id: string;
  quantity: string; // máscara: inteiro
  description: string;
  value: string; // máscara: moeda BR (1.234,56)
};

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  COMPRA: "Compra",
  ABASTECIMENTO: "Abastecimento",
  MANUTENCAO: "Manutenção",
  SERVICOS: "Serviços",
  PECAS: "Peças",
  OUTRO: "Outro",
};

type OrderTypeConfig = {
  showEquipamento: boolean;
  showObra: boolean;
  showOperador: boolean;
  showHorimetro: boolean;
  showLocalEntrega: boolean;
  showFornecedores: boolean; // NOVO
};

const ORDER_TYPE_CONFIG: Record<OrderType, OrderTypeConfig> = {
  MANUTENCAO: {
    showEquipamento: true,
    showObra: true,
    showOperador: true,
    showHorimetro: true,
    showLocalEntrega: true,
    showFornecedores: true,
  },
  COMPRA: {
    showEquipamento: false,
    showObra: true,
    showOperador: false,
    showHorimetro: false,
    showLocalEntrega: true,
    showFornecedores: false,
  },
  ABASTECIMENTO: {
    showEquipamento: true,
    showObra: true,
    showOperador: true,
    showHorimetro: true,
    showLocalEntrega: true,
    showFornecedores: false,
  },
  SERVICOS: {
    showEquipamento: false,
    showObra: true,
    showOperador: false,
    showHorimetro: false,
    showLocalEntrega: true,
    showFornecedores: false,
  },
  PECAS: {
    showEquipamento: true,
    showObra: true,
    showOperador: false,
    showHorimetro: true,
    showLocalEntrega: true,
    showFornecedores: false,
  },
  OUTRO: {
    showEquipamento: false,
    showObra: true,
    showOperador: false,
    showHorimetro: false,
    showLocalEntrega: true,
    showFornecedores: false,
  },
};

const ORDER_TYPE_DB_LABEL: Record<OrderType, string> = {
  MANUTENCAO: "PEDIDO_COMPRA_MANUTENCAO",
  COMPRA: "PEDIDO_COMPRA",
  ABASTECIMENTO: "OC",
  SERVICOS: "OC",
  PECAS: "OC",
  OUTRO: "OC",
};

// Sugestões rápidas
const OBRAS_SUGESTOES = ["Usina", "Patrolamento", "Tapa-buraco", "Serviço interno"];
const LOCAIS_SUGESTOES = ["Usina", "Oficina", "Almoxarifado", "Hidrovolt"];
const OPERADORES_SUGESTOES = ["Marco Túlio", "João", "Carlos", "Rafael", "Bruno"];
const FORNECEDORES_SUGESTOES = ["Fornecedor A", "Fornecedor B", "Fornecedor C"]; // livre + pode ajustar depois

// ====== MÁSCARAS ======
function maskInteger(raw: string) {
  const digits = raw.replace(/\D/g, "");
  return digits.replace(/^0+(?=\d)/, "");
}

function maskDecimal2(raw: string) {
  let v = raw.replace(/[^\d,]/g, "");
  const parts = v.split(",");
  const intPart = (parts[0] || "").replace(/^0+(?=\d)/, "");
  const decPart = (parts[1] || "").slice(0, 2);
  if (parts.length > 1) return `${intPart || "0"},${decPart}`;
  return intPart;
}

function maskBRLMoney(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const asNumber = Number(digits) / 100;
  return asNumber.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function Icon({ name }: { name: OrderType }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (name) {
    case "COMPRA":
      return (
        <svg {...common}>
          <path d="M6 6h15l-1.5 8h-12L6 6Z" />
          <path d="M6 6 5 3H2" />
          <path d="M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
          <path d="M18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
        </svg>
      );
    case "ABASTECIMENTO":
      return (
        <svg {...common}>
          <path d="M7 4h8v6H7V4Z" />
          <path d="M15 7h2.5a1.5 1.5 0 0 1 1.5 1.5V20H7V10" />
          <path d="M10 13h4" />
        </svg>
      );
    case "MANUTENCAO":
      return (
        <svg {...common}>
          <path d="M21 8a5 5 0 0 1-7 4.6L8.6 18 6 15.4l5.4-5.4A5 5 0 0 1 16 3l-2 2 3 3 2-2Z" />
          <path d="M6 20l-2-2" />
        </svg>
      );
    case "SERVICOS":
      return (
        <svg {...common}>
          <path d="M7 3h10v18H7V3Z" />
          <path d="M9 7h6" />
          <path d="M9 11h6" />
          <path d="M9 15h4" />
        </svg>
      );
    case "PECAS":
      return (
        <svg {...common}>
          <path d="M12 8a4 4 0 0 0-4 4v1H6v-1a6 6 0 0 1 12 0v1h-2v-1a4 4 0 0 0-4-4Z" />
          <path d="M8 13h8v8H8v-8Z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
  }
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#374151" }}>{label}</div>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          border: "1px solid #e5e7eb",
          background: "#fff",
          borderRadius: 999,
          padding: "6px 10px",
        }}
      >
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          style={stepBtn}
          aria-label="Diminuir"
        >
          –
        </button>
        <div style={{ minWidth: 18, textAlign: "center", fontWeight: 700, color: "#111827" }}>
          {value}
        </div>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          style={stepBtn}
          aria-label="Aumentar"
        >
          +
        </button>
      </div>
    </div>
  );
}

const stepBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 999,
  border: "1px solid #e5e7eb",
  background: "#f9fafb",
  cursor: "pointer",
  fontWeight: 800,
  color: "#374151",
  lineHeight: "28px",
};

export default function OcPage() {
  const [orderType, setOrderType] = useState<OrderType>("MANUTENCAO");

  const [orderId, setOrderId] = useState<number | null>(null);
  const [numeroOc, setNumeroOc] = useState("");

  const [equipamento, setEquipamento] = useState("");
  const [obra, setObra] = useState("");
  const [operador, setOperador] = useState("");
  const [horimetro, setHorimetro] = useState("");
  const [localEntrega, setLocalEntrega] = useState("");
  const [observacoes, setObservacoes] = useState("");

  // FORNECEDORES (somente manutenção)
  const [supplierCount, setSupplierCount] = useState(1);
  const [supplier1, setSupplier1] = useState("");
  const [supplier2, setSupplier2] = useState("");
  const [supplier3, setSupplier3] = useState("");

  const [items, setItems] = useState<OrderItem[]>([]);

  const [saving, setSaving] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [equipOptionsFromDb, setEquipOptionsFromDb] = useState<string[]>([]);

  const config = ORDER_TYPE_CONFIG[orderType];

  function markDirty() {
    setHasSaved(false);
    setFeedback(null);
  }

  // reset fornecedores ao trocar tipo (mantém simples)
  useEffect(() => {
    if (orderType !== "MANUTENCAO") return;
    // quando volta pra manutenção, mantém valores (não zera)
  }, [orderType]);

  // TODOS equipamentos (histórico)
  useEffect(() => {
    async function loadEquipamentos() {
      const { data, error } = await supabase
        .from("orders_2025_raw")
        .select("codigo_equipamento");

      if (!error && data) {
        const set = new Set<string>();
        data.forEach((row: any) => {
          if (row.codigo_equipamento) set.add(String(row.codigo_equipamento));
        });
        setEquipOptionsFromDb([...set].sort((a, b) => a.localeCompare(b)));
      }
    }
    loadEquipamentos();
  }, []);

  // Próxima OC sugerida (editável)
  useEffect(() => {
    async function loadNextOc() {
      const { data, error } = await supabase
        .from("orders_2025_raw")
        .select("numero_oc")
        .not("numero_oc", "is", null)
        .order("id", { ascending: false })
        .limit(1);

      if (!error && data && data.length > 0) {
        const last = String(data[0].numero_oc || "");
        const match = last.match(/(\d+)/);
        if (match) {
          const prefix = last.replace(match[1], "");
          const nextNum = String(parseInt(match[1], 10) + 1);
          setNumeroOc(prefix + nextNum);
        }
      }
    }
    loadNextOc();
  }, []);

  function addItem() {
    markDirty();
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), quantity: "", description: "", value: "" },
    ]);
  }

  function updateItem(id: string, field: keyof OrderItem, value: string) {
    markDirty();
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  }

  function removeItem(id: string) {
    markDirty();
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  const suppliersList = useMemo(() => {
    if (!config.showFornecedores) return [];
    const list = [supplier1, supplier2, supplier3].slice(0, supplierCount).map((s) => s.trim()).filter(Boolean);
    return list;
  }, [config.showFornecedores, supplier1, supplier2, supplier3, supplierCount]);

  const previewText = useMemo(() => {
    const lines: string[] = [];

    const header =
      orderType === "COMPRA"
        ? "🧾 *PEDIDO DE COMPRA*"
        : orderType === "ABASTECIMENTO"
        ? "⛽ *PEDIDO DE ABASTECIMENTO*"
        : orderType === "MANUTENCAO"
        ? "🛠️ *PEDIDO DE COMPRA – MANUTENÇÃO*"
        : orderType === "PECAS"
        ? "⚙️ *PEDIDO DE PEÇAS*"
        : orderType === "SERVICOS"
        ? "📄 *PEDIDO DE SERVIÇOS*"
        : `📌 *PEDIDO – ${ORDER_TYPE_LABELS[orderType]}*`;

    lines.push(header);
    lines.push(`• *OC:* ${numeroOc || "-"}`);
    lines.push(`• *ID:* ${orderId != null ? String(orderId) : "-"}`);
    lines.push("");

    if (config.showObra) lines.push(`• *Obra:* ${obra || "-"}`);
    if (config.showEquipamento) lines.push(`• *Equipamento:* ${equipamento || "-"}`);
    if (config.showOperador) lines.push(`• *Operador:* ${operador || "-"}`);
    if (config.showHorimetro) lines.push(`• *Horímetro:* ${horimetro ? `${horimetro}h` : "-"}`);
    if (config.showLocalEntrega) lines.push(`• *Entrega:* ${localEntrega || "-"}`);

    if (config.showFornecedores) {
      lines.push("");
      if (suppliersList.length === 0) {
        lines.push("• *Fornecedores:* -");
      } else {
        lines.push("• *Fornecedores:*");
        suppliersList.forEach((f, idx) => lines.push(`  ${idx + 1}) ${f}`));
      }
    }

    lines.push("");
    lines.push("*Itens:*");

    if (items.length === 0) {
      lines.push("• (sem itens)");
    } else {
      items.forEach((item) => {
        const valorParte = item.value ? ` — R$ ${item.value}` : "";
        const qtdParte = item.quantity ? `${item.quantity}x ` : "";
        lines.push(`• ${qtdParte}${item.description || "(sem descrição)"}${valorParte}`);
      });
    }

    if (observacoes) {
      lines.push("");
      lines.push(`*Obs:* ${observacoes}`);
    }

    return lines.join("\n");
  }, [
    orderType,
    numeroOc,
    orderId,
    obra,
    equipamento,
    operador,
    horimetro,
    localEntrega,
    items,
    observacoes,
    config,
    suppliersList,
  ]);

  async function handleSave() {
    setError(null);
    setFeedback(null);
    setSaving(true);

    try {
      const now = new Date();
      const dateStr = now.toLocaleDateString("pt-BR");
      const timeStr = now.toLocaleTimeString("pt-BR", { hour12: false }).split(" ")[0];
      const mesAno = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const tipoRegistro = ORDER_TYPE_DB_LABEL[orderType];
      const firstItem = items[0];

      const payload = {
        date: dateStr,
        time: timeStr,
        mes_ano: mesAno,
        tipo_registro: tipoRegistro,
        numero_oc: numeroOc || null,
        codigo_equipamento: config.showEquipamento ? equipamento || null : null,
        obra: config.showObra ? obra || null : null,
        solicitante: null,
        operador: config.showOperador ? operador || null : null,
        horimetro: config.showHorimetro ? (horimetro ? `${horimetro}h` : null) : null,
        material: firstItem?.description || null,
        quantidade_texto: firstItem?.quantity || null,
        local_entrega: config.showLocalEntrega ? localEntrega || null : null,
        placa: null,
        valor_menor: null,
        moeda: null,
        texto_original: previewText || null, // fornecedores entram aqui também
      };

      const { data, error: insertError } = await supabase
        .from("orders_2025_raw")
        .insert([payload])
        .select()
        .single();

      if (insertError) throw new Error(insertError.message);

      const newId = data.id as number;
      setOrderId(newId);

      if (items.length > 0) {
        const itemsPayload = items.map((item) => {
          const qtdNum = item.quantity ? parseFloat(item.quantity) : NaN;
          return {
            ordem_id: newId,
            data: dateStr,
            hora: timeStr,
            numero_oc: numeroOc || null,
            descricao: item.description,
            quantidade_texto: item.quantity || null,
            quantidade_num: Number.isFinite(qtdNum) ? qtdNum : null,
          };
        });

        const { error: itemsError } = await supabase
          .from("orders_2025_items")
          .insert(itemsPayload);
        if (itemsError) console.error(itemsError);
      }

      setHasSaved(true);
      setFeedback("Ordem salva com sucesso.");
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Erro ao salvar a ordem.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    if (!hasSaved) return;
    await navigator.clipboard.writeText(previewText);
    setFeedback("Mensagem copiada.");
  }

  function handleWhatsapp() {
    if (!hasSaved) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(previewText)}`, "_blank");
  }

  return (
    <main className="page-root">
      <div className="page-container" style={{ maxWidth: 520 }}>
        {/* HEADER */}
        <header style={{ textAlign: "center", padding: "8px 0 2px" }}>
          <img
            src="/gpasfalto-logo.png"
            alt="GP Asfalto"
            style={{
              height: 72,
              width: "auto",
              display: "block",
              margin: "0 auto 8px",
              opacity: 0.95,
            }}
          />
          <div style={{ fontSize: "1.65rem", fontWeight: 650, letterSpacing: "-0.02em" }}>
            Registrar OC
          </div>
          <div style={{ fontSize: "0.86rem", color: "var(--gp-muted-soft)", marginTop: 4 }}>
            Criar OC rápida e padrão para WhatsApp
          </div>
        </header>

        {/* Tipo de pedido */}
        <section className="section-card">
          <div className="section-header" style={{ marginBottom: 10 }}>
            <div className="section-title">Tipo de Pedido</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
            {(Object.keys(ORDER_TYPE_LABELS) as OrderType[]).map((t) => {
              const selected = orderType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    markDirty();
                    setOrderType(t);
                  }}
                  style={{
                    borderRadius: 14,
                    border: "1px solid",
                    borderColor: selected ? "#10b981" : "#e5e7eb",
                    background: selected ? "#ecfdf5" : "#ffffff",
                    padding: "12px 10px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    minHeight: 76,
                  }}
                >
                  <div style={{ color: "#6b7280" }}>
                    <Icon name={t} />
                  </div>
                  <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#374151" }}>
                    {ORDER_TYPE_LABELS[t]}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Dados essenciais */}
        <section className="section-card">
          <div className="section-header">
            <div>
              <div className="section-title">Dados Essenciais</div>
              <div className="section-subtitle">Padrão: Manutenção</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
            <Field label="ID" value={orderId != null ? String(orderId) : ""} placeholder="-" readOnly />
            <Field
              label="OC"
              value={numeroOc}
              placeholder="OC2025..."
              onChange={(v) => {
                markDirty();
                setNumeroOc(v);
              }}
            />
          </div>

          {config.showEquipamento && (
            <Field
              label="Equipamento"
              value={equipamento}
              placeholder="Digite ou selecione o equipamento"
              onChange={(v) => {
                markDirty();
                setEquipamento(v);
              }}
              datalistId="equipamentos-list"
            />
          )}

          {config.showObra && (
            <Field
              label="Obra"
              value={obra}
              placeholder="Nome da obra"
              onChange={(v) => {
                markDirty();
                setObra(v);
              }}
              datalistId="obras-list"
            />
          )}

          {config.showOperador && (
            <Field
              label="Operador"
              value={operador}
              placeholder="Nome do operador"
              onChange={(v) => {
                markDirty();
                setOperador(v);
              }}
              datalistId="operadores-list"
            />
          )}

          {config.showHorimetro && (
            <Field
              label="Horímetro"
              value={horimetro}
              placeholder="Ex: 1234,50"
              inputMode="decimal"
              onChange={(v) => {
                markDirty();
                setHorimetro(maskDecimal2(v));
              }}
              rightHint="h"
            />
          )}

          {config.showLocalEntrega && (
            <Field
              label="Local de entrega"
              value={localEntrega}
              placeholder="Endereço ou local"
              onChange={(v) => {
                markDirty();
                setLocalEntrega(v);
              }}
              datalistId="locais-list"
            />
          )}

          {/* FORNECEDORES (somente manutenção) */}
          {config.showFornecedores && (
            <div style={{ marginTop: 12 }}>
              <Stepper
                label="Fornecedores (até 3)"
                value={supplierCount}
                min={1}
                max={3}
                onChange={(n) => {
                  markDirty();
                  setSupplierCount(n);
                }}
              />

              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <Field
                  label="Fornecedor 1"
                  value={supplier1}
                  placeholder="Digite ou selecione"
                  onChange={(v) => {
                    markDirty();
                    setSupplier1(v);
                  }}
                  datalistId="fornecedores-list"
                />
                {supplierCount >= 2 && (
                  <Field
                    label="Fornecedor 2"
                    value={supplier2}
                    placeholder="Digite ou selecione"
                    onChange={(v) => {
                      markDirty();
                      setSupplier2(v);
                    }}
                    datalistId="fornecedores-list"
                  />
                )}
                {supplierCount >= 3 && (
                  <Field
                    label="Fornecedor 3"
                    value={supplier3}
                    placeholder="Digite ou selecione"
                    onChange={(v) => {
                      markDirty();
                      setSupplier3(v);
                    }}
                    datalistId="fornecedores-list"
                  />
                )}
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div className="section-subtitle" style={{ marginBottom: 6 }}>
              Observações
            </div>
            <textarea
              style={{
                width: "100%",
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                padding: "12px 12px",
                fontSize: "0.92rem",
                lineHeight: 1.3,
                minHeight: 88,
              }}
              placeholder="Informações adicionais..."
              value={observacoes}
              onChange={(e) => {
                markDirty();
                setObservacoes(e.target.value);
              }}
            />
          </div>
        </section>

        {/* Itens */}
        <section className="section-card">
          <div className="section-header" style={{ marginBottom: 12 }}>
            <div className="section-title">Itens da ordem</div>
          </div>

          <button
            type="button"
            onClick={addItem}
            style={{
              width: "100%",
              borderRadius: 14,
              border: "1px dashed #bbf7d0",
              background: "#f0fdf4",
              padding: "12px 12px",
              fontSize: "0.92rem",
              fontWeight: 700,
              color: "#047857",
              cursor: "pointer",
              lineHeight: 1.2,
            }}
          >
            + Adicionar item
          </button>

          {items.length === 0 ? (
            <div style={{ marginTop: 12, color: "#9ca3af", fontSize: "0.9rem" }}>
              Nenhum item adicionado ainda.
            </div>
          ) : (
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              {items.map((it) => (
                <div
                  key={it.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 16,
                    background: "#ffffff",
                    padding: 14,
                    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.04)",
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12 }}>
                    <Field
                      label="Quantidade"
                      value={it.quantity}
                      placeholder="Ex: 2"
                      inputMode="numeric"
                      onChange={(v) => updateItem(it.id, "quantity", maskInteger(v))}
                      compact
                    />
                    <Field
                      label="Descrição"
                      value={it.description}
                      placeholder="Ex: mangueira hidráulica"
                      onChange={(v) => updateItem(it.id, "description", v)}
                      compact
                    />
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 140px",
                      gap: 12,
                      alignItems: "end",
                      marginTop: 12,
                    }}
                  >
                    <Field
                      label="Valor (opcional)"
                      value={it.value}
                      placeholder="Ex: 250,00"
                      inputMode="numeric"
                      onChange={(v) => updateItem(it.id, "value", maskBRLMoney(v))}
                      compact
                      leftHint="R$"
                    />

                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      style={{
                        height: 44,
                        borderRadius: 14,
                        border: "1px solid #e5e7eb",
                        background: "#fff",
                        padding: "0 14px",
                        cursor: "pointer",
                        color: "#6b7280",
                        fontWeight: 700,
                        fontSize: "0.92rem",
                      }}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Prévia */}
        <section className="section-card">
          <div
            className="section-header"
            style={{ cursor: "pointer" }}
            onClick={() => setPreviewOpen((v) => !v)}
          >
            <div className="section-title">Prévia da mensagem (WhatsApp)</div>
            <div className="section-subtitle">{previewOpen ? "Recolher ▲" : "Mostrar ▼"}</div>
          </div>

          {previewOpen && (
            <div
              style={{
                marginTop: 10,
                borderRadius: 16,
                border: "1px solid #d1fae5",
                background: "#ecfdf5",
                padding: 14,
                whiteSpace: "pre-wrap",
                fontSize: "0.95rem",
                lineHeight: 1.35,
                color: "#065f46",
              }}
            >
              {previewText}
            </div>
          )}
        </section>

        {/* Ações */}
        <section className="section-card">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              width: "100%",
              borderRadius: 999,
              border: "none",
              padding: "12px 14px",
              fontSize: "0.98rem",
              fontWeight: 800,
              cursor: "pointer",
              background: "#16a34a",
              color: "#fff",
              opacity: saving ? 0.75 : 1,
            }}
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>

          {hasSaved && (
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  width: "100%",
                  borderRadius: 999,
                  border: "1px solid #e5e7eb",
                  padding: "12px 14px",
                  fontSize: "0.98rem",
                  fontWeight: 800,
                  cursor: "pointer",
                  background: "#fff",
                  color: "#111827",
                }}
              >
                Copiar mensagem
              </button>

              <button
                type="button"
                onClick={handleWhatsapp}
                style={{
                  width: "100%",
                  borderRadius: 999,
                  border: "none",
                  padding: "12px 14px",
                  fontSize: "0.98rem",
                  fontWeight: 800,
                  cursor: "pointer",
                  background: "#25d366",
                  color: "#fff",
                }}
              >
                Enviar no WhatsApp
              </button>
            </div>
          )}

          {feedback && (
            <div style={{ marginTop: 10, color: "#047857", fontWeight: 700 }}>{feedback}</div>
          )}
          {error && (
            <div style={{ marginTop: 10, color: "#b91c1c", fontWeight: 700 }}>{error}</div>
          )}
        </section>

        {/* datalists */}
        <datalist id="equipamentos-list">
          {equipOptionsFromDb.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
        <datalist id="obras-list">
          {OBRAS_SUGESTOES.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
        <datalist id="locais-list">
          {LOCAIS_SUGESTOES.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
        <datalist id="operadores-list">
          {OPERADORES_SUGESTOES.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
        <datalist id="fornecedores-list">
          {FORNECEDORES_SUGESTOES.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
      </div>
    </main>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  datalistId,
  readOnly,
  inputMode,
  leftHint,
  rightHint,
  compact,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange?: (v: string) => void;
  datalistId?: string;
  readOnly?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  leftHint?: string;
  rightHint?: string;
  compact?: boolean;
}) {
  return (
    <div style={{ width: "100%", marginTop: compact ? 0 : 12 }}>
      <div
        style={{
          fontSize: compact ? "0.78rem" : "0.8rem",
          fontWeight: 650,
          color: "#374151",
          marginBottom: 6,
        }}
      >
        {label}
      </div>

      <div style={{ position: "relative" }}>
        {leftHint && (
          <div
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#9ca3af",
              fontWeight: 800,
              fontSize: "0.9rem",
              pointerEvents: "none",
            }}
          >
            {leftHint}
          </div>
        )}

        {rightHint && (
          <div
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#9ca3af",
              fontWeight: 800,
              fontSize: "0.9rem",
              pointerEvents: "none",
            }}
          >
            {rightHint}
          </div>
        )}

        <input
          value={value}
          readOnly={readOnly}
          list={datalistId}
          placeholder={placeholder}
          inputMode={inputMode}
          onChange={(e) => onChange?.(e.target.value)}
          style={{
            width: "100%",
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            background: readOnly ? "#f3f4f6" : "#f9fafb",
            padding: compact ? "10px 12px" : "12px 12px",
            paddingLeft: leftHint ? 40 : undefined,
            paddingRight: rightHint ? 40 : undefined,
            fontSize: "0.95rem",
            lineHeight: 1.2,
            outline: "none",
          }}
        />
      </div>
    </div>
  );
}
