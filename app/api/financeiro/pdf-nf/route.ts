// FILE: app/api/financeiro/pdf-nf/route.ts
//
// Usa Google Vision API (files:annotate) — mesmo padrão de auth
// do projeto (GCP_VISION_API_KEY ou GCP_KEY_BASE64).
// Sem Anthropic. Sem custo extra.
//
import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const maxDuration = 60;

// ─────────────────────────────────────────────
// AUTH (idêntico ao app/api/vision/ocr/route.ts)
// ─────────────────────────────────────────────

function jsonError(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function resolveServiceAccount() {
  const b64 =
    process.env.GCP_KEY_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_B64 ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ||
    "";
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch {
    throw new Error("Falha ao decodificar GCP_KEY_BASE64.");
  }
}

async function getVisionAuth() {
  const apiKey =
    process.env.GCP_VISION_API_KEY || process.env.GOOGLE_VISION_API_KEY || "";
  if (apiKey) return { mode: "apikey" as const, apiKey };

  const creds = resolveServiceAccount();
  if (!creds) throw new Error("Configure GCP_VISION_API_KEY ou GCP_KEY_BASE64.");

  const auth  = new GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Não obtive access token do Google.");
  return { mode: "bearer" as const, token };
}

// ─────────────────────────────────────────────
// GOOGLE VISION — files:annotate (suporte PDF nativo)
// ─────────────────────────────────────────────

async function visionPdfPages(base64Pdf: string, pages: number[]): Promise<string[]> {
  const auth = await getVisionAuth();
  const endpoint = auth.mode === "apikey"
    ? `https://vision.googleapis.com/v1/files:annotate?key=${auth.apiKey}`
    : `https://vision.googleapis.com/v1/files:annotate`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.mode === "bearer") headers.Authorization = `Bearer ${auth.token}`;

  const body = {
    requests: [{
      inputConfig: { content: base64Pdf, mimeType: "application/pdf" },
      features:    [{ type: "DOCUMENT_TEXT_DETECTION" }],
      pages,
    }],
  };

  const res  = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Vision API ${res.status}: ${JSON.stringify(data)?.slice(0, 400)}`);

  const pageResponses: any[] = data?.responses?.[0]?.responses ?? [];
  return pageResponses.map((p: any) => p?.fullTextAnnotation?.text ?? "");
}

// ─────────────────────────────────────────────
// PARSER DE DANFE
// ─────────────────────────────────────────────

function limpar(s: string) { return (s ?? "").trim().replace(/\s+/g, " "); }

function parseNf(texto: string, pagina: number) {
  const t = texto;

  // ── Número e Série ────────────────────────────────────────────────
  let numero_nf = "";
  let serie     = "";
  const mNS = t.match(/N[°º]?\s*[:\.]?\s*([\d\.]{1,12})\s*(?:S[ée]rie|SÉRIE|SER\.?)\s*:?\s*(\d+)/i);
  if (mNS) { numero_nf = mNS[1].replace(/\./g,""); serie = mNS[2]; }
  else {
    const mN = t.match(/N[°º]\s*([\d\.]+)/i);
    if (mN) numero_nf = mN[1].replace(/\./g,"");
    const mS = t.match(/S[ée]rie\s*:?\s*(\d+)/i) || t.match(/SÉRIE\s*(\d+)/i);
    if (mS) serie = mS[1];
  }

  // ── Chave de acesso (44 dígitos) ─────────────────────────────────
  const mChave = t.replace(/\s/g,"").match(/\d{44}/);
  const chave_acesso = mChave ? mChave[0] : "";

  // ── CNPJs ─────────────────────────────────────────────────────────
  const cnpjs = [...t.matchAll(/\d{2}\.?\d{3}\.?\d{3}[\/]\d{4}[-]\d{2}/g)].map(m => m[0]);

  // ── Fornecedor / Emitente ─────────────────────────────────────────
  // Tenta múltiplas estratégias pois o Vision pode reordenar o layout

  // Estratégia 1: linha após "IDENTIFICAÇÃO DO EMITENTE"
  let fornecedor =
    t.match(/IDENTIFICA[ÇC][ÃA]O\s+DO\s+EMITENTE[\s\S]{0,40}\n\s*([^\n]{4,80})/i)?.[1]?.trim();

  // Estratégia 2: nome em caixa alta com sufixo empresarial próximo ao início do doc
  if (!fornecedor || fornecedor.length < 4) {
    const SUFIXOS = /LTDA|S\.?A\.?\s*$|ME\s*$|EPP|EIRELI|MINERADORA|TRANSPORTES|CONSTRUTORA|ENGENHARIA|INDUSTRIA|COMERCIO|DISTRIBUIDORA|SERVICOS/i;
    const linhas = t.split("\n").map(l => l.trim()).filter(Boolean);
    // Tenta as primeiras 30 linhas (emitente está sempre no topo do DANFE)
    for (const l of linhas.slice(0, 30)) {
      if (l.length >= 5 && l.length <= 80 && SUFIXOS.test(l) && !/RECEBEMOS|DANFE|DOCUMENTO|NATUREZA|DESTINAT/i.test(l)) {
        fornecedor = l;
        break;
      }
    }
  }

  // Estratégia 3: trecho antes do primeiro CNPJ
  if (!fornecedor || fornecedor.length < 4) {
    const idx = t.search(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    if (idx > 0) {
      const trecho = t.slice(Math.max(0, idx - 300), idx);
      const linhas = trecho.split("\n").map(l => l.trim()).filter(l => l.length > 3 && l.length < 80);
      fornecedor = linhas.reverse().find(l =>
        /LTDA|S\.?A\.|ME\b|EPP|EIRELI|MINERADORA|TRANSPORTES|CONSTRU|ENGENHARIA|IND[UÚ]|COMERCIO|DISTRIBUIDORA/i.test(l)
      ) ?? "";
    }
  }

  fornecedor = limpar(fornecedor ?? "");

  // ── Destinatário ──────────────────────────────────────────────────
  const destinatario = limpar(
    t.match(/NOME\s*\/\s*RAZ[ÃA]O\s*SOCIAL\s*\n([^\n]{4,80})/i)?.[1]
    ?? t.match(/DESTINAT[ÁA]RIO[\s\S]{0,40}\nNOME[\s\S]{0,10}\n([^\n]{4,80})/i)?.[1]
    ?? ""
  );

  // ── Datas ─────────────────────────────────────────────────────────
  const todasDatas = [...t.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map(m => m[0]);

  // Emissão: data que vem acompanhada de horário (ex: "18/02/2026 15:20") ou label
  const data_emissao =
    t.match(/DATA\s+DA\s+EMISS[ÃA]O[\s\S]{0,10}(\d{2}\/\d{2}\/\d{4})/i)?.[1]
    ?? t.match(/(\d{2}\/\d{2}\/\d{4})\s+\d{2}:\d{2}/)?.[1]
    ?? todasDatas[0] ?? "";

  // Vencimento: label "DATA VCTO" ou seção DUPLICATA
  const data_vencimento =
    t.match(/DATA\s*VCT[OO]\.?\s*\n?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]
    ?? t.match(/VENCIMENTO\s*\n?\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]
    ?? t.match(/DUPLICATA[\s\S]{0,120}?(\d{2}\/\d{2}\/\d{4})/i)?.[1]
    ?? "";

  // ── Valor total ───────────────────────────────────────────────────
  const valor_total =
    t.match(/VALOR\s+TOTAL\s+DA\s+NOTA\s*\n?\s*([\d\.]+,\d{2})/i)?.[1]
    ?? t.match(/TOTAL\s+DA\s+NOTA\s*\n?\s*([\d\.]+,\d{2})/i)?.[1]
    ?? t.match(/VALOR\s+TOTAL\s+DOS\s+PRODUTOS\s*\n?\s*([\d\.]+,\d{2})/i)?.[1]
    // Fallback: maior valor no documento
    ?? (() => {
        const vals = [...t.matchAll(/([\d]{1,9}\.[\d]{3},\d{2}|[\d]{1,6},\d{2})/g)]
          .map(m => parseFloat(m[1].replace(/\./g,"").replace(",",".")))
          .filter(v => v > 1);
        if (!vals.length) return "";
        return Math.max(...vals).toFixed(2).replace(".",",");
      })();

  // ── Descrição dos produtos ────────────────────────────────────────
  // O Vision OCR do DANFE extrai os dados do produto em linhas da tabela.
  // Estratégia 1: linha após o label da coluna de descrição
  let descricao =
    t.match(/DESCRI[ÇC][ÃA]O\s+DO\s+PRODUTO\s*[\/\s]\s*SERVI[ÇC]O[^\n]*\n([^\n]{3,120})/i)?.[1]
    // Estratégia 2: linha após "DADOS DO PRODUTO/SERVIÇO"
    ?? t.match(/DADOS\s+DO\s+PRODUTO[^\n]*\n(?:[^\n]{0,30}\n){1,3}([A-ZÁÉÍÓÚ][^\n]{3,80})/i)?.[1]
    // Estratégia 3: linha não numérica que vem logo antes ou depois do NCM (8 dígitos)
    ?? (() => {
        const mNcm = t.match(/([A-ZÁÉÍÓÚA-Z][^\n]{3,60})\n[^\n]*\b\d{8}\b/i)
                  || t.match(/\b\d{8}\b[^\n]*\n([A-ZÁÉÍÓÚ][^\n]{3,60})/i);
        return mNcm?.[1] ?? "";
      })()
    // Estratégia 4: qualquer linha com produto típico (BRITA, TUBO, ASFALTO, etc.)
    ?? t.match(/\b(BRITA|TUBO|ASFALTO|CAP|CBUQ|AREIA|PEDRA|CIMENTO|TINTA|DIESEL|GASOLINA|SERVICO|MANUTENCAO|LOCACAO|AGREGADO|EMULSAO|IMPRIMACAO|CONCRETO|PAVIMENTO)[^\n]{0,80}/i)?.[0]
    ?? "";

  // Limpa cabeçalhos de tabela e ruídos comuns do OCR
  const BLACKLIST_DESC = /^(NCM|CST|CFOP|UN|QTD|QUANT|VALOR|UNIT|TOTAL|ICMS|IPI|PIS|COFINS|ALIQ|BASE|BC|PROD|COD|SH|CEST|DESCRI[ÇC][ÃA]O|SERVI[ÇC]O|PRODUTO|DADOS|NATUREZA|INFORMAC|FATURA|DUPLICATA|TRANSPORTA|PESO|PLACA|VEICULO|FRETE|SEGURO|DESCONTO|PARCELAS|OBSERV)$/i;

  descricao = limpar(descricao.split("\n")[0]);
  if (descricao.length < 3 || /^\d+$/.test(descricao) || BLACKLIST_DESC.test(descricao.trim())) descricao = "";

  // ── Condição de pagamento ─────────────────────────────────────────
  const condicao_pagamento =
    t.match(/CONDI[ÇC][ÃA]O\s+DE\s+PAGAMENTO[^\n]*\n([^\n]{3,60})/i)?.[1]?.trim()
    ?? "";

  return {
    _id:               `nf_p${pagina}_${Date.now()}`,
    _status:           "pendente" as const,
    _erro:             null,
    _siengeId:         null,
    _creditorId:       "",
    _selected:         true,
    pagina,
    tipo_nota:         "NF-e",
    numero_nf,
    serie,
    chave_acesso,
    fornecedor,
    cnpj_fornecedor:   cnpjs[0] ?? "",
    destinatario,
    cnpj_destinatario: cnpjs[1] ?? "",
    data_emissao,
    data_vencimento,
    valor_total,
    descricao,
    condicao_pagamento: "",
  };
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

    // Processa até 20 páginas em lotes de 5 (limite do Vision files:annotate)
    const MAX_POR_LOTE  = 5;
    const MAX_PAGINAS   = 20;
    const todasPaginas: { pagina: number; texto: string }[] = [];

    for (let inicio = 1; inicio <= MAX_PAGINAS; inicio += MAX_POR_LOTE) {
      const lote = Array.from({ length: MAX_POR_LOTE }, (_, i) => inicio + i);
      let textos: string[];

      try {
        textos = await visionPdfPages(b64Pdf, lote);
      } catch (e: any) {
        if (inicio === 1) throw e;
        break;
      }

      let algum = false;
      for (let i = 0; i < textos.length; i++) {
        const t = textos[i];
        if (t?.trim().length > 20) {
          todasPaginas.push({ pagina: inicio + i, texto: t });
          algum = true;
        }
      }
      if (!algum) break;
    }

    if (todasPaginas.length === 0)
      return jsonError("Nenhum texto encontrado. PDF pode estar corrompido ou com qualidade baixa.", 422);

    // Agrupa páginas em NFs (nova NF = página com marcador DANFE)
    const grupos: { pagina: number; texto: string }[] = [];
    for (const pg of todasPaginas) {
      const ehNovaNota =
        /DANFE|NF-e|NOTA\s+FISCAL\s+ELETR/i.test(pg.texto) ||
        /IDENTIFICA[ÇC][ÃA]O\s+DO\s+EMITENTE/i.test(pg.texto) ||
        grupos.length === 0;

      if (ehNovaNota) {
        grupos.push({ pagina: pg.pagina, texto: pg.texto });
      } else {
        grupos[grupos.length - 1].texto += "\n" + pg.texto;
      }
    }

    const notas = grupos
      .map(g  => parseNf(g.texto, g.pagina))
      .filter(n => n.cnpj_fornecedor || n.numero_nf || n.valor_total);

    if (notas.length === 0)
      return NextResponse.json({
        ok: false,
        error: "OCR concluído mas campos não foram identificados. O escaneamento pode ter baixa qualidade.",
        _debug: todasPaginas.map(p => ({ pagina: p.pagina, preview: p.texto.slice(0, 200) })),
      }, { status: 422 });

    return NextResponse.json({ ok: true, total: notas.length, paginas: todasPaginas.length, notas });

  } catch (e: any) {
    return jsonError("Erro interno: " + e.message, 500);
  }
}
