// FILE: app/api/financeiro/credores-pdf/route.ts
//
// Recebe o PDF "Contas Pagas" do Sienge e extrai
// a tabela de credores: { nome, codigo }
// usando Google Vision — mesmo padrão do projeto.
//
import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const maxDuration = 60;

function jsonError(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function resolveServiceAccount() {
  const b64 =
    process.env.GCP_KEY_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_B64 ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 || "";
  if (!b64) return null;
  try { return JSON.parse(Buffer.from(b64, "base64").toString("utf8")); }
  catch { throw new Error("Falha ao decodificar GCP_KEY_BASE64."); }
}

async function getVisionAuth() {
  const apiKey = process.env.GCP_VISION_API_KEY || process.env.GOOGLE_VISION_API_KEY || "";
  if (apiKey) return { mode: "apikey" as const, apiKey };
  const creds = resolveServiceAccount();
  if (!creds) throw new Error("Configure GCP_VISION_API_KEY ou GCP_KEY_BASE64.");
  const auth  = new GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const token = await auth.getAccessToken();
  if (!token) throw new Error("Não obtive token do Google.");
  return { mode: "bearer" as const, token };
}

async function visionPdfPages(base64Pdf: string, pages: number[]): Promise<string[]> {
  const auth     = await getVisionAuth();
  const endpoint = auth.mode === "apikey"
    ? `https://vision.googleapis.com/v1/files:annotate?key=${auth.apiKey}`
    : `https://vision.googleapis.com/v1/files:annotate`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.mode === "bearer") headers.Authorization = `Bearer ${auth.token}`;

  const res  = await fetch(endpoint, {
    method: "POST", headers,
    body: JSON.stringify({ requests: [{
      inputConfig: { content: base64Pdf, mimeType: "application/pdf" },
      features:    [{ type: "DOCUMENT_TEXT_DETECTION" }],
      pages,
    }]}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Vision ${res.status}: ${JSON.stringify(data)?.slice(0, 300)}`);
  return (data?.responses?.[0]?.responses ?? []).map((p: any) => p?.fullTextAnnotation?.text ?? "");
}

// ─────────────────────────────────────────────
// PARSER — extrai pares (nome, codigo) do texto
// ─────────────────────────────────────────────

export type Credor = {
  nome:   string;
  codigo: number;
  // normalizado para matching fuzzy
  _norm?: string;
};

function normalizar(s: string) {
  return s
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsearCredores(texto: string): Credor[] {
  const credores = new Map<number, string>();

  // O relatório Contas Pagas tem linhas do tipo:
  // NOME DO CREDOR  CODIGO  DOCUMENTO  LANÇAMENTO ...
  // O código é um número inteiro de 1-5 dígitos logo após o nome.
  // Estratégia: percorre linha a linha acumulando o nome até encontrar
  // um padrão "NOME ... CODIGO DOC" onde DOC começa com letra+ponto.
  const linhas = texto.split("\n").map(l => l.trim()).filter(Boolean);

  // Padrão de linha de dados: termina com "CÓDIGO DOCUMENTO"
  // Ex: "FETZ MINERADORA LTDA. 5197 NFEB.73354"
  // Captura: nome + espaço + (1-5 dígitos) + espaço + DOC-prefix
  const RE_LINHA = /^(.+?)\s+(\d{1,5})\s+[A-Z]{2,5}[.\-][A-Z0-9]/;
  // Ignora linhas de cabeçalho/rodapé
  const IGNORAR  = /^(Credor|Cd\.|Empresa|Per[íi]odo|Data\s+da\s+baixa|Total|20\/|SIENGE|Contas\s+Pag)/i;

  let bufNome = "";

  for (const linha of linhas) {
    if (IGNORAR.test(linha)) { bufNome = ""; continue; }

    const m = RE_LINHA.exec(linha);
    if (m) {
      const nomeParcial = m[1].trim();
      const codigo      = parseInt(m[2], 10);
      // Combina com buffer acumulado de linha anterior (quebras de nome)
      const nomeCompleto = bufNome ? `${bufNome} ${nomeParcial}` : nomeParcial;
      if (!credores.has(codigo) && nomeCompleto.length >= 3) {
        credores.set(codigo, nomeCompleto.replace(/\s+/g, " ").trim());
      }
      bufNome = "";
    } else {
      // Linha pode ser continuação do nome (wrapping do relatório)
      // Só acumula se parecer nome (letras/espaços, sem números longos)
      if (/^[A-ZÁÉÍÓÚÂÊÔÀÃÕ\s\.\-&\/]{3,}$/.test(linha) && linha.length < 80) {
        bufNome = bufNome ? `${bufNome} ${linha}` : linha;
      } else {
        bufNome = "";
      }
    }
  }

  return Array.from(credores.entries())
    .map(([codigo, nome]) => ({ codigo, nome, _norm: normalizar(nome) }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

// ─────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file     = formData.get("pdf") as File | null;
    if (!file) return jsonError("Nenhum PDF enviado");
    if (!file.name.toLowerCase().endsWith(".pdf")) return jsonError("Apenas .pdf");

    const bytes  = await file.arrayBuffer();
    const b64Pdf = Buffer.from(bytes).toString("base64");

    const MAX_PAGINAS   = 30;
    const MAX_POR_LOTE  = 5;
    let   todoTexto     = "";

    for (let inicio = 1; inicio <= MAX_PAGINAS; inicio += MAX_POR_LOTE) {
      const lote = Array.from({ length: MAX_POR_LOTE }, (_, i) => inicio + i);
      let textos: string[];
      try { textos = await visionPdfPages(b64Pdf, lote); }
      catch (e: any) { if (inicio === 1) throw e; break; }

      let algum = false;
      for (const t of textos) { if (t?.trim().length > 10) { todoTexto += "\n" + t; algum = true; } }
      if (!algum) break;
    }

    if (!todoTexto.trim()) return jsonError("Nenhum texto encontrado no PDF.", 422);

    const credores = parsearCredores(todoTexto);

    return NextResponse.json({
      ok:      true,
      total:   credores.length,
      credores,
    });

  } catch (e: any) {
    return jsonError("Erro interno: " + e.message, 500);
  }
}
