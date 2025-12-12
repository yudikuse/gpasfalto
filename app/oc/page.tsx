// FILE: app/oc/page.tsx
"use client";

import { useMemo, useState } from "react";
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
  quantity: string;
  description: string;
  value: string;
};

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  COMPRA: "Compra",
  ABASTECIMENTO: "Abastecimento",
  MANUTENCAO: "Manutenção",
  SERVICOS: "Serviços",
  PECAS: "Peças",
  OUTRO: "Outro",
};

/** quais campos aparecem por tipo – padrão MANUTENÇÃO */
type OrderTypeConfig = {
  showEquipamento: boolean;
  showObra: boolean;
  showOperador: boolean;
  showHorimetro: boolean;
  showLocalEntrega: boolean;
};

const ORDER_TYPE_CONFIG: Record<OrderType, OrderTypeConfig> = {
  MANUTENCAO: {
    showEquipamento: true,
    showObra: true,
    showOperador: true,
    showHorimetro: true,
    showLocalEntrega: true,
  },
  COMPRA: {
    showEquipamento: false,
    showObra: true,
    showOperador: false,
    showHorimetro: false,
    showLocalEntrega: true,
  },
  ABASTECIMENTO: {
    showEquipamento: true,
    showObra: true,
    showOperador: true,
    showHorimetro: true,
    showLocalEntrega: true,
  },
  SERVICOS: {
    showEquipamento: false,
    showObra: true,
    showOperador: false,
    showHorimetro: false,
    showLocalEntrega: true,
  },
  PECAS: {
    showEquipamento: true,
    showObra: true,
    showOperador: false,
    showHorimetro: true,
    showLocalEntrega: true,
  },
  OUTRO: {
    showEquipamento: false,
    showObra: true,
    showOperador: false,
    showHorimetro: false,
    showLocalEntrega: true,
  },
};

/** sugestões para autocomplete – depois você troca pelos reais */
const EQUIPAMENTOS_SUGESTOES = ["UA-01", "UA-02", "UA-03", "RC-05", "TP-04", "PC-07"];
const OBRAS_SUGESTOES = ["Usina", "Patrolamento", "Tapa-buraco", "Serviço interno", "Obra externa"];
const LOCAIS_SUGESTOES = ["Usina", "Oficina", "Almoxarifado", "Hidrovolt", "Posto conveniado"];
const OPERADORES_SUGESTOES = ["Marco Túlio", "João", "Carlos", "Rafael", "Bruno"];

export default function OcPage() {
  // padrão: MANUTENÇÃO
  const [orderType, setOrderType] = useState<OrderType>("MANUTENCAO");

  const [equipamento, setEquipamento] = useState("");
  const [obra, setObra] = useState("");
  const [operador, setOperador] = useState("");
  const [horimetro, setHorimetro] = useState("");
  const [localEntrega, setLocalEntrega] = useState("");
  const [observacoes, setObservacoes] = useState("");

  const [items, setItems] = useState<OrderItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const config = ORDER_TYPE_CONFIG[orderType];

  function addItem() {
    setItems((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        quantity: "",
        description: "",
        value: "",
      },
    ]);
  }

  function updateItem(id: string, field: keyof OrderItem, value: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  /** preview da mensagem pro WhatsApp */
  const previewText = useMemo(() => {
    const lines: string[] = [];

    if (orderType === "COMPRA") {
      lines.push("*PEDIDO DE COMPRA*");
    } else if (orderType === "ABASTECIMENTO") {
      lines.push("*PEDIDO DE ABASTECIMENTO DE EQUIPAMENTOS*");
    } else if (orderType === "MANUTENCAO") {
      lines.push("*PEDIDO DE COMPRA MANUTENÇÃO*");
    } else if (orderType === "PECAS") {
      lines.push("*PEDIDO DE PEÇAS*");
    } else if (orderType === "SERVICOS") {
      lines.push("*PEDIDO DE SERVIÇOS*");
    } else {
      lines.push(`*PEDIDO – ${ORDER_TYPE_LABELS[orderType]}*`);
    }

    lines.push("");

    if (obra) lines.push(`*Obra:* ${obra}`);
    if (config.showEquipamento && equipamento)
      lines.push(`*Código:* ${equipamento}`);
    if (config.showOperador && operador) lines.push(`*Operador:* ${operador}`);
    if (config.showHorimetro && horimetro)
      lines.push(`*Horímetro:* ${horimetro}`);
    if (config.showLocalEntrega && localEntrega)
      lines.push(`*Local de entrega:* ${localEntrega}`);

    if (items.length > 0) {
      lines.push("");
      lines.push("*A autorizar:*");
      lines.push("");
      items.forEach((item) => {
        const valorParte = item.value ? ` – R$ ${item.value}` : "";
        const qtdParte = item.quantity ? `${item.quantity} ` : "";
        lines.push(`${qtdParte}${item.description}${valorParte}`);
      });
    }

    if (observacoes) {
      lines.push("");
      lines.push(`*Obs:* ${observacoes}`);
    }

    return lines.join("\n");
  }, [
    orderType,
    obra,
    equipamento,
    operador,
    horimetro,
    localEntrega,
    items,
    observacoes,
    config.showEquipamento,
    config.showHorimetro,
    config.showLocalEntrega,
    config.showOperador,
  ]);

  async function handleSave() {
    setError(null);
    setFeedback(null);
    setSaving(true);

    try {
      const total = items.reduce((sum, item) => {
        const v = parseFloat(item.value.replace(".", "").replace(",", "."));
        if (!isNaN(v)) return sum + v;
        return sum;
      }, 0);

      const { data, error: insertError } = await supabase
        .from("orders")
        .insert([
          {
            tipo: orderType,
            equipamento: config.showEquipamento ? equipamento || null : null,
            obra: config.showObra ? obra || null : null,
            operador: config.showOperador ? operador || null : null,
            horimetro: config.showHorimetro ? horimetro || null : null,
            local_entrega: config.showLocalEntrega
              ? localEntrega || null
              : null,
            observacoes: observacoes || null,
            valor_total: total || null,
            texto_whatsapp: previewText || null,
          },
        ])
        .select()
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      if (data && items.length > 0) {
        const itemsPayload = items.map((item) => ({
          ordem_id: data.id,
          descricao: item.description,
          quantidade_texto: item.quantity || null,
          valor_texto: item.value || null,
        }));

        const { error: itemsError } = await supabase
          .from("order_items")
          .insert(itemsPayload);

        if (itemsError) {
          console.error(itemsError);
        }
      }

      setFeedback("Ordem salva com sucesso.");
    } catch (e: any) {
      setError(e?.message || "Erro ao salvar a ordem.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    if (!previewText) return;
    try {
      await navigator.clipboard.writeText(previewText);
      setFeedback("Mensagem copiada para a área de transferência.");
    } catch {
      setError("Não foi possível copiar a mensagem.");
    }
  }

  function handleWhatsapp() {
    if (!previewText) return;
    const url = `https://wa.me/?text=${encodeURIComponent(previewText)}`;
    window.open(url, "_blank");
  }

  return (
    <main className="page-root">
      <div className="page-container" style={{ maxWidth: 520 }}>
        {/* Título simples, seguindo a cara do dash */}
        <div className="section-card" style={{ paddingBottom: 14 }}>
          <h1
            style={{
              margin: 0,
              fontSize: "1.1rem",
              fontWeight: 600,
            }}
          >
            Registrar Ordem de Compra
          </h1>
          <p
            style={{
              margin: "4px 0 0 0",
              fontSize: "0.8rem",
              color: "#9ca3af",
            }}
          >
            Criar OC rápida e padrão para WhatsApp
          </p>
        </div>

        {/* Tipo de pedido */}
        <div className="section-card">
          <div className="section-header" style={{ marginBottom: 8 }}>
            <div className="section-title" style={{ fontSize: "0.85rem" }}>
              Tipo de Pedido
            </div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 8,
            }}
          >
            {(
              [
                "COMPRA",
                "ABASTECIMENTO",
                "MANUTENCAO",
                "SERVICOS",
                "PECAS",
                "OUTRO",
              ] as OrderType[]
            ).map((type) => {
              const selected = orderType === type;

              const icon =
                type === "COMPRA"
                  ? "🛒"
                  : type === "ABASTECIMENTO"
                  ? "⛽"
                  : type === "MANUTENCAO"
                  ? "🛠️"
                  : type === "SERVICOS"
                  ? "📋"
                  : type === "PECAS"
                  ? "🧩"
                  : "➕";

              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setOrderType(type)}
                  style={{
                    borderRadius: 14,
                    border: "1px solid #e5e7eb",
                    background: "#ffffff",
                    padding: "8px 10px",
                    fontSize: "0.8rem",
                    color: "#374151",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    cursor: "pointer",
                    boxShadow: selected
                      ? "0 4px 12px rgba(16,185,129,0.3)"
                      : "none",
                    borderColor: selected ? "#10b981" : "#e5e7eb",
                  }}
                >
                  <span style={{ fontSize: "1rem" }}>{icon}</span>
                  <span>{ORDER_TYPE_LABELS[type]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Dados essenciais */}
        <div className="section-card">
          <div className="section-header" style={{ marginBottom: 8 }}>
            <div className="section-title" style={{ fontSize: "0.85rem" }}>
              Dados Essenciais
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {config.showEquipamento && (
              <Field
                label="Equipamento"
                placeholder="Digite ou selecione o equipamento"
                value={equipamento}
                onChange={setEquipamento}
                datalistId="equipamentos-list"
              />
            )}

            {config.showObra && (
              <Field
                label="Obra"
                placeholder="Nome da obra"
                value={obra}
                onChange={setObra}
                datalistId="obras-list"
              />
            )}

            {config.showOperador && (
              <Field
                label="Operador"
                placeholder="Nome do operador"
                value={operador}
                onChange={setOperador}
                datalistId="operadores-list"
              />
            )}

            {config.showHorimetro && (
              <Field
                label="Horímetro"
                placeholder="Ex: 1234h"
                value={horimetro}
                onChange={setHorimetro}
              />
            )}

            {config.showLocalEntrega && (
              <Field
                label="Local de entrega"
                placeholder="Endereço ou local"
                value={localEntrega}
                onChange={setLocalEntrega}
                datalistId="locais-list"
              />
            )}

            <div>
              <div
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  color: "#374151",
                  marginBottom: 2,
                }}
              >
                Observações
              </div>
              <textarea
                style={{
                  width: "100%",
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  background: "#f9fafb",
                  padding: "8px 10px",
                  fontSize: "0.8rem",
                  resize: "vertical",
                  minHeight: 70,
                }}
                placeholder="Informações adicionais..."
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Itens */}
        <div className="section-card">
          <div className="section-header" style={{ marginBottom: 8 }}>
            <div className="section-title" style={{ fontSize: "0.85rem" }}>
              Itens da ordem
            </div>
          </div>

          <button
            type="button"
            onClick={addItem}
            style={{
              width: "100%",
              borderRadius: 12,
              border: "1px dashed #d1fae5",
              background: "#f0fdf4",
              padding: "8px 10px",
              fontSize: "0.8rem",
              fontWeight: 500,
              color: "#047857",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              cursor: "pointer",
            }}
          >
            <span>＋</span>
            <span>Adicionar item</span>
          </button>

          {items.length === 0 && (
            <p
              style={{
                marginTop: 6,
                fontSize: "0.75rem",
                color: "#9ca3af",
              }}
            >
              Nenhum item adicionado ainda.
            </p>
          )}

          {items.length > 0 && (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    background: "#f9fafb",
                    padding: "8px 10px",
                    fontSize: "0.78rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <ItemLabel>Quantidade</ItemLabel>
                      <input
                        style={itemInputStyle}
                        placeholder="Ex: 2"
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(item.id, "quantity", e.target.value)
                        }
                      />
                    </div>
                    <div style={{ flex: 2 }}>
                      <ItemLabel>Descrição</ItemLabel>
                      <input
                        style={itemInputStyle}
                        placeholder="Ex: mangueira hidráulica"
                        value={item.description}
                        onChange={(e) =>
                          updateItem(item.id, "description", e.target.value)
                        }
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-end",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <ItemLabel>Valor (opcional)</ItemLabel>
                      <input
                        style={itemInputStyle}
                        placeholder="Ex: 250,00"
                        value={item.value}
                        onChange={(e) =>
                          updateItem(item.id, "value", e.target.value)
                        }
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(item.id)}
                      style={{
                        borderRadius: 999,
                        border: "1px solid #e5e7eb",
                        background: "#ffffff",
                        padding: "4px 10px",
                        fontSize: "0.7rem",
                        color: "#6b7280",
                        cursor: "pointer",
                      }}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="section-card">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "0.8rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
            onClick={() => setPreviewOpen((v) => !v)}
          >
            <span>Prévia da mensagem (WhatsApp)</span>
            <span
              style={{
                fontSize: "0.7rem",
                color: "#6b7280",
              }}
            >
              {previewOpen ? "Recolher ▲" : "Mostrar ▼"}
            </span>
          </div>

          {previewOpen && (
            <div
              style={{
                marginTop: 8,
                borderRadius: 12,
                border: "1px solid #bbf7d0",
                background: "#ecfdf5",
                padding: "10px 12px",
                fontSize: "0.78rem",
                color: "#065f46",
                whiteSpace: "pre-wrap",
              }}
            >
              {previewText || "Preencha os campos para gerar a mensagem."}
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="section-card">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                width: "100%",
                borderRadius: 999,
                border: "none",
                padding: "10px 14px",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
                background: "#16a34a",
                color: "#ffffff",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>

            <button
              type="button"
              onClick={handleCopy}
              style={{
                width: "100%",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                padding: "10px 14px",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
                background: "#ffffff",
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
                padding: "10px 14px",
                fontSize: "0.85rem",
                fontWeight: 600,
                cursor: "pointer",
                background: "#25d366",
                color: "#ffffff",
              }}
            >
              Enviar no WhatsApp
            </button>

            {feedback && (
              <p
                style={{
                  margin: "4px 0 0 0",
                  fontSize: "0.75rem",
                  color: "#047857",
                }}
              >
                {feedback}
              </p>
            )}
            {error && (
              <p
                style={{
                  margin: "4px 0 0 0",
                  fontSize: "0.75rem",
                  color: "#b91c1c",
                }}
              >
                {error}
              </p>
            )}
          </div>
        </div>

        {/* datalists para autocomplete */}
        <datalist id="equipamentos-list">
          {EQUIPAMENTOS_SUGESTOES.map((opt) => (
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
      </div>
    </main>
  );
}

/** componentes auxiliares */

const itemInputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  padding: "6px 8px",
  fontSize: "0.75rem",
};

function ItemLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "0.7rem",
        fontWeight: 500,
        color: "#4b5563",
        marginBottom: 2,
      }}
    >
      {children}
    </div>
  );
}

type FieldProps = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  datalistId?: string;
};

function Field({
  label,
  placeholder,
  value,
  onChange,
  datalistId,
}: FieldProps) {
  return (
    <div>
      <div
        style={{
          fontSize: "0.75rem",
          fontWeight: 500,
          color: "#374151",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <input
        style={{
          width: "100%",
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
          padding: "8px 10px",
          fontSize: "0.8rem",
        }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={datalistId}
      />
    </div>
  );
}
