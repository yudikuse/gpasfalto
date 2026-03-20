// FILE: app/api/financeiro/pdf-nf/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime   = "nodejs";
export const dynamic   = "force-dynamic";
export const maxDuration = 60;

function jsonError(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
    if (!apiKey) return jsonError("ANTHROPIC_API_KEY não configurada", 500);

    // ── Recebe o PDF ─────────────────────────
    const formData = await req.formData();
    const file     = formData.get("pdf") as File | null;
    if (!file) return jsonError("Nenhum arquivo PDF enviado");

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf") return jsonError("Apenas arquivos .pdf são aceitos");

    const bytes    = await file.arrayBuffer();
    const base64   = Buffer.from(bytes).toString("base64");

    // ── Chama Claude com o PDF ───────────────
    const prompt = `Este PDF é um arquivo DANFE com uma ou mais Notas Fiscais Eletrônicas brasileiras digitalizadas.

Extraia os dados de TODAS as notas fiscais presentes no PDF.
Retorne SOMENTE um array JSON válido, sem markdown, sem texto adicional, sem explicações.

Cada elemento do array deve seguir exatamente esta estrutura:
{
  "pagina": número da página onde aparece (1, 2, 3...),
  "tipo_nota": "NF-e",
  "numero_nf": "número da NF",
  "serie": "série",
  "chave_acesso": "44 dígitos da chave de acesso ou null",
  "fornecedor": "razão social do emitente",
  "cnpj_fornecedor": "CNPJ formatado XX.XXX.XXX/XXXX-XX",
  "destinatario": "razão social do destinatário",
  "cnpj_destinatario": "CNPJ do destinatário formatado",
  "data_emissao": "DD/MM/AAAA",
  "data_vencimento": "DD/MM/AAAA ou null",
  "valor_total": "valor com vírgula ex: 1.071,00",
  "descricao": "descrição resumida dos produtos/serviços",
  "condicao_pagamento": "à vista ou prazo ou null"
}

Se houver campos não encontrados, use null.
Retorne o array mesmo que haja apenas 1 nota.`;

    const body = {
      model:      "claude-opus-4-5",
      max_tokens: 4000,
      messages: [{
        role:    "user",
        content: [
          {
            type:   "document",
            source: { type: "base64", media_type: "application/pdf", data: base64 },
          },
          { type: "text", text: prompt },
        ],
      }],
    };

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return jsonError(`Erro na API Claude (${claudeRes.status}): ${err}`, 500);
    }

    const claudeData = await claudeRes.json();
    const text = (claudeData.content ?? [])
      .map((b: any) => b.text ?? "")
      .join("");

    // ── Faz parse do JSON retornado ──────────
    const clean = text.replace(/```json|```/g, "").trim();
    let notas: any[];
    try {
      notas = JSON.parse(clean);
      if (!Array.isArray(notas)) notas = [notas];
    } catch {
      return jsonError("Não foi possível interpretar a resposta da IA: " + text.slice(0, 300), 422);
    }

    // ── Adiciona ID único a cada nota ────────
    notas = notas.map((n, i) => ({
      _id:      `nf_${Date.now()}_${i}`,
      _status:  "pendente" as const,
      _erro:    null,
      _siengeId: null,
      ...n,
    }));

    return NextResponse.json({ ok: true, total: notas.length, notas });

  } catch (e: any) {
    return jsonError("Erro interno: " + e.message, 500);
  }
}
