// FILE: app/api/financeiro/pdf-nf/route.ts
//
// Usa Gemini (Vertex AI) via GCP — mesmas credenciais já configuradas.
// O Gemini lê o PDF nativamente, sem precisar do Vision OCR primeiro.
//
// Variáveis necessárias (já existem no projeto):
//   GCP_KEY_BASE64  (service account JSON em base64)
//   ou GCP_VISION_API_KEY  (API key — também funciona para Gemini)
//
import { NextRequest, NextResponse } from "next/server";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 120;

function jsonError(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

// ─────────────────────────────────────────────
// GEMINI — lê PDF + extrai dados estruturados
// ─────────────────────────────────────────────

const PROMPT = `Você é um extrator de dados de DANFE (Nota Fiscal Eletrônica) brasileiro.

Analise o PDF e retorne SOMENTE um array JSON com uma entrada por NF encontrada:

[
  {
    "numero_nf": "número sem pontos (ex: 74154)",
    "serie": "série (ex: 001)",
    "chave_acesso": "44 dígitos sem espaços",
    "fornecedor": "razão social do EMITENTE — quem vendeu (campo IDENTIFICAÇÃO DO EMITENTE ou 'RECEBEMOS DE [NOME] OS PRODUTOS')",
    "cnpj_fornecedor": "CNPJ do emitente com pontuação (ex: 30.323.122/0001-80)",
    "destinatario": "razão social do destinatário",
    "cnpj_destinatario": "CNPJ do destinatário com pontuação",
    "data_emissao": "DD/MM/AAAA",
    "data_vencimento": "DD/MM/AAAA — da seção DUPLICATA/FATURA; vazio se não houver",
    "valor_total": "valor total da nota em formato BR (ex: 3.304,88) — campo 'VALOR TOTAL DA NOTA' ou 'VALOR TOTAL: R$ X'",
    "descricao": "nome(s) do(s) produto(s) da tabela DADOS DO PRODUTO — NÃO copie NCM, código, CST; se múltiplos: 'PROD1, PROD2 e outros'"
  }
]

Regras:
- Se o PDF tiver múltiplas NFs (uma por página), retorne um objeto para cada
- Retorne SOMENTE o array JSON, sem markdown, sem explicação`;

async function extrairNfsComGemini(base64Pdf: string): Promise<any[]> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) throw new Error("Configure a variável GEMINI_API_KEY no Vercel.");

  const MODEL    = "gemini-2.0-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{
      role: "user",
      parts: [
        { inline_data: { mime_type: "application/pdf", data: base64Pdf } },
        { text: PROMPT },
      ],
    }],
    generationConfig: { maxOutputTokens: 2000, temperature: 0 },
  };

  const res  = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${JSON.stringify(data)?.slice(0, 400)}`);

  const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const clean = txt.replace(/```json|```/g, "").trim();

  let parsed: any;
  try { parsed = JSON.parse(clean); }
  catch { throw new Error(`Gemini retornou JSON inválido: ${txt.slice(0, 300)}`); }

  const lista: any[] = Array.isArray(parsed) ? parsed : [parsed];

  return lista.map((nf: any, i: number) => ({
    _id:               `nf_p${i + 1}_${Date.now()}`,
    _status:           "pendente" as const,
    _erro:             null,
    _siengeId:         null,
    _creditorId:       "",
    _creditorName:     "",
    _selected:         true,
    pagina:            i + 1,
    tipo_nota:         "NF-e",
    numero_nf:         String(nf.numero_nf        ?? "").replace(/\./g, ""),
    serie:             String(nf.serie             ?? ""),
    chave_acesso:      String(nf.chave_acesso      ?? "").replace(/\s/g, ""),
    fornecedor:        String(nf.fornecedor        ?? ""),
    cnpj_fornecedor:   String(nf.cnpj_fornecedor   ?? ""),
    destinatario:      String(nf.destinatario      ?? ""),
    cnpj_destinatario: String(nf.cnpj_destinatario ?? ""),
    data_emissao:      String(nf.data_emissao      ?? ""),
    data_vencimento:   String(nf.data_vencimento   ?? ""),
    valor_total:       String(nf.valor_total       ?? ""),
    descricao:         String(nf.descricao         ?? ""),
    condicao_pagamento: "",
  }));
}

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file     = formData.get("pdf") as File | null;
    if (!file) return jsonError("Nenhum arquivo PDF enviado");
    if (!file.name.toLowerCase().endsWith(".pdf")) return jsonError("Apenas .pdf aceito");

    const bytes  = await file.arrayBuffer();
    const b64Pdf = Buffer.from(bytes).toString("base64");

    const notas = await extrairNfsComGemini(b64Pdf);

    if (notas.length === 0)
      return NextResponse.json({ ok: false, error: "Nenhuma NF encontrada no PDF." }, { status: 422 });

    return NextResponse.json({ ok: true, total: notas.length, notas });

  } catch (e: any) {
    return jsonError("Erro interno: " + e.message, 500);
  }
}
