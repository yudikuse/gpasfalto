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

const PLATE_RE = /\b[A-Z]{3}-[A-Z0-9]{4}\b/g; // GWI-3J50, KGX-6I47
const EQUIP_RE = /\b[A-Z]{1,3}-\d{2}\b/g; // CE-02, EH-02

function looksLikeVehicle(s: string) {
  const v = (s || "").toUpperCase().trim();
  if (!v) return false;
  return /\b[A-Z]{3}-[A-Z0-9]{4}\b/.test(v) || /\b[A-Z]{1,3}-\d{2}\b/.test(v);
}

function pickVehicleFromContext(rawFull: string, upperLines: string[]) {
  // 1) Tentar pegar logo após "VEIC" / "VEIC/CAVALO"
  const idx = upperLines.findIndex(
    (l) => l.includes("VEIC") || l.includes("VEIC/CAVALO") || l.includes("VEÍC")
  );

  const windowText =
    idx >= 0 ? upperLines.slice(idx, idx + 5).join(" ") : "";

  const m1 = windowText.match(PLATE_RE)?.[0] || null;
  if (m1) return m1;

  const m2 = windowText.match(EQUIP_RE)?.[0] || null;
  if (m2) return m2;

  // 2) Fallback: primeira placa na página
  const allPlate = rawFull.toUpperCase().match(PLATE_RE)?.[0] || null;
  if (allPlate) return allPlate;

  // 3) Fallback: primeiro código de equipamento
  const allEquip = rawFull.toUpperCase().match(EQUIP_RE)?.[0] || null;
  if (allEquip) return allEquip;

  return null;
}

function normalizeDateToBRShort(dd: string, mm: string, yy: string) {
  const y = yy.length === 2 ? yy : yy.slice(-2);
  return `${dd}/${mm}/${y}`;
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function pickNetWeight(values: number[]) {
  const nums = Array.from(new Set(values.map((n) => round3(n)))).sort(
    (a, b) => a - b
  );

  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  if (nums.length === 2) return round3(Math.abs(nums[1] - nums[0]));

  // Se houver trio (inicial, final, líquido) usamos a relação:
  // final - inicial = líquido (e o líquido geralmente aparece impresso também)
  const tol = 0.001;
  for (let i = 0; i < nums.length; i++) {
    for (let j = 0; j < nums.length; j++) {
      if (nums[i] <= nums[j]) continue;
      const diff = round3(nums[i] - nums[j]);
      const has = nums.some((x) => Math.abs(x - diff) <= tol);
      if (has) return diff;
    }
  }

  // Fallback: diferença entre maior e menor (quando só inicial/final existem)
  return round3(nums[nums.length - 1] - nums[0]);
}

function parseTicketFields(rawFull: string) {
  const { lines, upper } = toUpperLines(rawFull);

  // VEÍCULO (placa ou código)
  const veiculo = pickVehicleFromContext(rawFull, upper);

  // DATA: dd/mm/yy ou dd/mm/yyyy
  const dateMatches = [
    ...rawFull.matchAll(/\b(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/g),
  ];
  let dataBr: string | null = null;
  if (dateMatches.length) {
    const m = dateMatches[0];
    dataBr = normalizeDateToBRShort(m[1], m[2], m[3]);
  }

  // HORÁRIO: hh:mm[:ss]
  const timeMatches =
    rawFull.match(/\b([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/g) || [];
  const horario = timeMatches[0] || null;

  // PESOS (3 casas): inicial, líquido, final
  const pesoMatches = rawFull.match(/\b\d{1,3}[.,]\d{3}\b/g) || [];
  const pesoNums = pesoMatches
    .map((s) => Number.parseFloat(s.replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0);

  const peso_t = pickNetWeight(pesoNums);
  const peso_mask = peso_t !== null ? Number(peso_t).toFixed(3) : null;

  // ORIGEM / DESTINO / MATERIAL:
  // Regra principal: linhas do tipo "95 CARGILL", "1 MASSA USINADA (CBUQ)"
  // Correção: ignorar linhas que "parecem veículo" (placa/código)
  const codedRaw: string[] = [];
  for (const l of upper) {
    const m = l.match(/^\s*\d+\s+(.+)$/);
    if (m?.[1]) {
      const v = m[1].trim();
      if (
        v &&
        !v.includes("TICKET") &&
        !v.includes("PESAGEM") &&
        !v.includes("ASSINATURA") &&
        !v.includes("RECEBIMENTO") &&
        !v.includes("MOTORISTA") &&
        !v.includes("VEIC") &&
        !looksLikeVehicle(v)
      ) {
        codedRaw.push(v);
      }
    }
  }

  // Também remove se coincidir com o veículo encontrado (mesmo que OCR troque 0/O/J)
  const coded = codedRaw.filter((x) => {
    if (!veiculo) return true;
    const a = x.replace(/[^A-Z0-9]/g, "");
    const b = veiculo.replace(/[^A-Z0-9]/g, "");
    if (!a || !b) return true;
    // se for muito parecido com o veículo, descarta (evita DESTINO = placa)
    return !(a === b || a.includes(b) || b.includes(a));
  });

  let origem: string | null = null;
  let destino: string | null = null;
  let material: string | null = null;

  if (coded.length >= 3) {
    origem = coded[0];
    destino = coded[1];
    material = coded[2];
  } else {
    // fallback origem
    origem =
      upper.find((l) => l.includes("GPA ENGENHARIA") && !l.includes("CONSTRU")) ||
      upper.find((l) => l === "GPA ENGENHARIA") ||
      null;

    // fallback destino: primeiro candidato "empresa/local" que não seja veículo nem termos do ticket
    destino =
      coded[0] ||
      upper.find(
        (l) =>
          l.length >= 3 &&
          !l.includes("GPA ENGENHARIA") &&
          !l.includes("TICKET") &&
          !l.includes("PESAGEM") &&
          !l.includes("ASSINATURA") &&
          !l.includes("RECEBIMENTO") &&
          !l.includes("MOTORISTA") &&
          !l.includes("VEIC") &&
          !/\d{2}\/\d{2}\/\d{2,4}/.test(l) &&
          !/\d{2}:\d{2}/.test(l) &&
          !looksLikeVehicle(l)
      ) ||
      null;

    // fallback material: reforçar MASSA/CBUQ + RR/DILUID
    material =
      coded[1] ||
      upper.find((l) => l.includes("MASSA") || l.includes("CBUQ")) ||
      upper.find((l) => /RR-?\s?\d/.test(l) || l.includes("DILUID")) ||
      null;
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
      coded_raw: codedRaw.slice(0, 10),
      coded_filtered: coded.slice(0, 10),
      pesos_encontrados: pesoMatches,
      pesos_nums: pesoNums,
      peso_liquido_escolhido: peso_t,
      lines_sample: lines.slice(0, 25),
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

    const b64 = imageBase64.includes("base64,")
      ? imageBase64.split("base64,")[1]
      : imageBase64;

    const input = Buffer.from(b64, "base64") as Buffer;
    if (!input?.length) return jsonError("Base64 inválido.", 400);

    const processed = (await sharp(input)
      .rotate()
      .resize({ width: 1900, withoutEnlargement: true })
      .jpeg({ quality: 88 })
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
