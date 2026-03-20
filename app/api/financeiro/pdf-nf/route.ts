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
  // O Vision OCR extrai colunas separadas. A descrição pode aparecer como:
  // - linha solta "BRITA 01" entre cabeçalhos da tabela
  // - bloco em "DADOS DO PRODUTO" com várias linhas de itens
  // Estratégia: extrair TODAS as linhas de descrição e montar resumo

  // Linhas que são claramente cabeçalho/ruído de tabela
  const LIXO_DESC = /^(NCM|CST|CFOP|UN\b|QTD|QUANT|VALOR|UNIT|TOTAL\b|ICMS|IPI|PIS|COFINS|ALIQ|BASE\b|BC\b|PROD\b|COD\b|SH\b|CEST|DESCRI[ÇC]|SERVI[ÇC]|PRODUTO\b|DADOS\s+DO|NATUREZA|INFORMAC|FATURA|DUPLICATA|TRANSPORT|PESO\b|PLACA|VEICULO|FRETE|SEGURO|DESCONTO|PARCELAS|OBSERV|UNID|PC\b|TON|KG\b|MT\b|LT\b|BALDE\b|LITRO\b|UNIDADE|ROLO\b|DATA\s+DA|DATA\s+DE|DATA\s+SAÍ|DATA\s+SAI|HORA\s+DE|INSCRI[ÇC]|MUNICÍ|MUNICI|ENDERE|BAIRRO|ESTADO|CEP\b|RAZÃO\s+SOC|NOME\s*\/|CNPJ|CPF|FONE|TEL\b|RUA\s+|AV\.\s+|ROD\.\s+|BR\s*\d|GO\s*\d|CHAVE\s+DE|PROTOCOLO|CONSULTA|SÉRIE\b|SERIE\b|FOLHA\b|EMISSÃO\s*:|SAÍDA\s*:|ENTRADA\s*:)/i;

  // Função para identificar se uma linha parece descrição de produto
  function ehDescricao(l: string): boolean {
    if (l.length < 3 || l.length > 100) return false;
    if (/^\d+[,\.]?\d*$/.test(l)) return false;           // só número
    if (/^\d{8}$/.test(l)) return false;                  // NCM
    if (/^\d{5,}\/\d+/.test(l)) return false;             // lançamento
    if (/^\d{2}\/\d{2}\/\d{4}/.test(l)) return false;    // data
    if (/^[0-9\s,\.\/\-]+$/.test(l)) return false;        // só nums/pontuação
    if (LIXO_DESC.test(l.trim())) return false;
    if (/^(CST|IBS|CBS|IS|RT|Total\s+RT|UF\s+DE|CÓD\.|COD\.)/i.test(l)) return false;
    // Deve ter ao menos uma letra maiúscula e parecer nome de produto
    return /[A-ZÁÉÍÓÚ]{2,}/.test(l);
  }

  // Encontra o bloco de produtos no texto — começa APÓS os cabeçalhos das colunas
  // e termina em DADOS ADICIONAIS ou CÁLCULO DO ISSQN
  const idxDados = t.search(/DADOS\s+DO\s+PRODUTO/i);
  const idxFim   = t.search(/DADOS\s+ADICIONAIS|CÁLCULO\s+DO\s+ISSQN|C[AÁ]LCULO\s+DO\s+ISSQN|INFORMAÇÕES\s+COMPLEMENTARES/i);

  // Pula os cabeçalhos das colunas (CÓDIGO, DESCRIÇÃO, NCM, CST...) avançando até a 1ª linha de produto
  let blocoInicio = idxDados >= 0 ? idxDados : 0;
  if (idxDados >= 0) {
    // Avança até passar a linha de cabeçalhos das colunas da tabela
    const blocoCompleto = t.slice(idxDados, idxFim > idxDados ? idxFim : idxDados + 4000);
    const linhasHeader  = blocoCompleto.split("\n");
    let passouHeader = false;
    for (let li = 0; li < linhasHeader.length && li < 20; li++) {
      const l = linhasHeader[li].trim();
      // Linha de cabeçalho tem múltiplas palavras-chave de tabela
      if (/DESCRI[ÇC]|NCM|CFOP|QUANT|VALOR\s+UNIT/i.test(l)) { passouHeader = true; }
      if (passouHeader && l.length > 3 && !/DESCRI[ÇC]|NCM|CFOP|QUANT|VALOR\s+UNIT|DATA\s+D[AE]|HORA\s+D[AE]/i.test(l)) {
        blocoInicio = idxDados + blocoCompleto.indexOf(linhasHeader[li]);
        break;
      }
    }
  }

  const bloco = t.slice(blocoInicio, idxFim > blocoInicio ? idxFim : blocoInicio + 3000);

  // Extrai todas as linhas que parecem descrição de produto
  const linhasBloco = bloco.split("\n").map(l => l.trim()).filter(Boolean);
  const itens: string[] = [];
  const vistos = new Set<string>();

  for (const l of linhasBloco) {
    if (!ehDescricao(l)) continue;
    // Remove prefixos como "CST:000 cTrib..." que aparecem inline
    const limpo = l.replace(/\s*CST:.*$/i,"").replace(/\s*IBS:.*$/i,"").trim();
    if (limpo.length < 3) continue;
    const norm = limpo.toUpperCase().slice(0,30);
    if (vistos.has(norm)) continue;
    vistos.add(norm);
    itens.push(limpar(limpo));
    if (itens.length >= 5) break; // máximo 5 itens distintos
  }

  // Monta descrição final
  let descricao = "";
  if (itens.length === 0) {
    // Fallback: qualquer produto típico no texto completo
    const m = t.match(/\b(BRITA|TUBO|ASFALTO|CAP\b|CBUQ|AREIA|PEDRA|CIMENTO|DIESEL|GASOLINA|OLEO\s+\w|TINTA|PNEU|FILTRO|ROLAMENTO|PECA|PARAFUSO|MANGUEIRA|FUSIVEL|CHAVE\s+\w|AGREGADO|EMULSAO|CONCRETO)[^\n]{0,60}/i);
    if (m) descricao = limpar(m[0].split("\n")[0]);
  } else if (itens.length === 1) {
    descricao = itens[0];
  } else if (itens.length <= 3) {
    descricao = itens.join(", ");
  } else {
    descricao = `${itens.slice(0,2).join(", ")} e mais ${itens.length - 2} itens`;
  }

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
