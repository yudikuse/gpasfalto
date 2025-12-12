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

export default function OcPage() {
  const [orderType, setOrderType] = useState<OrderType>("COMPRA");

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

  const previewText = useMemo(() => {
    const lines: string[] = [];

    if (orderType === "COMPRA") {
      lines.push("*PEDIDO DE COMPRA*");
      lines.push("");
    } else if (orderType === "ABASTECIMENTO") {
      lines.push("*PEDIDO DE ABASTECIMENTO DE EQUIPAMENTOS*");
      lines.push("");
    } else if (orderType === "MANUTENCAO") {
      lines.push("*PEDIDO DE COMPRA MANUTENÇÃO*");
      lines.push("");
    } else {
      lines.push(`*PEDIDO – ${ORDER_TYPE_LABELS[orderType]}*`);
      lines.push("");
    }

    if (obra) lines.push(`*Obra:* ${obra}`);
    if (equipamento) lines.push(`*Código:* ${equipamento}`);
    if (operador) lines.push(`*Operador:* ${operador}`);
    if (horimetro) lines.push(`*Horímetro:* ${horimetro}`);
    if (localEntrega) lines.push(`*Local de entrega:* ${localEntrega}`);

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
  }, [orderType, obra, equipamento, operador, horimetro, localEntrega, items, observacoes]);

  async function handleSave() {
    setError(null);
    setFeedback(null);
    setSaving(true);

    try {
      const total = items.reduce((sum, item) => {
        const v = parseFloat(
          item.value.replace(".", "").replace(",", ".")
        );
        if (!isNaN(v)) return sum + v;
        return sum;
      }, 0);

      const { data, error: insertError } = await supabase
        .from("orders")
        .insert([
          {
            tipo: orderType,
            equipamento: equipamento || null,
            obra: obra || null,
            operador: operador || null,
            horimetro: horimetro || null,
            local_entrega: localEntrega || null,
            observacoes: observacoes || null,
            valor_total: total || null,
            texto_whatsapp: previewText || null,
          },
        ])
        .select()
        .single();

      if (insertError) {
        console.error(insertError);
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
      console.error(e);
      setError(
        e?.message || "Erro ao salvar a ordem. Verifique os dados."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    if (!previewText) return;
    try {
      await navigator.clipboard.writeText(previewText);
      setFeedback("Mensagem copiada para a área de transferência.");
    } catch (e) {
      console.error(e);
      setError("Não foi possível copiar a mensagem.");
    }
  }

  function handleWhatsapp() {
    if (!previewText) return;
    const url = `https://wa.me/?text=${encodeURIComponent(previewText)}`;
    window.open(url, "_blank");
  }

  return (
    <main className="oc-root">
      <div className="oc-container">
        <header>
          <h1 className="oc-header-title">Registrar Ordem de Compra</h1>
          <p className="oc-header-sub">
            Criar OC rápida e padrão para WhatsApp
          </p>
        </header>

        <div className="oc-main-grid">
          {/* Coluna esquerda */}
          <div className="oc-col-left">
            {/* Tipo de pedido */}
            <section className="oc-card">
              <h2 className="oc-card-title">Tipo de Pedido</h2>
              <div className="oc-type-grid">
                {(Object.keys(ORDER_TYPE_LABELS) as OrderType[]).map(
                  (type) => {
                    const selected = orderType === type;
                    return (
                      <button
                        key={type}
                        type="button"
                        className={
                          "oc-type-btn" +
                          (selected ? " oc-type-btn--active" : "")
                        }
                        onClick={() => setOrderType(type)}
                      >
                        <span className="oc-type-btn-icon">📌</span>
                        <span>{ORDER_TYPE_LABELS[type]}</span>
                      </button>
                    );
                  }
                )}
              </div>
            </section>

            {/* Dados essenciais */}
            <section className="oc-card">
              <h2 className="oc-card-title">Dados Essenciais</h2>
              <div className="oc-fields">
                <Field
                  label="Equipamento"
                  placeholder="Digite ou selecione o equipamento"
                  value={equipamento}
                  onChange={setEquipamento}
                />
                <Field
                  label="Obra"
                  placeholder="Nome da obra"
                  value={obra}
                  onChange={setObra}
                />
                <Field
                  label="Operador"
                  placeholder="Nome do operador"
                  value={operador}
                  onChange={setOperador}
                />
                <Field
                  label="Horímetro"
                  placeholder="Ex: 1234h"
                  value={horimetro}
                  onChange={setHorimetro}
                />
                <Field
                  label="Local de entrega"
                  placeholder="Endereço ou local"
                  value={localEntrega}
                  onChange={setLocalEntrega}
                />
                <div>
                  <label className="oc-field-label">Observações</label>
                  <textarea
                    className="oc-textarea"
                    placeholder="Informações adicionais..."
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                  />
                </div>
              </div>
            </section>

            {/* Itens da ordem */}
            <section className="oc-card">
              <h2 className="oc-card-title">Itens da ordem</h2>

              <button
                type="button"
                className="oc-add-item"
                onClick={addItem}
              >
                <span>＋</span>
                <span>Adicionar item</span>
              </button>

              {items.length === 0 && (
                <p className="oc-items-empty">
                  Nenhum item adicionado ainda.
                </p>
              )}

              {items.length > 0 && (
                <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {items.map((item) => (
                    <div key={item.id} className="oc-item-block">
                      <div className="oc-item-row">
                        <div>
                          <div className="oc-item-label">Quantidade</div>
                          <input
                            className="oc-item-input"
                            placeholder="Ex: 2"
                            value={item.quantity}
                            onChange={(e) =>
                              updateItem(item.id, "quantity", e.target.value)
                            }
                          />
                        </div>
                        <div style={{ flex: 2 }}>
                          <div className="oc-item-label">Descrição</div>
                          <input
                            className="oc-item-input"
                            placeholder="Ex: mangueira hidráulica"
                            value={item.description}
                            onChange={(e) =>
                              updateItem(
                                item.id,
                                "description",
                                e.target.value
                              )
                            }
                          />
                        </div>
                      </div>
                      <div className="oc-item-row" style={{ alignItems: "flex-end" }}>
                        <div>
                          <div className="oc-item-label">
                            Valor (opcional)
                          </div>
                          <input
                            className="oc-item-input"
                            placeholder="Ex: 250,00"
                            value={item.value}
                            onChange={(e) =>
                              updateItem(item.id, "value", e.target.value)
                            }
                          />
                        </div>
                        <button
                          type="button"
                          className="oc-item-remove"
                          onClick={() => removeItem(item.id)}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Coluna direita: preview + ações */}
          <div className="oc-col-right">
            <section className="oc-card">
              <button
                type="button"
                className="oc-preview-toggle"
                onClick={() => setPreviewOpen((v) => !v)}
              >
                <span>Prévia da mensagem (WhatsApp)</span>
                <span>{previewOpen ? "Recolher ▲" : "Mostrar ▼"}</span>
              </button>
              {previewOpen && (
                <div className="oc-preview-box">
                  {previewText || "Preencha os campos para gerar a mensagem."}
                </div>
              )}
            </section>

            <section className="oc-actions">
              <button
                type="button"
                className="oc-btn oc-btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>

              <button
                type="button"
                className="oc-btn oc-btn-outline"
                onClick={handleCopy}
              >
                Copiar mensagem
              </button>

              <button
                type="button"
                className="oc-btn oc-btn-whatsapp"
                onClick={handleWhatsapp}
              >
                Enviar no WhatsApp
              </button>

              {feedback && (
                <p className="oc-feedback">{feedback}</p>
              )}
              {error && <p className="oc-error">{error}</p>}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

type FieldProps = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
};

function Field({ label, placeholder, value, onChange }: FieldProps) {
  return (
    <div>
      <label className="oc-field-label">{label}</label>
      <input
        className="oc-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
