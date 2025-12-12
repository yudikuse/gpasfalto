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

    // Cabeçalho conforme tipo
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
      // calcula valor total (se preenchido nos itens)
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
          // não dou throw aqui pra não travar o fluxo todo
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
    <main className="min-h-screen bg-slate-50 px-4 py-6 md:py-10">
      <div className="mx-auto w-full max-w-4xl space-y-6 md:space-y-8">
        {/* Header */}
        <header className="space-y-1">
          <h1 className="text-xl font-semibold text-slate-900 md:text-2xl">
            Registrar Ordem de Compra
          </h1>
          <p className="text-sm text-slate-500">
            Criar OC rápida e padrão para WhatsApp
          </p>
        </header>

        {/* Grid principal: em coluna no mobile, 2 colunas no desktop */}
        <div className="grid gap-4 md:grid-cols-2 md:items-start">
          {/* Coluna esquerda: tipo + dados + itens */}
          <div className="space-y-4 md:space-y-5">
            {/* Tipo de pedido */}
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-medium text-slate-900">
                Tipo de Pedido
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {(
                  Object.keys(ORDER_TYPE_LABELS) as OrderType[]
                ).map((type) => {
                  const selected = orderType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setOrderType(type)}
                      className={[
                        "flex flex-col items-center justify-center rounded-xl border px-3 py-3 text-xs font-medium transition",
                        selected
                          ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100",
                      ].join(" ")}
                    >
                      <span className="mb-1 text-lg">📌</span>
                      <span>{ORDER_TYPE_LABELS[type]}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Dados essenciais */}
            <section className="rounded-2xl bg-white p-4 shadow-sm space-y-3">
              <h2 className="text-sm font-medium text-slate-900">
                Dados Essenciais
              </h2>

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

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700">
                  Observações
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Informações adicionais..."
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                />
              </div>
            </section>

            {/* Itens da ordem */}
            <section className="rounded-2xl bg-white p-4 shadow-sm space-y-3">
              <h2 className="text-sm font-medium text-slate-900">
                Itens da ordem
              </h2>

              <button
                type="button"
                onClick={addItem}
                className="inline-flex w-full items-center justify-center rounded-xl border border-dashed border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
              >
                <span className="mr-1.5 text-base">＋</span>
                Adicionar item
              </button>

              {items.length === 0 && (
                <p className="text-xs text-slate-400">
                  Nenhum item adicionado ainda.
                </p>
              )}

              <div className="space-y-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2"
                  >
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[11px] font-medium text-slate-700">
                          Quantidade
                        </label>
                        <input
                          className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          placeholder="Ex: 2"
                          value={item.quantity}
                          onChange={(e) =>
                            updateItem(item.id, "quantity", e.target.value)
                          }
                        />
                      </div>
                      <div className="flex-[2]">
                        <label className="text-[11px] font-medium text-slate-700">
                          Descrição
                        </label>
                        <input
                          className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                          placeholder="Ex: mangueira hidráulica"
                          value={item.description}
                          onChange={(e) =>
                            updateItem(item.id, "description", e.target.value)
                          }
                        />
                      </div>
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <div className="flex-1">
                        <label className="text-[11px] font-medium text-slate-700">
                          Valor (opcional)
                        </label>
                        <input
                          className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
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
                        className="ml-2 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-100"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Coluna direita: preview WhatsApp + ações (no mobile vai para baixo) */}
          <div className="space-y-4 md:space-y-5">
            {/* Preview */}
            <section className="rounded-2xl bg-white p-4 shadow-sm">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                onClick={() => setPreviewOpen((v) => !v)}
              >
                <span className="text-sm font-medium text-slate-900">
                  Prévia da mensagem (WhatsApp)
                </span>
                <span className="text-xs text-slate-500">
                  {previewOpen ? "Recolher ▲" : "Mostrar ▼"}
                </span>
              </button>

              {previewOpen && (
                <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-xs text-slate-800 whitespace-pre-wrap">
                  {previewText || "Preencha os campos para gerar a mensagem."}
                </div>
              )}
            </section>

            {/* Ações */}
            <section className="space-y-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>

              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex w-full items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Copiar mensagem
              </button>

              <button
                type="button"
                onClick={handleWhatsapp}
                className="inline-flex w-full items-center justify-center rounded-full bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1ebe5b]"
              >
                <span className="mr-2 text-lg">🟢</span>
                Enviar no WhatsApp
              </button>

              {feedback && (
                <p className="pt-1 text-xs text-emerald-700">{feedback}</p>
              )}
              {error && (
                <p className="pt-1 text-xs text-red-600">{error}</p>
              )}
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
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-slate-700">
        {label}
      </label>
      <input
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
