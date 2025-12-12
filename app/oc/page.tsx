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

/** rótulo que vai para a coluna tipo_registro da orders_2025_raw */
const ORDER_TYPE_DB_LABEL: Record<OrderType, string> = {
  MANUTENCAO: "PEDIDO_COMPRA_MANUTENCAO",
  COMPRA: "PEDIDO_COMPRA",
  ABASTECIMENTO: "OC",
  SERVICOS: "OC",
  PECAS: "OC",
  OUTRO: "OC",
};

/** sugestões base – depois você troca pelos reais se quiser */
const EQUIPAMENTOS_SUGESTOES_BASE = [
  "UA-01",
  "UA-02",
  "UA-03",
  "RC05",
  "TP03",
  "PC07",
  "CG02",
];

const OBRAS_SUGESTOES = [
  "Usina",
  "Patrolamento",
  "Tapa-buraco",
  "Serviço interno",
  "Obra externa",
];

const LOCAIS_SUGESTOES = [
  "Usina",
  "Oficina",
  "Almoxarifado",
  "Hidrovolt",
  "Posto conveniado",
];

const OPERADORES_SUGESTOES = [
  "Marco Túlio",
  "João",
  "Carlos",
  "Rafael",
  "Bruno",
];

export default function OcPage() {
  // padrão: MANUTENÇÃO
  const [orderType, setOrderType] = useState<OrderType>("MANUTENCAO");

  // dados principais
  const [orderId, setOrderId] = useState<number | null>(null);
  const [numeroOc, setNumeroOc] = useState("");
  const [equipamento, setEquipamento] = useState("");
  const [obra, setObra] = useState("");
  const [operador, setOperador] = useState("");
  const [horimetro, setHorimetro] = useState("");
  const [localEntrega, setLocalEntrega] = useState("");
  const [observacoes, setObservacoes] = useState("");

  const [items, setItems] = useState<OrderItem[]>([]);

  // estados auxiliares
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

  /** carrega todos os códigos de equipamento existentes na tabela */
  useEffect(() => {
    async function loadEquipamentos() {
      const { data, error } = await supabase
        .from("orders_2025_raw")
        .select("codigo_equipamento");

      if (!error && data) {
        const set = new Set<string>();
        data.forEach((row: any) => {
          if (row.codigo_equipamento) {
            set.add(String(row.codigo_equipamento));
          }
        });
        setEquipOptionsFromDb(Array.from(set));
      }
    }
    loadEquipamentos();
  }, []);

  /** sugere o próximo número de OC com base no último registro */
  useEffect(() => {
    async function loadNextOc() {
      const { data, error } = await supabase
        .from("orders_2025_raw")
        .select("numero_oc")
        .not("numero_oc", "is", null)
        .order("id", { ascending: false })
        .limit(1);

      if (!error && data && data.length > 0) {
        const last = data[0].numero_oc as string;
        if (!last) return;
        const match = last.match(/(\d+)/);
        if (match) {
          const prefix = last.replace(match[1], "");
          const nextNum = String(parseInt(match[1], 10) + 1);
          setNumeroOc(prefix + nextNum);
        } else {
          setNumeroOc(last);
        }
      }
    }
    loadNextOc();
  }, []);

  /** lista final de opções de equipamento (base + BD) */
  const allEquipOptions = useMemo(() => {
    const combined = [...EQUIPAMENTOS_SUGESTOES_BASE];
    equipOptionsFromDb.forEach((code) => {
      if (!combined.includes(code)) combined.push(code);
    });
    return combined.sort((a, b) => a.localeCompare(b));
  }, [equipOptionsFromDb]);

  function addItem() {
    markDirty();
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
    markDirty();
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  }

  function removeItem(id: string) {
    markDirty();
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  /** mensagem para WhatsApp com layout mais organizado */
  const previewText = useMemo(() => {
    const lines: string[] = [];

    // título principal
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

    if (numeroOc) {
      lines.push(`*OC:* ${numeroOc}`);
    }
    if (orderId != null) {
      lines.push(`*ID:* ${orderId}`);
    }

    lines.push("────────────────────");

    if (config.showObra && obra) lines.push(`*Obra:* ${obra}`);
    if (config.showEquipamento && equipamento)
      lines.push(`*Equipamento:* ${equipamento}`);
    if (config.showOperador && operador) lines.push(`*Operador:* ${operador}`);
    if (config.showHorimetro && horimetro)
      lines.push(`*Horímetro:* ${horimetro}`);
    if (config.showLocalEntrega && localEntrega)
      lines.push(`*Local de entrega:* ${localEntrega}`);

    if (
      (config.showObra && obra) ||
      (config.showEquipamento && equipamento) ||
      (config.showOperador && operador) ||
      (config.showHorimetro && horimetro) ||
      (config.showLocalEntrega && localEntrega)
    ) {
      lines.push("────────────────────");
    }

    if (items.length > 0) {
      lines.push("*Itens:*");
      lines.push("");
      items.forEach((item) => {
        const valorParte = item.value ? ` – R$ ${item.value}` : "";
        const qtdParte = item.quantity ? `${item.quantity} ` : "";
        lines.push(`• ${qtdParte}${item.description}${valorParte}`);
      });
    }

    if (observacoes) {
      lines.push("");
      lines.push("────────────────────");
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
    config.showEquipamento,
    config.showObra,
    config.showHorimetro,
    config.showLocalEntrega,
    config.showOperador,
  ]);

  async function handleSave() {
    setError(null);
    setFeedback(null);
    setSaving(true);

    try {
      const now = new Date();
      const dateStr = now.toLocaleDateString("pt-BR"); // dd/mm/aaaa
      const timeStr = now
        .toLocaleTimeString("pt-BR", {
          hour12: false,
        })
        .split(" ")[0]; // hh:mm:ss
      const mesAno = `${now.getFullYear()}-${String(
        now.getMonth() + 1
      ).padStart(2, "0")}`;

      const tipoRegistro = ORDER_TYPE_DB_LABEL[orderType];

      // material/quantidade_texto principais = primeiro item
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
        horimetro: config.showHorimetro ? horimetro || null : null,
        material: firstItem?.description || null,
        quantidade_texto: firstItem?.quantity || null,
        local_entrega: config.showLocalEntrega ? localEntrega || null : null,
        placa: null,
        valor_menor: null,
        moeda: null,
        texto_original: previewText || null,
      };

      const { data, error: insertError } = await supabase
        .from("orders_2025_raw")
        .insert([payload])
        .select()
        .single();

      if (insertError) {
        throw new Error(insertError.message);
      }

      const newId = data.id as number;
      setOrderId(newId);

      // grava itens detalhados
      if (items.length > 0) {
        const itemsPayload = items.map((item) => {
          const qtdNumStr = item.quantity.replace(".", "").replace(",", ".");
          const qtdNum = parseFloat(qtdNumStr);
          return {
            ordem_id: newId,
            data: dateStr,
            hora: timeStr,
            numero_oc: numeroOc || null,
            descricao: item.description,
            quantidade_texto: item.quantity || null,
            quantidade_num: isNaN(qtdNum) ? null : qtdNum,
          };
        });

        const { error: itemsError } = await supabase
          .from("orders_2025_items")
          .insert(itemsPayload);

        if (itemsError) {
          console.error(itemsError);
        }
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
    if (!previewText || !hasSaved) return;
    try {
      await navigator.clipboard.writeText(previewText);
      setFeedback("Mensagem copiada para a área de transferência.");
    } catch {
      setError("Não foi possível copiar a mensagem.");
    }
  }

  function handleWhatsapp() {
    if (!previewText || !hasSaved) return;
    const url = `https://wa.me/?text=${encodeURIComponent(previewText)}`;
    window.open(url, "_blank");
  }

  return (
    <main className="page-root">
      <div className="page-container" style={{ maxWidth: 520 }}>
        {/* Cabeçalho + logo central usando o mesmo "card" do dashboard */}
        <div className="section-card" style={{ paddingBottom: 16 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 18,
                background: "#ffffff",
                border: "1px solid #e5e7eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: "1rem",
                color: "#ff4b2b",
                boxShadow: "0 8px 20px rgba(15,23,42,0.08)",
              }}
            >
              GP
            </div>
            <div style={{ textAlign: "center" }}>
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
          </div>
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

              const iconChar =
                type === "COMPRA"
                  ? "⬢"
                  : type === "ABASTECIMENTO"
                  ? "⬡"
                  : type === "MANUTENCAO"
                  ? "⬟"
                  : type === "SERVICOS"
                  ? "⬠"
                  : type === "PECAS"
                  ? "◆"
                  : "＋";

              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => {
                    markDirty();
                    setOrderType(type);
                  }}
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
                  <span
                    style={{
                      fontSize: "1rem",
                      color: "#6b7280",
                    }}
                  >
                    {iconChar}
                  </span>
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
            {/* ID e OC */}
            <div
              style={{
                display: "flex",
                gap: 8,
              }}
            >
              <div style={{ flex: 1 }}>
                <Field
                  label="ID"
                  placeholder="-"
                  value={orderId != null ? String(orderId) : ""}
                  onChange={() => {}}
                  readOnly
                />
              </div>
              <div style={{ flex: 1 }}>
                <Field
                  label="OC"
                  placeholder="OC2025..."
                  value={numeroOc}
                  onChange={(v) => {
                    markDirty();
                    setNumeroOc(v);
                  }}
                />
              </div>
            </div>

            {config.showEquipamento && (
              <Field
                label="Equipamento"
                placeholder="Digite ou selecione o equipamento"
                value={equipamento}
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
                placeholder="Nome da obra"
                value={obra}
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
                placeholder="Nome do operador"
                value={operador}
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
                placeholder="Ex: 1234h"
                value={horimetro}
                onChange={(v) => {
                  markDirty();
                  setHorimetro(v);
                }}
              />
            )}

            {config.showLocalEntrega && (
              <Field
                label="Local de entrega"
                placeholder="Endereço ou local"
                value={localEntrega}
                onChange={(v) => {
                  markDirty();
                  setLocalEntrega(v);
                }}
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
                onChange={(e) => {
                  markDirty();
                  setObservacoes(e.target.value);
                }}
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

            {hasSaved && (
              <>
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
              </>
            )}

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
          {allEquipOptions.map((opt) => (
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

/** estilos auxiliares / componentes simples */

const itemInputStyle = {
  width: "100%",
  borderRadius: 8,
  border: "1px solid #e5e7eb",
  background: "#ffffff",
  padding: "6px 8px",
  fontSize: "0.75rem",
} as const;

function ItemLabel(props: { children: any }) {
  return (
    <div
      style={{
        fontSize: "0.7rem",
        fontWeight: 500,
        color: "#4b5563",
        marginBottom: 2,
      }}
    >
      {props.children}
    </div>
  );
}

type FieldProps = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  datalistId?: string;
  readOnly?: boolean;
};

function Field({
  label,
  placeholder,
  value,
  onChange,
  datalistId,
  readOnly,
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
          background: readOnly ? "#f3f4f6" : "#f9fafb",
          padding: "8px 10px",
          fontSize: "0.8rem",
        }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          if (!readOnly) onChange(e.target.value);
        }}
        list={datalistId}
        readOnly={readOnly}
      />
    </div>
  );
}
