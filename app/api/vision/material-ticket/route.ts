// FILE: app/api/vision/material-ticket/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ? { extra } : {}) },
    { status }
  );
}

function resolveServiceAccount() {
  const b64 =
    process.env.GCP_KEY_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_B64 ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ||
    "";

  if (!b64) return null;

  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    throw new Error(
      "Falha ao ler o service account. Verifique o base64 do JSON em GCP_KEY_BASE64 (ou GOOGLE_SERVICE_ACCOUNT_B64)."
    );
  }
}

async function getVisionAuth() {
  const apiKey =
    process.env.GCP_VISION_API_KEY || process.env.GOOGLE_VISION_API_KEY || "";

  if (apiKey) return { mode: "apikey" as const, apiKey };

  const creds = resolveServiceAccount();
  if (!creds) {
    throw new Error(
      "Sem credenciais: configure GCP_VISION_API_KEY (ou GOOGLE_VISION_API_KEY) ou GCP_KEY_BASE64."
    );
  }

  const auth = new GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const token = await auth.getAccessToken();
  if (!token) throw new Error("Não consegui obter access token (GoogleAuth).");

  return { mode: "bearer" as const, token };
}

async function visionTextDetection(imageBytes: Buffer) {
  const auth = await getVisionAuth();

  const endpointBase = "https://vision.googleapis.com/v1/images:annotate";
  const endpoint =
    auth.mode === "apikey" ? `${endpointBase}?key=${auth.apiKey}` : endpointBase;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.mode === "bearer") headers.Authorization = `Bearer ${auth.token}`;

  const body = {
    requests: [
      {
        image: { content: imageBytes.toString("base64") },
        features: [{ type: "TEXT_DETECTION" }],
        imageContext: { languageHints: ["pt", "pt-BR"] },
      },
    ],
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Vision API falhou (${res.status}). ${t?.slice(0, 300)}`);
  }

  return res.json();
}

function toUpperLines(raw: string) {
  const lines = (raw || "")
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean);
  const upper = lines.map((l) => l.toUpperCase());
  return { lines, upper };
}

function normalizeDateToBRShort(dd: string, mm: string, yy: string) {
  const y = yy.length === 2 ? yy : yy.slice(-2);
  return `${dd}/${mm}/${y}`;
}

function parseTicketFields(rawFull: string) {
  const { lines, upper } = toUpperLines(rawFull);

  // VEÍCULO: CE-02 / EH-02 etc
  const vehicleMatch = rawFull.match(/\b[A-Z]{1,3}-\d{2}\b/g);
  const veiculo = vehicleMatch?.[0]?.toUpperCase() || null;

  // DATA: dd/mm/yy ou dd/mm/yyyy
  const dateMatches = [...rawFull.matchAll(/\b(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/g)];
  let dataBr: string | null = null;
  if (dateMatches.length) {
    const m = dateMatches[0];
    dataBr = normalizeDateToBRShort(m[1], m[2], m[3]);
  }

  // HORÁRIO: hh:mm[:ss]
  const timeMatches =
    rawFull.match(/\b([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/g) || [];
  const horario = timeMatches[0] || null;

  // PESO: pegar o menor valor com 3 casas (geralmente o líquido no ticket)
  const pesoMatches = rawFull.match(/\b\d{1,3}[.,]\d{3}\b/g) || [];
  const pesoNums = pesoMatches
    .map((s) => Number.parseFloat(s.replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0);

  const peso_t = pesoNums.length ? Math.min(...pesoNums) : null;
  const peso_mask = peso_t !== null ? Number(peso_t).toFixed(3) : null;

  // ORIGEM / DESTINO / MATERIAL (heurística por linhas com "código + texto")
  const coded: string[] = [];
  for (const l of upper) {
    const m = l.match(/^\s*\d+\s+(.+)$/);
    if (m?.[1]) {
      const v = m[1].trim();
      if (
        v &&
        !v.includes("TICKET") &&
        !v.includes("PESAGEM") &&
        !v.includes("ASSINATURA") &&
        !v.includes("RECEBIMENTO")
      ) {
        coded.push(v);
      }
    }
  }

  let origem: string | null = null;
  let destino: string | null = null;
  let material: string | null = null;

  if (coded.length >= 3) {
    origem = coded[0];
    destino = coded[1];
    material = coded[2];
  } else {
    const gpaLine =
      upper.find((l) => l.includes("GPA ENGENHARIA") && !l.includes("CONSTRU")) ||
      upper.find((l) => l === "GPA ENGENHARIA") ||
      null;

    origem = gpaLine;

    const other = upper.find(
      (l) =>
        l.length >= 3 &&
        l !== origem &&
        !l.includes("GPA ENGENHARIA") &&
        !l.includes("TICKET") &&
        !l.includes("PESAGEM") &&
        !l.includes("VEIC") &&
        !l.includes("MOTORISTA") &&
        !l.includes("ASSINATURA") &&
        !l.includes("RECEBIMENTO") &&
        !/\d{2}\/\d{2}\/\d{2,4}/.test(l) &&
        !/\d{2}:\d{2}/.test(l)
    );

    destino = other || null;

    const matLine = upper.find((l) => /RR-?\s?\d/.test(l) || l.includes("DILUID"));
    material = matLine || null;
  }

  const clean = (s: string | null) => (s ? s.replace(/\s+/g, " ").trim() : null);

  return {
    veiculo: clean(veiculo),
    origem: clean(origem),
    destino: clean(destino),
    material: clean(material),
    data_br: dataBr,
    horario,
    peso_t,
    peso_mask,
    debug: {
      coded_lines: coded.slice(0, 10),
      lines_sample: lines.slice(0, 20),
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const imageBase64 = (body?.imageBase64 || "").trim();

    if (!imageBase64) {
      return jsonError("Envie { imageBase64 } (dataURL ou base64 puro).", 400);
    }

    // aceita dataURL ou base64 puro
    const b64 = imageBase64.includes("base64,")
      ? imageBase64.split("base64,")[1]
      : imageBase64;

    const input = Buffer.from(b64, "base64") as Buffer; // <- tipagem compatível

    if (!input?.length) return jsonError("Base64 inválido.", 400);

    // pré-processar para melhorar OCR (rotate auto + resize + sharpen)
    const processed = (await sharp(input)
      .rotate()
      .resize({ width: 1800, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .sharpen()
      .toBuffer()) as Buffer;

    const vision = await visionTextDetection(processed);
    const resp0 = vision?.responses?.[0] || {};
    const textAnnotations = resp0?.textAnnotations || [];
    const rawFull = (textAnnotations?.[0]?.description || "").trim();

    if (!rawFull) {
      return NextResponse.json({
        ok: true,
        raw: "",
        fields: {
          veiculo: null,
          origem: null,
          destino: null,
          material: null,
          data_br: null,
          horario: null,
          peso_t: null,
          peso_mask: null,
        },
        debug: { note: "sem texto detectado" },
      });
    }

    const fields = parseTicketFields(rawFull);

    return NextResponse.json({
      ok: true,
      raw: rawFull,
      fields,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro inesperado no OCR do ticket.", 500);
  }
}
