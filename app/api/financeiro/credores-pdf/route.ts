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

  // Relatório Contas Pagas do Sienge — duas situações:
  // 1. Nome + código na mesma linha: "FETZ MINERADORA LTDA. 5197 NFEB.73354 ..."
  // 2. Nome quebrado em várias linhas, código na última:
  //      "AUTO PEÇAS"
  //      "BANDEIRANTES LTDA"
  //      "1201 NFEA.9664 ..."

  // Regex 1: nome embutido na linha antes do código
  const RE_COM_NOME = /^(.{3,60}?)\s{1,6}(\d{1,5})\s{1,6}[A-Z]{2,6}[.\-][A-Z0-9]/;
  // Regex 2: linha começa direto com código (nome estava no buffer)
  const RE_SEM_NOME = /^(\d{1,5})\s{1,6}[A-Z]{2,6}[.\-][A-Z0-9]/;

  const IGNORAR = /^(Credor\b|Cd\.\s|Empresa\s|Per[íi]odo\s|Data\s+da\s+baixa|Total\s+d|20\/\d{2}\/|SIENGE|Contas\s+Pag)/i;

  const linhas = texto.split("\n").map(l => l.trim()).filter(Boolean);
  let buf = "";

  for (const linha of linhas) {
    if (IGNORAR.test(linha)) { buf = ""; continue; }

    // Caso 1: nome inline
    const m1 = RE_COM_NOME.exec(linha);
    if (m1) {
      const nome   = (buf ? `${buf} ${m1[1]}` : m1[1]).replace(/\s+/g, " ").trim();
      const codigo = parseInt(m1[2], 10);
      if (!credores.has(codigo) && nome.length >= 3) credores.set(codigo, nome);
      buf = "";
      continue;
    }

    // Caso 2: código no início, nome estava no buffer
    const m2 = RE_SEM_NOME.exec(linha);
    if (m2 && buf) {
      const codigo = parseInt(m2[1], 10);
      const nome   = buf.replace(/\s+/g, " ").trim();
      if (!credores.has(codigo) && nome.length >= 3) credores.set(codigo, nome);
      buf = "";
      continue;
    }

    // Acumula no buffer se parece ser parte de um nome (não começa com número longo, não é rodapé)
    if (linha.length >= 2 && linha.length <= 70 && !/^\d{4,}/.test(linha) && !IGNORAR.test(linha)) {
      buf = buf ? `${buf} ${linha}` : linha;
    } else {
      buf = "";
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

    // Debug: primeiros 500 chars do texto extraído para diagnóstico
    const _debugTexto = todoTexto.slice(0, 800).replace(/\n/g, "↵ ");

    return NextResponse.json({
      ok:      true,
      total:   credores.length,
      credores,
      _debug:  { chars: todoTexto.length, preview: _debugTexto },
    });
      total:   credores.length,
      credores,
    });

  } catch (e: any) {
    return jsonError("Erro interno: " + e.message, 500);
  }
}
