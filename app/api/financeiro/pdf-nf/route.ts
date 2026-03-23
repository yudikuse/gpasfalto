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

  // Estratégia 0: cabeçalho "RECEBEMOS DE <NOME> OS PRODUTOS..." (padrão recibo)
  let fornecedor =
    t.match(/RECEBEMOS\s+DE\s+([A-ZÁÉÍÓÚÂÊÔÀÃÕA-Za-z][^\n]{4,80}?)\s+(?:OS\s+PRODUTOS|OS\s+SERVICOS|DA\s+NOTA)/i)?.[1]?.trim();

  // Estratégia 1: linha após "IDENTIFICAÇÃO DO EMITENTE"
  if (!fornecedor || fornecedor.length < 4) {
    fornecedor = t.match(/IDENTIFICA[ÇC][ÃA]O\s+DO\s+EMITENTE[\s\S]{0,40}\n\s*([^\n]{4,80})/i)?.[1]?.trim();
  }

  // Estratégia 2: nome em caixa alta com sufixo empresarial próximo ao início do doc
  if (!fornecedor || fornecedor.length < 4) {
    const SUFIXOS = /LTDA|S\.?A\.?\s*$|ME\s*$|EPP|EIRELI|MINERADORA|TRANSPORTES|CONSTRUTORA|ENGENHARIA|INDUSTRIA|COMERCIO|DISTRIBUIDORA|SERVICOS/i;
    const linhas = t.split("\n").map(l => l.trim()).filter(Boolean);
    for (const l of linhas.slice(0, 30)) {
      if (l.length >= 5 && l.length <= 80 && SUFIXOS.test(l) && !/RECEBEMOS|DANFE|DOCUMENTO|NATUREZA|DESTINAT|RUA\s|AV\.\s|ROD\.\s/i.test(l)) {
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
        && !/RUA\s|AV\.\s|ROD\.\s|CEP|FONE|TEL\b/i.test(l)
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
  // O OCR pode separar o label do valor em linhas diferentes
  const valor_total =
    // Label + valor na mesma linha ou linha seguinte
    t.match(/VALOR\s+TOTAL\s+DA\s+NOTA\s*\n?\s*([\d\.]+,\d{2})/i)?.[1]
    ?? t.match(/TOTAL\s+DA\s+NOTA\s*\n?\s*([\d\.]+,\d{2})/i)?.[1]
    ?? t.match(/VALOR\s+TOTAL\s+DOS\s+PRODUTOS\s*\n?\s*([\d\.]+,\d{2})/i)?.[1]
    // Cabeçalho do recibo: "VALOR TOTAL: R$ 3.304,88"
    ?? t.match(/VALOR\s+TOTAL\s*:\s*R?\$?\s*([\d\.]+,\d{2})/i)?.[1]
    // Linha de duplicata: "001  30/03/2026  3.304,88"
    ?? t.match(/DUPLICATA[\s\S]{0,30}\n\s*001\s+[\d\/]+\s+([\d\.]+,\d{2})/i)?.[1]
    // Fallback: maior valor monetário com formato X.XXX,XX (evita valores pequenos)
    ?? (() => {
        const vals = [...t.matchAll(/\b([\d]{1,3}(?:\.[\d]{3})+,\d{2})\b/g)]
          .map(m => parseFloat(m[1].replace(/\./g,"").replace(",",".")))
          .filter(v => v > 10);
        if (!vals.length) {
          // Tenta valores sem milhar
          const vals2 = [...t.matchAll(/\b([\d]{2,6},\d{2})\b/g)]
            .map(m => parseFloat(m[1].replace(",",".")))
            .filter(v => v > 10);
          if (!vals2.length) return "";
          return Math.max(...vals2).toFixed(2).replace(".",",");
        }
        return Math.max(...vals).toFixed(2).replace(".",",");
      })();

  // ── Descrição dos produtos ────────────────────────────────────────
  // O bloco DADOS DO PRODUTO começa com dados do transportador (CÓDIGO ANTT,
  // OGY3120, PLACA...) e cabeçalhos de coluna (NCM, CST, CFOP, VALOR IP...).
  // "BRITA 01" só aparece DEPOIS do último cabeçalho de coluna.
  // Estratégia: dentro do bloco, pular tudo até após "VALOR IP" ou similar.

  const idxProd = t.search(/DADOS\s+DOS?\s+PRODUTO/i);  // aceita "DADOS DO" e "DADOS DOS"
  const idxAdc  = t.search(/DADOS\s+ADICIONAIS|C[AÁ]LCULO\s+DO\s+ISSQN/i);
  let descricao = "";

  if (idxProd >= 0) {
    const blocoFull = t.slice(idxProd, idxAdc > idxProd ? idxAdc : idxProd + 3000);

    // Encontra onde terminam os cabeçalhos de coluna da tabela de produtos.
    // O último cabeçalho costuma ser "VALOR IPI", "VALOR IP", "IPI", "IMPOSTOS"
    // seguido de uma quebra de linha — depois disso começam os itens reais.
    const fimHeaderIdx = (() => {
      const patterns = [
        /VALOR\s+IP[I]?\s*\n/i,
        /\bIPI\b\s*\n/i,
        /VALOR\s+TOTAL\s*\n\s*IMPOSTOS/i,
        /\bIMPOSTOS\b\s*\n/i,
        /ALIQ[UÕ]OTAS\b.*\n/i,
        /B\.\s*CALC\.\s*ICMS\b/i,
      ];
      for (const p of patterns) {
        const m = blocoFull.search(p);
        if (m > 0) {
          // Avança até o próximo \n após o match
          const nextNl = blocoFull.indexOf("\n", m);
          return nextNl > 0 ? nextNl + 1 : m;
        }
      }
      return -1;
    })();

    const subBloco = fimHeaderIdx > 0 ? blocoFull.slice(fimHeaderIdx) : blocoFull;

    const NUNCA = /^(NCM|CST|CFOP|UN\b|QTD|QUANT|VALOR|UNIT|TOTAL\b|ICMS|IPI\b|PIS|COFINS|ALIQ|BASE\b|BC\b|PROD\b|COD\b|SH\b|CEST|DADOS|DESCRI[ÇC]|SERVI[ÇC]|PRODUTO\b|NATUREZA|INFORMAC|FATURA|DUPLICATA|TRANSPORT|PESO\b|PLACA|VEICULO|FRETE|SEGURO|DESCONTO|PARCELAS|OBSERV|UNID|PC\b|TON\b|KG\b|MT\b|LT\b|BALDE\b|LITRO\b|METRO\b|ROLO\b|DATA\s|HORA\s|INSCRI[ÇC]|MUNIC|ENDERE|BAIRRO|CEP\b|RAZÃO|CNPJ|CPF\b|FONE|RUA\s|AV\.\s|CHAVE\s|PROTOCOLO|SÉRIE\b|FOLHA\b|CÓDIGO|CODIGO|ISENTO|NUMERAC|BRUTO|LIQUID|CÁLCULO|CALCULO|IMPOSTOS|IMPORT|MUNICIPAL|B\.\s*CALC|FRETE\s|REMETENTE|GO\b|UF\b|^EST\b|^FOB\b|^CIF\b|^ANP\b|^ISS\b|^BC\s|^FOL|ALÍQUOTA|ALIQUOTA|CÓDIGO\s+DO|DESCRIÇÃO\s+DO|PROD\.?\s*SERV)/i;

    function ehProduto(l: string): boolean {
      const s = l.trim();
      if (s.length < 3 || s.length > 80) return false;
      if (/^\d+([,\.]\d+)?$/.test(s)) return false;
      if (/^\d{8}$/.test(s)) return false;
      if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return false;
      if (/^[0-9\s,\.\/\-\+]+$/.test(s)) return false;
      if (/^\d{6,}/.test(s)) return false;           // linha começando com NCM/código longo
      if (NUNCA.test(s)) return false;
      if (/^(CST:|IBS:|CBS:|IS:|CÓD\.|COD\.|0\s+-|B\.\s|CEST:|COD\.\s+PRODUTO|UF\s+DE\s+CONS)/i.test(s)) return false;
      if (/^[A-Z]{1,3}$/.test(s)) return false;     // siglas curtas: GO, UF, EST, FOB
      if (/^[A-Z]{1,3}\s+\d/.test(s)) return false; // "EST 27101932..." ou "NCM SI"
      return /[A-ZÁÉÍÓÚÂÊÔÀÃÕ]{3,}/.test(s);        // exige ao menos 3 letras seguidas
    }

    const linhas = subBloco.split("\n").map(l => l.trim()).filter(Boolean);
    const itens: string[] = [];
    const vistos = new Set<string>();

    for (const l of linhas) {
      if (!ehProduto(l)) continue;
      const limpo = l.replace(/\s*CST:.*$/i,"").replace(/\s*IBS:.*$/i,"").trim();
      if (limpo.length < 3 || !ehProduto(limpo)) continue;
      const norm = limpo.toUpperCase().slice(0, 30);
      if (vistos.has(norm)) continue;
      vistos.add(norm);
      itens.push(limpo);
      if (itens.length >= 3) break;
    }

    if (itens.length === 1) descricao = itens[0];
    else if (itens.length === 2) descricao = itens.join(", ");
    else if (itens.length >= 3) descricao = `${itens[0]}, ${itens[1]} e outros`;
  }

  // Fallback direto no texto completo (ex: NFs onde o OCR não extraiu a seção de produtos)
  if (!descricao) {
    // Tenta produto típico em qualquer parte do texto
    const m = t.match(/\b(BRITA\s+\w+|TUBO\s+(?:PVC|CPVC|FERRO|ACO)\s*\w*|ASFALTO|CAP\s+\w+|CBUQ|AREIA|CIMENTO|DIESEL|GASOLINA|AGREGADO|EMULSÃO|EMULSAO|CONCRETO|PAVIMENTO|TINTA\s+\w+|PNEU\s+\w+|FILTRO\s+\w+|OLEO\s+\w+|MANGUEIRA\s+\w+|PARAFUSO\s+\w+|ROLAMENTO\s+\w+|CHAVE\s+\w+)/i);
    if (m) descricao = m[0].trim().slice(0, 60);
  }

  // Fallback 2: tenta extrair da linha de descrição do produto na tabela (formato diferente)
  if (!descricao) {
    // Padrão: CÓDIGO PRODUTO + DESCRIÇÃO DO PRODUTO / SERVIÇO (coluna única)
    const mDesc = t.match(/DESCRI[ÇC][ÃA]O\s+DO\s+PRODUTO\s*[\/\s]\s*SERVI[ÇC]O[^\n]*\n([^\n]{3,80})/i);
    if (mDesc) descricao = limpar(mDesc[1]);
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

    // Debug: bloco DADOS DO PRODUTO de cada página
    const _debug = grupos.map(g => {
      const t = g.texto;
      const i1 = t.search(/DADOS\s+DO\s+PRODUTO/i);
      const i2 = t.search(/DADOS\s+ADICIONAIS/i);
      return {
        pagina: g.pagina,
        achouBloco: i1 >= 0,
        bloco: i1 >= 0 ? t.slice(i1, i2 > i1 ? i2 : i1+600).replace(/\n/g,"↵") : "NÃO ENCONTROU DADOS DO PRODUTO",
        inicio300: t.slice(0,300).replace(/\n/g,"↵"),
      };
    });

    if (notas.length === 0)
      return NextResponse.json({
        ok: false,
        error: "OCR concluído mas campos não foram identificados. O escaneamento pode ter baixa qualidade.",
        _debug: todasPaginas.map(p => ({ pagina: p.pagina, preview: p.texto.slice(0, 200) })),
      }, { status: 422 });

    return NextResponse.json({ ok: true, total: notas.length, paginas: todasPaginas.length, notas, _debug });

  } catch (e: any) {
    return jsonError("Erro interno: " + e.message, 500);
  }
}
